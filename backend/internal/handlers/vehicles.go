package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

// Fleet vehicles (testing feedback batch, item G) — the company's own kit
// ("Transit Van 1"), assignable to one or more Jobs via job_vehicles.
// Separate entity from Person.VehicleRegistration (item F), which is a
// crew member's own personal car.

const vehicleSelectColumns = `id, name, registration, notes, created_at, updated_at`

func scanVehicle(row pgx.Row, v *models.Vehicle) error {
	return row.Scan(&v.ID, &v.Name, &v.Registration, &v.Notes, &v.CreatedAt, &v.UpdatedAt)
}

func (a *API) ListVehicles(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `SELECT `+vehicleSelectColumns+` FROM vehicles WHERE organisation_id = $1 ORDER BY name`, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list vehicles")
		return
	}
	defer rows.Close()

	vehicles := []models.Vehicle{}
	for rows.Next() {
		var v models.Vehicle
		if err := scanVehicle(rows, &v); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list vehicles")
			return
		}
		vehicles = append(vehicles, v)
	}
	writeJSON(w, http.StatusOK, vehicles)
}

type vehicleWriteRequest struct {
	Name         string  `json:"name"`
	Registration string  `json:"registration"`
	Notes        *string `json:"notes"`
}

func (a *API) CreateVehicle(w http.ResponseWriter, r *http.Request) {
	var req vehicleWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.Registration == "" {
		writeError(w, http.StatusBadRequest, "name and registration are required")
		return
	}
	var v models.Vehicle
	err := scanVehicle(a.DB.QueryRow(r.Context(),
		`INSERT INTO vehicles (name, registration, notes, organisation_id) VALUES ($1, $2, $3, $4) RETURNING `+vehicleSelectColumns,
		req.Name, req.Registration, req.Notes, currentOrgID,
	), &v)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create vehicle")
		return
	}
	writeJSON(w, http.StatusCreated, v)
}

func (a *API) UpdateVehicle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req vehicleWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Name == "" || req.Registration == "" {
		writeError(w, http.StatusBadRequest, "name and registration are required")
		return
	}
	var v models.Vehicle
	err := scanVehicle(a.DB.QueryRow(r.Context(),
		`UPDATE vehicles SET name = $1, registration = $2, notes = $3, updated_at = now() WHERE id = $4 AND organisation_id = $5 RETURNING `+vehicleSelectColumns,
		req.Name, req.Registration, req.Notes, id, currentOrgID,
	), &v)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update vehicle")
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// DeleteVehicle is blocked while the vehicle is assigned to any Job —
// same guard principle as DeleteRole/DeletePerson: unassign first rather
// than silently orphaning a job_vehicles row or surfacing a raw FK error.
func (a *API) DeleteVehicle(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var inUse bool
	if err := a.DB.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM job_vehicles WHERE vehicle_id = $1)`, id).Scan(&inUse); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete vehicle")
		return
	}
	if inUse {
		writeError(w, http.StatusConflict, "vehicle is still assigned to a job — unassign it first")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM vehicles WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete vehicle")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "vehicle not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- Job <-> Vehicle assignment ---

func (a *API) ListJobVehicles(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT `+vehicleSelectColumnsPrefixed("v")+`
		 FROM job_vehicles jv JOIN vehicles v ON v.id = jv.vehicle_id
		 WHERE jv.job_id = $1 ORDER BY v.name`, jobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list job vehicles")
		return
	}
	defer rows.Close()

	vehicles := []models.Vehicle{}
	for rows.Next() {
		var v models.Vehicle
		if err := scanVehicle(rows, &v); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list job vehicles")
			return
		}
		vehicles = append(vehicles, v)
	}
	writeJSON(w, http.StatusOK, vehicles)
}

type assignVehicleRequest struct {
	VehicleID string `json:"vehicle_id"`
}

func (a *API) AssignVehicleToJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	var req assignVehicleRequest
	if err := readJSON(r, &req); err != nil || req.VehicleID == "" {
		writeError(w, http.StatusBadRequest, "vehicle_id is required")
		return
	}
	// ON CONFLICT DO NOTHING: assigning an already-assigned vehicle is a
	// harmless no-op, not an error — matches the idempotent-where-sensible
	// pattern used elsewhere (e.g. Core's shared Job resolution).
	_, err := a.DB.Exec(r.Context(),
		`INSERT INTO job_vehicles (job_id, vehicle_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, jobID, req.VehicleID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to assign vehicle")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (a *API) UnassignVehicleFromJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	vehicleID := chi.URLParam(r, "vehicleId")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM job_vehicles WHERE job_id = $1 AND vehicle_id = $2`, jobID, vehicleID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to unassign vehicle")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "that vehicle isn't assigned to this job")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// vehicleSelectColumnsPrefixed re-qualifies vehicleSelectColumns' bare
// column names with a table alias, for the one query here that joins
// vehicles against another table — avoids a second hand-maintained column
// list drifting out of sync with the first.
func vehicleSelectColumnsPrefixed(alias string) string {
	return alias + ".id, " + alias + ".name, " + alias + ".registration, " + alias + ".notes, " + alias + ".created_at, " + alias + ".updated_at"
}
