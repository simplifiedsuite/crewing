package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

const venueSelectColumns = `id, name, address, city, country, timezone, notes, core_location_id, created_at, updated_at`

func scanVenue(row pgx.Row, v *models.Venue) error {
	return row.Scan(&v.ID, &v.Name, &v.Address, &v.City, &v.Country, &v.Timezone, &v.Notes, &v.CoreLocationID, &v.CreatedAt, &v.UpdatedAt)
}

func (a *API) ListVenues(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(),
		`SELECT `+venueSelectColumns+` FROM venues WHERE organisation_id = $1 ORDER BY name`, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list venues")
		return
	}
	defer rows.Close()

	venues := []models.Venue{}
	for rows.Next() {
		var v models.Venue
		if err := scanVenue(rows, &v); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list venues")
			return
		}
		venues = append(venues, v)
	}
	writeJSON(w, http.StatusOK, venues)
}

func (a *API) GetVenue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var v models.Venue
	err := scanVenue(a.DB.QueryRow(r.Context(),
		`SELECT `+venueSelectColumns+` FROM venues WHERE id = $1 AND organisation_id = $2`, id, currentOrgID,
	), &v)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "venue not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get venue")
		return
	}
	writeJSON(w, http.StatusOK, v)
}

type venueWriteRequest struct {
	Name     string  `json:"name"`
	Address  *string `json:"address"`
	City     *string `json:"city"`
	Country  *string `json:"country"`
	Timezone string  `json:"timezone"`
	Notes    *string `json:"notes"`
}

func (a *API) CreateVenue(w http.ResponseWriter, r *http.Request) {
	var req venueWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var v models.Venue
	err := scanVenue(a.DB.QueryRow(r.Context(),
		`INSERT INTO venues (name, address, city, country, timezone, notes, organisation_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING `+venueSelectColumns,
		req.Name, req.Address, req.City, req.Country, req.Timezone, req.Notes, currentOrgID,
	), &v)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create venue")
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (a *API) UpdateVenue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req venueWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var v models.Venue
	err := scanVenue(a.DB.QueryRow(r.Context(),
		`UPDATE venues SET name = $1, address = $2, city = $3, country = $4, timezone = $5, notes = $6, updated_at = now()
		 WHERE id = $7 AND organisation_id = $8
		 RETURNING `+venueSelectColumns,
		req.Name, req.Address, req.City, req.Country, req.Timezone, req.Notes, id, currentOrgID,
	), &v)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "venue not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update venue")
		return
	}
	writeJSON(w, http.StatusOK, v)
}

type linkCoreVenueRequest struct {
	CoreLocationID string  `json:"core_location_id"`
	Name           string  `json:"name"`
	Address        *string `json:"address"`
	Timezone       *string `json:"timezone"`
}

// LinkCoreVenue mirrors LinkCoreClient exactly (see clients.go) — the
// "find or create the local mirror row" step for a Core Location, so
// jobs.venue_id has a local row to point at. Idempotent: a core_location_id
// already mirrored just returns the existing row, never a duplicate.
func (a *API) LinkCoreVenue(w http.ResponseWriter, r *http.Request) {
	var req linkCoreVenueRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.CoreLocationID == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "core_location_id and name are required")
		return
	}

	var v models.Venue
	err := scanVenue(a.DB.QueryRow(r.Context(),
		`SELECT `+venueSelectColumns+` FROM venues WHERE core_location_id = $1 AND organisation_id = $2`,
		req.CoreLocationID, currentOrgID,
	), &v)
	if err == nil {
		writeJSON(w, http.StatusOK, v)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to look up venue")
		return
	}

	timezone := "Europe/London"
	if req.Timezone != nil && *req.Timezone != "" {
		timezone = *req.Timezone
	}
	err = scanVenue(a.DB.QueryRow(r.Context(),
		`INSERT INTO venues (name, address, timezone, core_location_id, organisation_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING `+venueSelectColumns,
		req.Name, req.Address, timezone, req.CoreLocationID, currentOrgID,
	), &v)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create local venue mirror")
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (a *API) DeleteVenue(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM venues WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete venue (it may still be referenced by jobs)")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "venue not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
