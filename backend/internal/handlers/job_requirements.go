package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

func (a *API) ListJobRequirements(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, job_id, role_id, quantity_required, start_date, end_date, call_time, notes
		 FROM job_requirements WHERE job_id = $1 AND organisation_id = $2 ORDER BY start_date`, jobID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list job requirements")
		return
	}
	defer rows.Close()

	reqs := []models.JobRequirement{}
	for rows.Next() {
		var jr models.JobRequirement
		if err := rows.Scan(&jr.ID, &jr.JobID, &jr.RoleID, &jr.QuantityRequired, &jr.StartDate, &jr.EndDate, &jr.CallTime, &jr.Notes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list job requirements")
			return
		}
		reqs = append(reqs, jr)
	}
	writeJSON(w, http.StatusOK, reqs)
}

// requirementSummary adds the derived confirmed/offered/unfilled counts the
// data model explicitly says must never be stored — always counted live
// from Booking rows. See ralto-data-model-v0_1.md §2.6 and §7.
type requirementSummary struct {
	models.JobRequirement
	RoleName          string `json:"role_name"`
	QuantityConfirmed int    `json:"quantity_confirmed"`
	QuantityPencilled int    `json:"quantity_pencilled"`
	QuantityOffered   int    `json:"quantity_offered"`
}

// ListJobRequirementsWithCounts is the endpoint the Jobs/Planner screens
// actually use — one query joining in Role name and Booking counts by
// status, rather than N+1 lookups per requirement.
func (a *API) ListJobRequirementsWithCounts(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(), `
		SELECT jr.id, jr.job_id, jr.role_id, jr.quantity_required, jr.start_date, jr.end_date, jr.call_time, jr.notes,
		       ro.name AS role_name,
		       COUNT(*) FILTER (WHERE b.status = 'confirmed') AS quantity_confirmed,
		       COUNT(*) FILTER (WHERE b.status = 'pencilled') AS quantity_pencilled,
		       COUNT(*) FILTER (WHERE b.status = 'offered') AS quantity_offered
		FROM job_requirements jr
		JOIN roles ro ON ro.id = jr.role_id
		LEFT JOIN bookings b ON b.job_requirement_id = jr.id
		WHERE jr.job_id = $1 AND jr.organisation_id = $2
		GROUP BY jr.id, ro.name
		ORDER BY jr.start_date`, jobID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list job requirements")
		return
	}
	defer rows.Close()

	summaries := []requirementSummary{}
	for rows.Next() {
		var s requirementSummary
		if err := rows.Scan(&s.ID, &s.JobID, &s.RoleID, &s.QuantityRequired, &s.StartDate, &s.EndDate, &s.CallTime, &s.Notes,
			&s.RoleName, &s.QuantityConfirmed, &s.QuantityPencilled, &s.QuantityOffered); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list job requirements")
			return
		}
		summaries = append(summaries, s)
	}
	writeJSON(w, http.StatusOK, summaries)
}

type jobRequirementWriteRequest struct {
	RoleID           string  `json:"role_id"`
	QuantityRequired int     `json:"quantity_required"`
	StartDate        string  `json:"start_date"`
	EndDate          string  `json:"end_date"`
	CallTime         *string `json:"call_time"`
	Notes            *string `json:"notes"`
}

func (a *API) CreateJobRequirement(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	var req jobRequirementWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var jr models.JobRequirement
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO job_requirements (job_id, role_id, quantity_required, start_date, end_date, call_time, notes, organisation_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id, job_id, role_id, quantity_required, start_date, end_date, call_time, notes`,
		jobID, req.RoleID, req.QuantityRequired, req.StartDate, req.EndDate, req.CallTime, req.Notes, currentOrgID,
	).Scan(&jr.ID, &jr.JobID, &jr.RoleID, &jr.QuantityRequired, &jr.StartDate, &jr.EndDate, &jr.CallTime, &jr.Notes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create job requirement")
		return
	}
	writeJSON(w, http.StatusCreated, jr)
}

func (a *API) UpdateJobRequirement(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "reqId")
	var req jobRequirementWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var jr models.JobRequirement
	err := a.DB.QueryRow(r.Context(),
		`UPDATE job_requirements SET role_id = $1, quantity_required = $2, start_date = $3, end_date = $4, call_time = $5, notes = $6
		 WHERE id = $7 AND organisation_id = $8
		 RETURNING id, job_id, role_id, quantity_required, start_date, end_date, call_time, notes`,
		req.RoleID, req.QuantityRequired, req.StartDate, req.EndDate, req.CallTime, req.Notes, id, currentOrgID,
	).Scan(&jr.ID, &jr.JobID, &jr.RoleID, &jr.QuantityRequired, &jr.StartDate, &jr.EndDate, &jr.CallTime, &jr.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job requirement not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update job requirement")
		return
	}
	writeJSON(w, http.StatusOK, jr)
}

