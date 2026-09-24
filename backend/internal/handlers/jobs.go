package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

const jobSelectColumns = `id, name, client_id, project_reference, venue_id, project_id, shared_contract_id, shared_contract_name, shared_job_id, order_number,
	        start_date, end_date, status, commitment, color_hex, notes, created_by, created_at, updated_at,
	        deleted_at, deleted_by, (SELECT u.name FROM users u WHERE u.id = deleted_by) AS deleted_by_name`

func scanJob(row pgx.Row, j *models.Job) error {
	return row.Scan(&j.ID, &j.Name, &j.ClientID, &j.ProjectReference, &j.VenueID, &j.ProjectID, &j.SharedContractID, &j.SharedContractName, &j.SharedJobID, &j.OrderNumber,
		&j.StartDate, &j.EndDate, &j.Status, &j.Commitment, &j.ColorHex, &j.Notes, &j.CreatedBy, &j.CreatedAt, &j.UpdatedAt,
		&j.DeletedAt, &j.DeletedBy, &j.DeletedByName)
}

func (a *API) ListJobs(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(),
		`SELECT `+jobSelectColumns+`
		 FROM jobs WHERE organisation_id = $1 ORDER BY start_date`, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list jobs")
		return
	}
	defer rows.Close()

	jobs := []models.Job{}
	for rows.Next() {
		var j models.Job
		if err := scanJob(rows, &j); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list jobs")
			return
		}
		jobs = append(jobs, j)
	}
	writeJSON(w, http.StatusOK, jobs)
}

func (a *API) GetJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var j models.Job
	err := scanJob(a.DB.QueryRow(r.Context(),
		`SELECT `+jobSelectColumns+`
		 FROM jobs WHERE id = $1 AND organisation_id = $2`, id, currentOrgID,
	), &j)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get job")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

type jobWriteRequest struct {
	Name               string               `json:"name"`
	ClientID           string               `json:"client_id"`
	ProjectReference   *string              `json:"project_reference"`
	VenueID            *string              `json:"venue_id"`
	ProjectID          *string              `json:"project_id"`
	SharedContractID   *string              `json:"shared_contract_id"`
	SharedContractName *string              `json:"shared_contract_name"`
	SharedJobID        *string              `json:"shared_job_id"`
	OrderNumber        *string              `json:"order_number"`
	StartDate          string               `json:"start_date"`
	EndDate            string               `json:"end_date"`
	Status             models.JobStatus     `json:"status"`
	Commitment         models.JobCommitment `json:"commitment"`
	ColorHex           *string              `json:"color_hex"`
	Notes              *string              `json:"notes"`
}

func (a *API) CreateJob(w http.ResponseWriter, r *http.Request) {
	staff, _ := staffClaimsFromContext(r)
	var req jobWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Status == "" {
		req.Status = models.JobStatusDraft
	}
	if req.Commitment == "" {
		// Defaults to firm; the ProspectiveEvent "Convert to Job" flow (see
		// prospective_events.go) is what actually wants pencil by default —
		// that's a caller-side choice made at the point of conversion, not
		// something this generic create endpoint can infer.
		req.Commitment = models.JobCommitmentFirm
	}
	var j models.Job
	err := scanJob(a.DB.QueryRow(r.Context(),
		`INSERT INTO jobs (name, client_id, project_reference, venue_id, project_id, shared_contract_id, shared_contract_name, shared_job_id, order_number, start_date, end_date, status, commitment, color_hex, notes, created_by, organisation_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		 RETURNING `+jobSelectColumns,
		req.Name, req.ClientID, req.ProjectReference, req.VenueID, req.ProjectID, req.SharedContractID, req.SharedContractName, req.SharedJobID, req.OrderNumber, req.StartDate, req.EndDate, req.Status, req.Commitment, req.ColorHex, req.Notes, staff, currentOrgID,
	), &j)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create job")
		return
	}
	writeJSON(w, http.StatusCreated, j)
}

