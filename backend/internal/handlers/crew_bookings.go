package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/middleware"
	"ralto/internal/models"
	"ralto/internal/notify"
)

// crewBookingResponse flattens in job/venue/client display fields so the
// crew mobile app's Home/JobDetail screens don't need N+1 lookups —
// mirrors the ralto-crew-mobile.jsx mock shape (NEXT_JOB, UPCOMING).
type crewBookingResponse struct {
	models.Booking
	RoleName    string  `json:"role_name"`
	JobName     string  `json:"job_name"`
	ClientName  string  `json:"client_name"`
	VenueName   *string `json:"venue_name,omitempty"`
	JobStartDate string `json:"job_start_date"`
	JobEndDate   string `json:"job_end_date"`
}

const crewBookingSelect = `
	SELECT b.id, b.job_requirement_id, b.person_id, b.status, b.start_date, b.end_date, b.call_time,
	       b.rate_override, b.offered_at, b.responded_at, b.confirmed_at, b.notes,
	       ro.name, j.name, c.name, v.name, j.start_date, j.end_date
	FROM bookings b
	JOIN job_requirements jr ON jr.id = b.job_requirement_id
	JOIN jobs j ON j.id = jr.job_id
	JOIN clients c ON c.id = j.client_id
	JOIN roles ro ON ro.id = jr.role_id
	LEFT JOIN venues v ON v.id = j.venue_id
`

func scanCrewBooking(rows pgx.Rows, b *crewBookingResponse) error {
	return rows.Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes,
		&b.RoleName, &b.JobName, &b.ClientName, &b.VenueName, &b.JobStartDate, &b.JobEndDate)
}

// ListMyBookings returns everything except declined/cancelled — the crew
// app's Home screen splits pending offers from confirmed upcoming work
// itself based on `status`.
//
// Testing feedback AA — Booking.status and Job.status are separate axes
// (see JobsContent's own "internal progress" vs. derived-tag comment on
// the scheduler side): marking a Job complete or cancelled never touches
// its Bookings' own status, so a Booking can sit at status='confirmed'
// forever after its Job is archived. Confirmed directly: a real completed,
// past-dated Job ("MDL Derby Screening") was still showing as the crew
// member's "Next job". Excluding j.status and j.end_date here (not just
// b.status) is what actually fixes it — a job-level status/date filter, not
// a booking-level one, matching what the report asked for.
func (a *API) ListMyBookings(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	rows, err := a.DB.Query(r.Context(),
		crewBookingSelect+` WHERE b.person_id = $1 AND b.status NOT IN ('declined', 'cancelled') AND b.organisation_id = $2
		                     AND j.status NOT IN ('complete', 'cancelled') AND j.end_date >= CURRENT_DATE
		                     ORDER BY b.start_date`,
		claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list bookings")
		return
	}
	defer rows.Close()

	bookings := []crewBookingResponse{}
	for rows.Next() {
		var b crewBookingResponse
		if err := scanCrewBooking(rows, &b); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list bookings")
			return
		}
		bookings = append(bookings, b)
	}
	writeJSON(w, http.StatusOK, bookings)
}

func (a *API) GetMyBooking(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	id := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(), crewBookingSelect+` WHERE b.id = $1 AND b.person_id = $2 AND b.organisation_id = $3`, id, claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get booking")
		return
	}
	defer rows.Close()
	if !rows.Next() {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}
	var b crewBookingResponse
	if err := scanCrewBooking(rows, &b); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get booking")
		return
	}
	writeJSON(w, http.StatusOK, b)
}

type respondToOfferRequest struct {
	Response string `json:"response"` // "accept" | "decline"
}

// RespondToOffer is the crew-side half of the offer -> accept/decline state
// machine (CreateBooking on the staff side creates the offer). Accepting
// sets status=confirmed + confirmed_at and fires booking_confirmed — per
// the templates doc, that trigger covers "an offer is accepted, or a
// scheduler directly confirms" as the same event either way.
func (a *API) RespondToOffer(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	id := chi.URLParam(r, "id")

	var req respondToOfferRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var newStatus models.BookingStatus
	switch req.Response {
	case "accept":
		newStatus = models.BookingStatusConfirmed
	case "decline":
		newStatus = models.BookingStatusDeclined
	default:
		writeError(w, http.StatusBadRequest, "response must be accept or decline")
		return
	}

	var b models.Booking
	err := a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET status = $1, responded_at = now(),
		        confirmed_at = CASE WHEN $1 = 'confirmed' THEN now() ELSE confirmed_at END
		 WHERE id = $2 AND person_id = $3 AND status = 'offered' AND organisation_id = $4
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		newStatus, id, claims.PersonID, currentOrgID,
	).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "offer not found, or already responded to")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to respond to offer")
		return
	}

	if newStatus == models.BookingStatusConfirmed {
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			subject, body := notify.RenderBookingConfirmed(ctx.RoleName, ctx.JobName, ctx.DatesText, crewCTAURL("/bookings/"+b.ID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingConfirmed,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
		}
	}

	writeJSON(w, http.StatusOK, b)
}

// GetMyBookingContact returns the primary production contact for a crew
// member's own booking's Job — JobContact itself is a staff-managed
// resource (/api/jobs/{id}/contacts), not reachable from a crew session,
// so this is the narrow, ownership-checked read crew's JobDetail screen
// actually needs.
func (a *API) GetMyBookingContact(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	bookingID := chi.URLParam(r, "id")

	var contact models.JobContact
	err := a.DB.QueryRow(r.Context(), `
		SELECT jc.id, jc.job_id, jc.name, jc.role_title, jc.email, jc.phone
		FROM job_contacts jc
		JOIN jobs j ON j.id = jc.job_id
		JOIN job_requirements jr ON jr.job_id = j.id
		JOIN bookings b ON b.job_requirement_id = jr.id
		WHERE b.id = $1 AND b.person_id = $2 AND b.organisation_id = $3
		ORDER BY jc.name
		LIMIT 1`,
		bookingID, claims.PersonID, currentOrgID,
	).Scan(&contact.ID, &contact.JobID, &contact.Name, &contact.RoleTitle, &contact.Email, &contact.Phone)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "no contact on file for this job")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get contact")
		return
	}
	writeJSON(w, http.StatusOK, contact)
}

// AcknowledgeBooking is the crew-side "Acknowledge" action on a
// booking_updated notification (call-time/venue/date change) — resolves
// the matching unacknowledged_update OperationalAlert raised by
// UpdateBooking, which is what the scheduler's Today screen tracker counts.
func (a *API) AcknowledgeBooking(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	bookingID := chi.URLParam(r, "id")

	var owns bool
	if err := a.DB.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM bookings WHERE id = $1 AND person_id = $2 AND organisation_id = $3)`, bookingID, claims.PersonID, currentOrgID).Scan(&owns); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to acknowledge booking")
		return
	}
	if !owns {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}

	if _, err := a.DB.Exec(r.Context(),
		`UPDATE operational_alerts SET status = 'resolved', resolved_at = now()
		 WHERE type = 'unacknowledged_update' AND related_entity_id = $1 AND status = 'open' AND organisation_id = $2`,
		bookingID, currentOrgID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to acknowledge booking")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
