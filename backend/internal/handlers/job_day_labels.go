package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"ralto/internal/models"
)

// Job day labels — testing feedback R. See migrations/0020_job_day_labels.sql
// for why this is its own small table rather than a column on jobs or
// booking_shifts: a day's meaning ("Match day") is a property of the Job's
// own date range, the same for every person covering it, not of any one
// person's booking.

func (a *API) ListJobDayLabels(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, job_id, date, label FROM job_day_labels WHERE job_id = $1 AND organisation_id = $2 ORDER BY date`,
		jobID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list day labels")
		return
	}
	defer rows.Close()

	labels := []models.JobDayLabel{}
	for rows.Next() {
		var l models.JobDayLabel
		if err := rows.Scan(&l.ID, &l.JobID, &l.Date, &l.Label); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list day labels")
			return
		}
		labels = append(labels, l)
	}
	writeJSON(w, http.StatusOK, labels)
}

type setJobDayLabelRequest struct {
	Label string `json:"label"`
}

// SetJobDayLabel upserts the label for one specific date on a Job — an
// empty label clears it (deletes the row) rather than storing an empty
// string, so "no label set" has exactly one representation.
func (a *API) SetJobDayLabel(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	date := chi.URLParam(r, "date")
	var req setJobDayLabelRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Label == "" {
		if _, err := a.DB.Exec(r.Context(),
			`DELETE FROM job_day_labels WHERE job_id = $1 AND date = $2 AND organisation_id = $3`,
			jobID, date, currentOrgID,
		); err != nil {
			writeError(w, http.StatusBadRequest, "failed to clear day label")
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	var l models.JobDayLabel
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO job_day_labels (job_id, date, label, organisation_id) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (job_id, date) DO UPDATE SET label = EXCLUDED.label
		 RETURNING id, job_id, date, label`,
		jobID, date, req.Label, currentOrgID,
	).Scan(&l.ID, &l.JobID, &l.Date, &l.Label)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to set day label")
		return
	}
	writeJSON(w, http.StatusOK, l)
}