func (a *API) UpdateJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req jobWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var previousStart, previousEnd string
	if err := a.DB.QueryRow(r.Context(), `SELECT start_date, end_date FROM jobs WHERE id = $1 AND organisation_id = $2`, id, currentOrgID).
		Scan(&previousStart, &previousEnd); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	} else if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update job")
		return
	}

	var j models.Job
	err := scanJob(a.DB.QueryRow(r.Context(),
		`UPDATE jobs SET name = $1, client_id = $2, project_reference = $3, venue_id = $4, project_id = $5,
		        shared_contract_id = $6, shared_contract_name = $7, shared_job_id = $8, order_number = $9,
		        start_date = $10, end_date = $11, status = $12, commitment = $13, color_hex = $14, notes = $15, updated_at = now()
		 WHERE id = $16 AND organisation_id = $17
		 RETURNING `+jobSelectColumns,
		req.Name, req.ClientID, req.ProjectReference, req.VenueID, req.ProjectID, req.SharedContractID, req.SharedContractName, req.SharedJobID, req.OrderNumber, req.StartDate, req.EndDate, req.Status, req.Commitment, req.ColorHex, req.Notes, id, currentOrgID,
	), &j)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update job")
		return
	}

	// Bug fix — confirmed live on "FC Sabah v Slavia": the Job's dates
	// changing never cascaded anywhere, so job_requirements and bookings
	// kept whatever range they were created with even after the Job
	// itself no longer ran that long — Team view and the day-assignment
	// picker (both read bookings.start_date/end_date, not booking_shifts)
	// kept showing/offering a day the job didn't cover any more.
	if req.StartDate != previousStart || req.EndDate != previousEnd {
		a.cascadeJobDateChange(r.Context(), j.ID, j.StartDate, j.EndDate)
	}

	writeJSON(w, http.StatusOK, j)
}

// cascadeJobDateChange clamps every job_requirement's and booking's own
// date range to stay within the Job's new dates after an edit — narrower
// ranges (a booking covering only part of a longer job, item L) are left
// alone; only a range that now extends outside the Job's dates gets
// pulled in. A clamped booking's booking_shifts are resynced to its full
// new range, matching UpdateBooking's own established precedent that a
// real date-range change resyncs shifts to the full new range rather
// than trying to preserve a narrower prior selection.
func (a *API) cascadeJobDateChange(ctx context.Context, jobID, newStart, newEnd string) {
	rows, err := a.DB.Query(ctx,
		`SELECT id, start_date, end_date FROM job_requirements WHERE job_id = $1 AND organisation_id = $2`,
		jobID, currentOrgID,
	)
	if err != nil {
		log.Printf("cascade job date change: listing requirements: %v", err)
		return
	}
	type idRange struct{ id, start, end string }
	var reqs []idRange
	for rows.Next() {
		var rr idRange
		if err := rows.Scan(&rr.id, &rr.start, &rr.end); err != nil {
			rows.Close()
			log.Printf("cascade job date change: scanning requirement: %v", err)
			return
		}
		reqs = append(reqs, rr)
	}
	rows.Close()

	for _, rr := range reqs {
		clampedStart, clampedEnd := clampDateRange(rr.start, rr.end, newStart, newEnd)
		if clampedStart != rr.start || clampedEnd != rr.end {
			if _, err := a.DB.Exec(ctx,
				`UPDATE job_requirements SET start_date = $1, end_date = $2 WHERE id = $3 AND organisation_id = $4`,
				clampedStart, clampedEnd, rr.id, currentOrgID,
			); err != nil {
				log.Printf("cascade job date change: updating requirement %s: %v", rr.id, err)
			}
		}

		bookingRows, err := a.DB.Query(ctx,
			`SELECT id, start_date, end_date, call_time FROM bookings WHERE job_requirement_id = $1 AND organisation_id = $2`,
			rr.id, currentOrgID,
		)
		if err != nil {
			log.Printf("cascade job date change: listing bookings for requirement %s: %v", rr.id, err)
			continue
		}
		type bookingRange struct {
			id, start, end string
			callTime       *string
		}
		var bks []bookingRange
		for bookingRows.Next() {
			var br bookingRange
			if err := bookingRows.Scan(&br.id, &br.start, &br.end, &br.callTime); err != nil {
				log.Printf("cascade job date change: scanning booking: %v", err)
				continue
			}
			bks = append(bks, br)
		}
		bookingRows.Close()

		for _, br := range bks {
			clampedBStart, clampedBEnd := clampDateRange(br.start, br.end, newStart, newEnd)
			if clampedBStart == br.start && clampedBEnd == br.end {
				continue
			}
			if _, err := a.DB.Exec(ctx,
				`UPDATE bookings SET start_date = $1, end_date = $2 WHERE id = $3 AND organisation_id = $4`,
				clampedBStart, clampedBEnd, br.id, currentOrgID,
			); err != nil {
				log.Printf("cascade job date change: updating booking %s: %v", br.id, err)
				continue
			}
			shiftDays, err := expandDateRange(clampedBStart, clampedBEnd)
			if err != nil {
				log.Printf("cascade job date change: expanding shift days for booking %s: %v", br.id, err)
				continue
			}
			if err := a.syncBookingShifts(ctx, br.id, shiftDays, br.callTime); err != nil {
				log.Printf("cascade job date change: syncing booking shifts for booking %s: %v", br.id, err)
			}
		}
	}
}