func (a *API) DeleteJobRequirement(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "reqId")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM job_requirements WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete job requirement (it may still have bookings)")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "job requirement not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- Crew matching (Planner's "Available & suitable / Possible / Unavailable") ---
//
// Simplification flagged for Phase 1: base_location-to-venue proximity
// (mentioned in the data model's own derived-values table) needs geocoding
// this build doesn't have, so grouping here uses PersonRole + Availability +
// existing Booking load + preferred_status only. Proximity ranking can be
// layered onto the "suitable" bucket later without changing this shape.

type candidate struct {
	PersonID        string   `json:"person_id"`
	Name            string   `json:"name"`
	BaseLocation    *string  `json:"base_location,omitempty"`
	PreferredStatus string   `json:"preferred_status"`
	StandardRate    *float64 `json:"standard_rate,omitempty"`
	RateCurrency    *string  `json:"rate_currency,omitempty"`
	Reason          *string  `json:"reason,omitempty"` // set for unavailable/conflicted candidates
	// ConflictJobID/ConflictJobName — testing feedback O/Z: which other Job
	// this person is already booked on, set only for the Conflicted bucket
	// below. Lets the scheduler see (and click through to) the clashing Job
	// instead of just "Conflict — already booked these dates" with no
	// indication of which job that is.
	ConflictJobID   *string `json:"conflict_job_id,omitempty"`
	ConflictJobName *string `json:"conflict_job_name,omitempty"`
}

// alreadyAskedEntry is one prior ask against this job — either a formal
// Booking offer or a generic AvailabilityRequest — surfaced so a scheduler
// doesn't ask the same person again. See addendum v2 §5.
type alreadyAskedEntry struct {
	PersonID    string     `json:"person_id"`
	Name        string     `json:"name"`
	RoleName    *string    `json:"role_name,omitempty"` // nil for a generic (non-role-scoped) AvailabilityRequest
	AskedAt     time.Time  `json:"asked_at"`
	RespondedAt *time.Time `json:"responded_at,omitempty"`
}

type alreadyAskedGroup struct {
	AwaitingResponse []alreadyAskedEntry `json:"awaiting_response"`
	Declined         []alreadyAskedEntry `json:"declined"`
}

type candidateGroups struct {
	Suitable    []candidate `json:"suitable"`
	Possible    []candidate `json:"possible"`
	Unavailable []candidate `json:"unavailable"`
	// Conflicted — testing feedback Z: a person already booked on another
	// Job with overlapping dates (a travel-day clash) is no longer folded
	// into Unavailable. That bucket stays a real block (an explicit
	// Marked-unavailable day off), so this is deliberately a separate list
	// the frontend renders with a warning, not a lockout — Pencil/Offer
	// stay clickable here, unlike Unavailable.
	Conflicted   []candidate       `json:"conflicted"`
	AlreadyAsked alreadyAskedGroup `json:"already_asked"`
}

func (a *API) ListCandidatesForJobRequirement(w http.ResponseWriter, r *http.Request) {
	reqID := chi.URLParam(r, "reqId")

	var jobID, roleID, startDate, endDate string
	if err := a.DB.QueryRow(r.Context(),
		`SELECT job_id, role_id, start_date, end_date FROM job_requirements WHERE id = $1 AND organisation_id = $2`, reqID, currentOrgID,
	).Scan(&jobID, &roleID, &startDate, &endDate); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job requirement not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to look up job requirement")
		return
	}

	rows, err := a.DB.Query(r.Context(), `
		SELECT p.id, p.first_name || ' ' || p.last_name AS name, p.base_location, p.preferred_status,
		       p.standard_rate, p.rate_currency,
		       EXISTS (
		         SELECT 1 FROM availability av
		         WHERE av.person_id = p.id AND av.status = 'unavailable' AND av.organisation_id = $4
		           AND av.start_date <= $3 AND av.end_date >= $2
		       ) AS marked_unavailable,
		       conflict.job_id, conflict.job_name
		FROM people p
		JOIN person_roles pr ON pr.person_id = p.id AND pr.organisation_id = $4
		LEFT JOIN LATERAL (
		         SELECT j.id AS job_id, j.name AS job_name
		         FROM bookings b
		         JOIN job_requirements jr2 ON jr2.id = b.job_requirement_id
		         JOIN jobs j ON j.id = jr2.job_id
		         WHERE b.person_id = p.id AND b.status IN ('offered', 'confirmed') AND b.organisation_id = $4
		           AND b.start_date <= $3 AND b.end_date >= $2
		         ORDER BY b.start_date
		         LIMIT 1
		       ) conflict ON true
		WHERE pr.role_id = $1 AND p.status = 'active' AND p.organisation_id = $4
		ORDER BY p.preferred_status, name`,
		roleID, startDate, endDate, currentOrgID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to find candidates")
		return
	}
	defer rows.Close()

	groups := candidateGroups{
		Suitable:    []candidate{},
		Possible:    []candidate{},
		Unavailable: []candidate{},
		Conflicted:  []candidate{},
		AlreadyAsked: alreadyAskedGroup{
			AwaitingResponse: []alreadyAskedEntry{},
			Declined:         []alreadyAskedEntry{},
		},
	}
	for rows.Next() {
		var c candidate
		var markedUnavailable bool
		if err := rows.Scan(&c.PersonID, &c.Name, &c.BaseLocation, &c.PreferredStatus, &c.StandardRate, &c.RateCurrency,
			&markedUnavailable, &c.ConflictJobID, &c.ConflictJobName); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to find candidates")
			return
		}
		switch {
		case markedUnavailable:
			reason := "Marked unavailable these dates"
			c.Reason = &reason
			groups.Unavailable = append(groups.Unavailable, c)
		case c.ConflictJobID != nil:
			// Testing feedback Z: softened from a hard block (used to land
			// in Unavailable with no Pencil/Offer buttons at all) to a
			// warned-but-bookable bucket — a travel-day double-booking is
			// the scheduler's informed call to make, not something the UI
			// should force them to engineer dates around. O: the job name
			// is already fetched above, so the frontend can show (and link
			// to) exactly which Job is clashing rather than a bare
			// "already booked" with no indication of which one.
			reason := fmt.Sprintf("Already booked on %s", *c.ConflictJobName)
			c.Reason = &reason
			groups.Conflicted = append(groups.Conflicted, c)
		case c.PreferredStatus == string(models.PreferredStatusPreferred) || c.PreferredStatus == string(models.PreferredStatusApproved):
			groups.Suitable = append(groups.Suitable, c)
		default:
			groups.Possible = append(groups.Possible, c)
		}
	}

	if err := a.loadAlreadyAsked(r.Context(), jobID, reqID, &groups.AlreadyAsked); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to find candidates")
		return
	}

	writeJSON(w, http.StatusOK, groups)
}

