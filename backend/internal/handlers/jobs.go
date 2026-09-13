package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

const jobSelectColumns = `id, name, client_id, project_reference, venue_id, project_id, shared_contract_id, shared_contract_name,
	        start_date, end_date, status, commitment, color_hex, notes, created_by, created_at, updated_at`

func scanJob(row pgx.Row, j *models.Job) error {
	return row.Scan(&j.ID, &j.Name, &j.ClientID, &j.ProjectReference, &j.VenueID, &j.ProjectID, &j.SharedContractID, &j.SharedContractName,
		&j.StartDate, &j.EndDate, &j.Status, &j.Commitment, &j.ColorHex, &j.Notes, &j.CreatedBy, &j.CreatedAt, &j.UpdatedAt)
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
		`INSERT INTO jobs (name, client_id, project_reference, venue_id, project_id, shared_contract_id, shared_contract_name, start_date, end_date, status, commitment, color_hex, notes, created_by, organisation_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		 RETURNING `+jobSelectColumns,
		req.Name, req.ClientID, req.ProjectReference, req.VenueID, req.ProjectID, req.SharedContractID, req.SharedContractName, req.StartDate, req.EndDate, req.Status, req.Commitment, req.ColorHex, req.Notes, staff, currentOrgID,
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
	var j models.Job
	err := scanJob(a.DB.QueryRow(r.Context(),
		`UPDATE jobs SET name = $1, client_id = $2, project_reference = $3, venue_id = $4, project_id = $5,
		        shared_contract_id = $6, shared_contract_name = $7,
		        start_date = $8, end_date = $9, status = $10, commitment = $11, color_hex = $12, notes = $13, updated_at = now()
		 WHERE id = $14 AND organisation_id = $15
		 RETURNING `+jobSelectColumns,
		req.Name, req.ClientID, req.ProjectReference, req.VenueID, req.ProjectID, req.SharedContractID, req.SharedContractName, req.StartDate, req.EndDate, req.Status, req.Commitment, req.ColorHex, req.Notes, id, currentOrgID,
	), &j)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update job")
		return
	}
	writeJSON(w, http.StatusOK, j)
}

func (a *API) DeleteJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM jobs WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete job (it may still have requirements or bookings)")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