// clampDateRange intersects [start, end] with [boundStart, boundEnd] —
// plain "YYYY-MM-DD" strings compare correctly with Go's native <, same
// convention already used elsewhere in this codebase. Falls back to
// [boundStart, boundEnd] entirely if the two ranges no longer overlap at
// all (e.g. the Job moved to a disjoint date range) rather than producing
// an inverted start > end range.
func clampDateRange(start, end, boundStart, boundEnd string) (string, string) {
	// Entirely disjoint from the Job's new range (the whole Job got moved
	// to different dates, not just shortened/lengthened) — nothing
	// meaningful to preserve, snap fully to the Job's own new range.
	if end < boundStart || start > boundEnd {
		return boundStart, boundEnd
	}
	newEnd := end
	if newEnd > boundEnd {
		newEnd = boundEnd
	}
	// Deliberately NOT pulling start up to boundStart just because the
	// ranges still overlap — a booking legitimately starting a day or two
	// before the Job's own start (a rig/prep day) is a real, existing
	// pattern confirmed in production (a handful of live bookings do
	// this). Only the provably-invalid disjoint case above gets start
	// touched; an overlapping range only ever gets its end trimmed in,
	// matching the confirmed real bug (a Job shortened at the end).
	return start, newEnd
}

var validJobStatuses = map[models.JobStatus]bool{
	models.JobStatusDraft:     true,
	models.JobStatusDefining:  true,
	models.JobStatusCrewing:   true,
	models.JobStatusConfirmed: true,
	models.JobStatusBriefed:   true,
	models.JobStatusLive:      true,
	models.JobStatusComplete:  true,
	models.JobStatusCancelled: true,
}

type jobStatusRequest struct {
	Status models.JobStatus `json:"status"`
}

// UpdateJobStatus is a dedicated, single-field action — testing feedback
// batch item E's "mark Cancelled"/"mark Complete" actions — rather than
// routing a status change through the generic full-record UpdateJob,
// which would require the caller to round-trip every other column just
// to flip one. Matches this codebase's existing convention for small
// state-transition actions (ConfirmBooking, ResolveAlert,
// ConvertProspectiveEvent, etc.) over a bespoke PUT payload.
func (a *API) UpdateJobStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req jobStatusRequest
	if err := readJSON(r, &req); err != nil || !validJobStatuses[req.Status] {
		writeError(w, http.StatusBadRequest, "a valid status is required")
		return
	}
	var j models.Job
	err := scanJob(a.DB.QueryRow(r.Context(),
		`UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2 AND organisation_id = $3 RETURNING `+jobSelectColumns,
		req.Status, id, currentOrgID,
	), &j)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update job status")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

// completedJobSummary is the Archive view's per-person row — a minimal
// projection (not the full Job) since Archive/PersonDetail only ever
// display name/client/dates, mirroring ScheduleItHistory's own shape.
type completedJobSummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ClientName string `json:"client_name"`
	StartDate  string `json:"start_date"`
	EndDate    string `json:"end_date"`
}

