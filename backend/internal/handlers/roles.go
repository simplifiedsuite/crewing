package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

// Roles are the master list both a Person's capabilities (PersonRole) and a
// Job's requirements (JobRequirement) reference — what makes crew matching
// work. Small enough a list that no pagination/search is needed for v1.

func (a *API) ListRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `SELECT id, name, category FROM roles WHERE organisation_id = $1 ORDER BY name`, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list roles")
		return
	}
	defer rows.Close()

	roles := []models.Role{}
	for rows.Next() {
		var role models.Role
		if err := rows.Scan(&role.ID, &role.Name, &role.Category); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list roles")
			return
		}
		roles = append(roles, role)
	}
	writeJSON(w, http.StatusOK, roles)
}

type roleWriteRequest struct {
	Name     string  `json:"name"`
	Category *string `json:"category"`
}

func (a *API) CreateRole(w http.ResponseWriter, r *http.Request) {
	var req roleWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var role models.Role
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO roles (name, category, organisation_id) VALUES ($1, $2, $3) RETURNING id, name, category`,
		req.Name, req.Category, currentOrgID,
	).Scan(&role.ID, &role.Name, &role.Category)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create role")
		return
	}
	writeJSON(w, http.StatusCreated, role)
}

func (a *API) UpdateRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req roleWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var role models.Role
	err := a.DB.QueryRow(r.Context(),
		`UPDATE roles SET name = $1, category = $2 WHERE id = $3 AND organisation_id = $4 RETURNING id, name, category`,
		req.Name, req.Category, id, currentOrgID,
	).Scan(&role.ID, &role.Name, &role.Category)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "role not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update role")
		return
	}
	writeJSON(w, http.StatusOK, role)
}

// DeleteRole is blocked if the role is referenced by any person's
// capabilities, any job's requirements, or any Contract's role defaults —
// mirrors DeletePerson's own booking-history guard: refuse with a clear
// reason rather than surfacing the FK constraint violation the DB would
// otherwise raise (contract_role_defaults.role_id is a real FK too).
func (a *API) DeleteRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var inUse bool
	if err := a.DB.QueryRow(r.Context(),
		`SELECT EXISTS (SELECT 1 FROM person_roles WHERE role_id = $1)
		    OR EXISTS (SELECT 1 FROM job_requirements WHERE role_id = $1)
		    OR EXISTS (SELECT 1 FROM contract_role_defaults WHERE role_id = $1)`, id,
	).Scan(&inUse); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete role")
		return
	}
	if inUse {
		writeError(w, http.StatusConflict, "role is still assigned to people, used on job requirements, or used in a Contract's role defaults — remove those first")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM roles WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete role")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "role not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
