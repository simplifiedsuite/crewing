package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"ralto/internal/models"
)

// Job <-> Vehicle assignment — Stage 3 of the shared Vehicle addendum.
// Ralto no longer owns a local vehicles table; a Job assigns one or more
// of Core's shared Vehicles directly (see models.JobVehicle and
// migrations/0029_job_core_vehicles.sql). The picker itself is
// ListCoreVehicles in core_proxy.go, live per the same §5a rule as the
// Client/Contract pickers.

func (a *API) ListJobVehicles(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT core_vehicle_id, vehicle_name, registration FROM job_core_vehicles WHERE job_id = $1 ORDER BY vehicle_name`, jobID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list job vehicles")
		return
	}
	defer rows.Close()

	vehicles := []models.JobVehicle{}
	for rows.Next() {
		var v models.JobVehicle
		if err := rows.Scan(&v.CoreVehicleID, &v.Name, &v.Registration); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list job vehicles")
			return
		}
		vehicles = append(vehicles, v)
	}
	writeJSON(w, http.StatusOK, vehicles)
}

type assignVehicleRequest struct {
	CoreVehicleID string `json:"core_vehicle_id"`
	Name          string `json:"name"`
	Registration  string `json:"registration"`
}

// AssignVehicleToJob takes the Core Vehicle's own identity fields straight
// from the caller (the live Core picker already has them — see
// ListCoreVehicles) rather than looking them up server-side, same
// "caller already has it, just cache it" shape as LinkCoreVenue.
func (a *API) AssignVehicleToJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	var req assignVehicleRequest
	if err := readJSON(r, &req); err != nil || req.CoreVehicleID == "" || req.Name == "" || req.Registration == "" {
		writeError(w, http.StatusBadRequest, "core_vehicle_id, name and registration are required")
		return
	}
	// ON CONFLICT ... DO UPDATE: assigning an already-assigned vehicle is a
	// harmless no-op that also refreshes the cached name/registration —
	// idempotent, same principle as Core's own find-or-create endpoints.
	_, err := a.DB.Exec(r.Context(),
		`INSERT INTO job_core_vehicles (job_id, core_vehicle_id, vehicle_name, registration) VALUES ($1, $2, $3, $4)
		 ON CONFLICT (job_id, core_vehicle_id) DO UPDATE SET vehicle_name = EXCLUDED.vehicle_name, registration = EXCLUDED.registration`,
		jobID, req.CoreVehicleID, req.Name, req.Registration)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to assign vehicle")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (a *API) UnassignVehicleFromJob(w http.ResponseWriter, r *http.Request) {
	jobID := chi.URLParam(r, "id")
	coreVehicleID := chi.URLParam(r, "vehicleId")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM job_core_vehicles WHERE job_id = $1 AND core_vehicle_id = $2`, jobID, coreVehicleID)
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
