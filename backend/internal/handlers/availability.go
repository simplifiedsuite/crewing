package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"ralto/internal/models"
)

// Availability is a Person's own calendar, independent of any job. `Booked`
// entries are typically system-generated from confirmed Bookings rather
// than hand-entered (see the crew booking-response flow) — these endpoints
// are for the Unavailable/Tentative entries a person or scheduler enters
// directly.

func (a *API) ListAvailabilityForPerson(w http.ResponseWriter, r *http.Request) {
	personID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, person_id, start_date, end_date, status, type, day_portion, notes FROM availability WHERE person_id = $1 AND organisation_id = $2 ORDER BY start_date`,
		personID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list availability")
		return
	}
	defer rows.Close()

	entries := []models.Availability{}
	for rows.Next() {
		var av models.Availability
		if err := rows.Scan(&av.ID, &av.PersonID, &av.StartDate, &av.EndDate, &av.Status, &av.Type, &av.DayPortion, &av.Notes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list availability")
			return
		}
		entries = append(entries, av)
	}
	writeJSON(w, http.StatusOK, entries)
}

type availabilityWriteRequest struct {
	StartDate string                    `json:"start_date"`
	EndDate   string                    `json:"end_date"`
	Status    models.AvailabilityStatus `json:"status"`
	Type      *models.AvailabilityType  `json:"type"`
	// DayPortion — testing feedback S. Empty defaults to Full, matching the
	// column's own DEFAULT 'full' (a caller that predates this field, or
	// simply doesn't care, gets the same full-day behaviour as before).
	DayPortion models.AvailabilityDayPortion `json:"day_portion"`
	Notes      *string                       `json:"notes"`
}

func (a *API) CreateAvailability(w http.ResponseWriter, r *http.Request) {
	personID := chi.URLParam(r, "id")
	var req availabilityWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	// `type` is only meaningful on Unavailable rows (addendum v2 §2) — drop
	// it silently for any other status rather than relying on the caller
	// to already know that, since the DB CHECK would otherwise reject it.
	if req.Status != models.AvailabilityStatusUnavailable {
		req.Type = nil
	}
	if req.DayPortion == "" {
		req.DayPortion = models.AvailabilityDayPortionFull
	}
	var av models.Availability
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO availability (person_id, start_date, end_date, status, type, day_portion, notes, organisation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING id, person_id, start_date, end_date, status, type, day_portion, notes`,
		personID, req.StartDate, req.EndDate, req.Status, req.Type, req.DayPortion, req.Notes, currentOrgID,
	).Scan(&av.ID, &av.PersonID, &av.StartDate, &av.EndDate, &av.Status, &av.Type, &av.DayPortion, &av.Notes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create availability entry")
		return
	}
	writeJSON(w, http.StatusCreated, av)
}

func (a *API) DeleteAvailability(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "availabilityId")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM availability WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete availability entry")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "availability entry not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