// ListCompletedJobsForPerson backs both the Archive view's crew filter and
// PersonDetail's own "Completed jobs" tab (sitting alongside, not
// replacing, the read-only ScheduleIt history tab — see
// ListScheduleItHistoryForPerson, which this deliberately mirrors: same
// person-scoped, read-only shape, same place in the Crew profile area).
// DISTINCT because a person can hold more than one booking on the same
// Job (different roles/requirements) and should still appear once.
func (a *API) ListCompletedJobsForPerson(w http.ResponseWriter, r *http.Request) {
	personID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT DISTINCT j.id, j.name, c.name AS client_name, j.start_date, j.end_date
		 FROM jobs j
		 JOIN clients c ON c.id = j.client_id
		 JOIN job_requirements jr ON jr.job_id = j.id
		 JOIN bookings b ON b.job_requirement_id = jr.id
		 WHERE b.person_id = $1 AND j.status = 'complete' AND j.organisation_id = $2
		 ORDER BY j.start_date DESC`, personID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list completed jobs")
		return
	}
	defer rows.Close()

	jobs := []completedJobSummary{}
	for rows.Next() {
		var j completedJobSummary
		if err := rows.Scan(&j.ID, &j.Name, &j.ClientName, &j.StartDate, &j.EndDate); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list completed jobs")
			return
		}
		jobs = append(jobs, j)
	}
	writeJSON(w, http.StatusOK, jobs)
}

// SoftDeleteJob is the testing-feedback "Delete cancelled jobs into an
// archive" action — deliberately a soft delete, never a row removal (a
// prior hard-delete endpoint here was removed as dead code: unreachable
// from the frontend and sitting right next to the feature that exists
// specifically to avoid hard deletes). Only a Cancelled job can be
// soft-deleted (the WHERE clause enforces it, not just the frontend
// button's own gating): this isn't general-purpose job deletion, just a
// way to clear out jobs already cancelled and cluttering the UI. Sets
// deleted_at/deleted_by; status is untouched (stays Cancelled) and no row
// is removed, so Restore below is a cheap, safe undo.
func (a *API) SoftDeleteJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	staff, ok := staffClaimsFromContext(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	var j models.Job
	err := scanJob(a.DB.QueryRow(r.Context(),
		`UPDATE jobs SET deleted_at = now(), deleted_by = $1, updated_at = now()
		 WHERE id = $2 AND organisation_id = $3 AND status = 'cancelled' AND deleted_at IS NULL
		 RETURNING `+jobSelectColumns,
		staff, id, currentOrgID,
	), &j)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "only a cancelled job that hasn't already been deleted can be deleted")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete job")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

// RestoreJob clears deleted_at/deleted_by — the safety net for a mis-click
// on SoftDeleteJob above. Status is untouched, so a restored job goes
// straight back to being a normal Cancelled job in every view.
func (a *API) RestoreJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var j models.Job
	err := scanJob(a.DB.QueryRow(r.Context(),
		`UPDATE jobs SET deleted_at = NULL, deleted_by = NULL, updated_at = now()
		 WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NOT NULL
		 RETURNING `+jobSelectColumns,
		id, currentOrgID,
	), &j)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "deleted job not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to restore job")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

// --- Job contacts ---

func (a *API) ListJobContacts(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, job_id, name, role_title, email, phone FROM job_contacts WHERE job_id = $1 ORDER BY name`, jobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list job contacts")
		return
	}
	defer rows.Close()

	contacts := []models.JobContact{}
	for rows.Next() {
		var c models.JobContact
		if err := rows.Scan(&c.ID, &c.JobID, &c.Name, &c.RoleTitle, &c.Email, &c.Phone); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list job contacts")
			return
		}
		contacts = append(contacts, c)
	}
	writeJSON(w, http.StatusOK, contacts)
}

type jobContactWriteRequest struct {
	Name      string  `json:"name"`
	RoleTitle *string `json:"role_title"`
	Email     *string `json:"email"`
	Phone     *string `json:"phone"`
}

func (a *API) CreateJobContact(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	var req jobContactWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var c models.JobContact
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO job_contacts (job_id, name, role_title, email, phone) VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, job_id, name, role_title, email, phone`,
		jobID, req.Name, req.RoleTitle, req.Email, req.Phone,
	).Scan(&c.ID, &c.JobID, &c.Name, &c.RoleTitle, &c.Email, &c.Phone)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create job contact")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}
