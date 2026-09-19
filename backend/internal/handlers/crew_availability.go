package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/middleware"
	"ralto/internal/models"
)

// ListMyHolidayToil is the crew Calendar tab's data source for Holiday/TOIL
// entries — same query the iCal feed's own per-person Holiday/TOIL block
// already uses (backend/ical-sidecar/main.py), mirrored here rather than
// invented fresh. Sick/Other/Bank Holiday and plain untyped Unavailable
// stay excluded by the type filter, same as everywhere else this data is
// shown. The employment_type = 'staff' join is a second, independent gate,
// matching the iCal feed's own reasoning: CreateAvailability already
// refuses to set annual_leave/toil on a freelancer, but this fails safe
// (drops it) rather than relying on that invariant alone.
func (a *API) ListMyHolidayToil(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	rows, err := a.DB.Query(r.Context(),
		`SELECT a.id, a.person_id, a.start_date, a.end_date, a.status, a.type, a.day_portion, a.notes
		 FROM availability a
		 JOIN people p ON p.id = a.person_id
		 WHERE a.person_id = $1 AND a.organisation_id = $2
		       AND a.status = 'unavailable' AND a.type IN ('annual_leave', 'toil')
		       AND p.employment_type = 'staff'
		 ORDER BY a.start_date`,
		claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list holiday/TOIL entries")
		return
	}
	defer rows.Close()

	entries := []models.Availability{}
	for rows.Next() {
		var av models.Availability
		if err := rows.Scan(&av.ID, &av.PersonID, &av.StartDate, &av.EndDate, &av.Status, &av.Type, &av.DayPortion, &av.Notes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list holiday/TOIL entries")
			return
		}
		entries = append(entries, av)
	}
	writeJSON(w, http.StatusOK, entries)
}