// loadAlreadyAsked unions the two places a decline or outstanding ask can
// live (addendum v2 §5): a formal Booking offer and a generic
// AvailabilityRequest. These two are deliberately scoped differently, per
// what each actually represents in the data model, not the same scope
// applied twice:
//
//   - Booking offers are always made against one specific JobRequirement
//     (a real, formal ask for that exact role) — scoped to reqID.
//     Testing feedback: this used to be scoped to the whole Job instead,
//     so a person asked about Camera Op showed as "already asked" while a
//     scheduler was crewing an unrelated role (e.g. Sound) on the same
//     job — a real bug, not the deliberate design the old comment here
//     claimed.
//   - AvailabilityRequests have no role at all by design (a generic
//     "are you free these dates" ask made before any specific requirement
//     existed to attach it to — see alreadyAskedEntry's own RoleName
//     comment) — there is no narrower scope than jobID to apply here,
//     since the ask was never about one role in the first place.
func (a *API) loadAlreadyAsked(ctx context.Context, jobID, reqID string, group *alreadyAskedGroup) error {
	bookingRows, err := a.DB.Query(ctx, `
		SELECT p.id, p.first_name || ' ' || p.last_name, ro.name, b.status, b.offered_at, b.responded_at
		FROM bookings b
		JOIN job_requirements jr ON jr.id = b.job_requirement_id
		JOIN roles ro ON ro.id = jr.role_id
		JOIN people p ON p.id = b.person_id
		WHERE b.job_requirement_id = $1 AND b.status IN ('offered', 'declined') AND b.organisation_id = $2`, reqID, currentOrgID)
	if err != nil {
		return err
	}
	defer bookingRows.Close()

	for bookingRows.Next() {
		var e alreadyAskedEntry
		var roleName string
		var status models.BookingStatus
		if err := bookingRows.Scan(&e.PersonID, &e.Name, &roleName, &status, &e.AskedAt, &e.RespondedAt); err != nil {
			return err
		}
		e.RoleName = &roleName
		if status == models.BookingStatusDeclined {
			group.Declined = append(group.Declined, e)
		} else {
			group.AwaitingResponse = append(group.AwaitingResponse, e)
		}
	}
	if err := bookingRows.Err(); err != nil {
		return err
	}

	requestRows, err := a.DB.Query(ctx, `
		SELECT p.id, p.first_name || ' ' || p.last_name, ar.status, ar.response, ar.created_at, ar.responded_at
		FROM availability_requests ar
		JOIN people p ON p.id = ar.person_id
		WHERE ar.job_id = $1 AND (ar.status = 'pending' OR ar.response = 'no') AND ar.organisation_id = $2`, jobID, currentOrgID)
	if err != nil {
		return err
	}
	defer requestRows.Close()

	for requestRows.Next() {
		var e alreadyAskedEntry
		var status models.AvailabilityRequestStatus
		var response *models.AvailabilityResponse
		if err := requestRows.Scan(&e.PersonID, &e.Name, &status, &response, &e.AskedAt, &e.RespondedAt); err != nil {
			return err
		}
		if status == models.AvailabilityRequestStatusPending {
			group.AwaitingResponse = append(group.AwaitingResponse, e)
		} else {
			group.Declined = append(group.Declined, e)
		}
	}
	return requestRows.Err()
}