func (a *API) ListMyAvailabilityRequests(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, person_id, job_id, start_date, end_date, message, status, response, responded_at,
		        suggested_booking_id, created_at
		 FROM availability_requests WHERE person_id = $1 AND organisation_id = $2 ORDER BY created_at DESC`, claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list availability requests")
		return
	}
	defer rows.Close()

	out := []models.AvailabilityRequest{}
	for rows.Next() {
		var ar models.AvailabilityRequest
		if err := rows.Scan(&ar.ID, &ar.PersonID, &ar.JobID, &ar.StartDate, &ar.EndDate, &ar.Message, &ar.Status,
			&ar.Response, &ar.RespondedAt, &ar.SuggestedBookingID, &ar.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list availability requests")
			return
		}
		out = append(out, ar)
	}
	writeJSON(w, http.StatusOK, out)
}

type respondToAvailabilityRequest struct {
	Response models.AvailabilityResponse `json:"response"` // yes | partially | no
}

// RespondToAvailabilityRequest implements the response handling in
// ralto-data-model-v0_1.md §5.2:
//   - status/response are updated here; responded_at is stamped by the
//     set_availability_request_responded_at trigger (migrations/0001_init.sql),
//     not by this handler — same separation of concerns as Equiptra's
//     resolved_date trigger.
//   - Yes/Partially + Staff employment auto-creates a draft Offered Booking
//     against a matching JobRequirement and raises an AutoSuggestedBooking
//     alert. Freelancers never get auto-booked (see doc for the reasoning:
//     staff are already committed, freelancers are a market of choices).
//
// Not yet wired: the doc also calls for a "courtesy notification to the
// scheduler who sent the request" on every response. Phase 1's SendGrid
// integration is crew-facing only (see ralto_notification_templates_v1.md's
// own scope note) — there's no staff notification channel yet to send that
// on. The scheduler's own AvailabilityRequests list reflects the new status
// immediately, which covers "nobody should have to poll" for now.
func (a *API) RespondToAvailabilityRequest(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	requestID := chi.URLParam(r, "id")

	var req respondToAvailabilityRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Response != models.AvailabilityResponseYes && req.Response != models.AvailabilityResponsePartially && req.Response != models.AvailabilityResponseNo {
		writeError(w, http.StatusBadRequest, "response must be yes, partially, or no")
		return
	}

	var ar models.AvailabilityRequest
	err := a.DB.QueryRow(r.Context(),
		`UPDATE availability_requests SET status = 'responded', response = $1
		 WHERE id = $2 AND person_id = $3 AND organisation_id = $4
		 RETURNING id, person_id, job_id, start_date, end_date, message, status, response, responded_at, suggested_booking_id, created_at`,
		req.Response, requestID, claims.PersonID, currentOrgID,
	).Scan(&ar.ID, &ar.PersonID, &ar.JobID, &ar.StartDate, &ar.EndDate, &ar.Message, &ar.Status,
		&ar.Response, &ar.RespondedAt, &ar.SuggestedBookingID, &ar.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "availability request not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to respond to availability request")
		return
	}

	shouldAutoBook := (req.Response == models.AvailabilityResponseYes || req.Response == models.AvailabilityResponsePartially) && ar.JobID != nil
	if shouldAutoBook {
		var employmentType models.EmploymentType
		if err := a.DB.QueryRow(r.Context(), `SELECT employment_type FROM people WHERE id = $1 AND organisation_id = $2`, claims.PersonID, currentOrgID).Scan(&employmentType); err == nil && employmentType == models.EmploymentTypeStaff {
			a.autoSuggestBooking(r.Context(), ar)
		}
	}

	writeJSON(w, http.StatusOK, ar)
}

// autoSuggestBooking picks the first job requirement on the request's Job
// that (a) matches one of the person's roles and (b) still has an unfilled
// slot, and creates a draft Offered booking against it, linked back via
// AvailabilityRequest.suggested_booking_id. If nothing matches cleanly,
// it's a no-op rather than a guess — the scheduler still sees the
// Yes/Partially response and can book manually. Errors are logged and
// swallowed: failing to auto-suggest shouldn't turn a successful
// availability response into a 500 for the crew member submitting it.
func (a *API) autoSuggestBooking(ctx context.Context, ar models.AvailabilityRequest) {
	var requirementID, startDate, endDate string
	err := a.DB.QueryRow(ctx, `
		SELECT jr.id, jr.start_date, jr.end_date
		FROM job_requirements jr
		JOIN person_roles pr ON pr.role_id = jr.role_id AND pr.person_id = $1
		LEFT JOIN bookings b ON b.job_requirement_id = jr.id AND b.status IN ('offered', 'confirmed') AND b.organisation_id = $3
		WHERE jr.job_id = $2 AND jr.organisation_id = $3
		GROUP BY jr.id
		HAVING jr.quantity_required > COUNT(b.id)
		ORDER BY jr.start_date
		LIMIT 1`,
		ar.PersonID, *ar.JobID, currentOrgID,
	).Scan(&requirementID, &startDate, &endDate)
	if errors.Is(err, pgx.ErrNoRows) {
		return // no unfilled requirement this person is suited for — scheduler books manually
	}
	if err != nil {
		log.Printf("auto-suggest booking: finding requirement: %v", err)
		return
	}

	var bookingID string
	err = a.DB.QueryRow(ctx,
		`INSERT INTO bookings (job_requirement_id, person_id, status, start_date, end_date, offered_at, organisation_id)
		 VALUES ($1, $2, 'offered', $3, $4, now(), $5)
		 RETURNING id`,
		requirementID, ar.PersonID, startDate, endDate, currentOrgID,
	).Scan(&bookingID)
	if err != nil {
		log.Printf("auto-suggest booking: creating draft booking: %v", err)
		return
	}

	if _, err := a.DB.Exec(ctx, `UPDATE availability_requests SET suggested_booking_id = $1 WHERE id = $2 AND organisation_id = $3`, bookingID, ar.ID, currentOrgID); err != nil {
		log.Printf("auto-suggest booking: linking suggested_booking_id: %v", err)
	}
	if _, err := a.DB.Exec(ctx,
		`INSERT INTO operational_alerts (job_id, type, related_entity_id, status, organisation_id) VALUES ($1, 'auto_suggested_booking', $2, 'open', $3)`,
		*ar.JobID, bookingID, currentOrgID,
	); err != nil {
		log.Printf("auto-suggest booking: raising alert: %v", err)
	}
}
