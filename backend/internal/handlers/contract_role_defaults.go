package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

// Contract-level defaults — a starting-point template of crew
// roles/quantities for a Core Contract, applied to a new Job's
// requirements when it's created under that Contract (see JobCreateForm's
// own wiring, client-side — this file is plain CRUD on the template
// itself). See migrations/0031_contract_role_defaults.sql.

// ListContractsWithRoleDefaults backs the "browse existing Contracts that
// already have defaults set" list on the Settings screen, so a scheduler
// can find and edit one without already knowing its name.
func (a *API) ListContractsWithRoleDefaults(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
		SELECT shared_contract_id, shared_contract_name, count(*)
		FROM contract_role_defaults
		WHERE organisation_id = $1
		GROUP BY shared_contract_id, shared_contract_name
		ORDER BY shared_contract_name`, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list contracts with defaults")
		return
	}
	defer rows.Close()

	contracts := []models.ContractWithRoleDefaults{}
	for rows.Next() {
		var c models.ContractWithRoleDefaults
		if err := rows.Scan(&c.SharedContractID, &c.SharedContractName, &c.DefaultCount); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list contracts with defaults")
			return
		}
		contracts = append(contracts, c)
	}
	writeJSON(w, http.StatusOK, contracts)
}

const contractRoleDefaultSelectColumns = `
	crd.id, crd.shared_contract_id, crd.shared_contract_name, crd.role_id, crd.quantity, crd.created_at, crd.updated_at,
	r.name, r.category`

func scanContractRoleDefault(row pgx.Row) (models.ContractRoleDefault, error) {
	var d models.ContractRoleDefault
	err := row.Scan(&d.ID, &d.SharedContractID, &d.SharedContractName, &d.RoleID, &d.Quantity, &d.CreatedAt, &d.UpdatedAt,
		&d.RoleName, &d.RoleCategory)
	return d, err
}

// ListContractRoleDefaults returns one Contract's role defaults, joined
// with the role's own name/category for display.
func (a *API) ListContractRoleDefaults(w http.ResponseWriter, r *http.Request) {
	sharedContractID := r.URL.Query().Get("shared_contract_id")
	if sharedContractID == "" {
		writeError(w, http.StatusBadRequest, "shared_contract_id is required")
		return
	}
	rows, err := a.DB.Query(r.Context(), `
		SELECT `+contractRoleDefaultSelectColumns+`
		FROM contract_role_defaults crd JOIN roles r ON r.id = crd.role_id
		WHERE crd.shared_contract_id = $1 AND crd.organisation_id = $2
		ORDER BY r.name`, sharedContractID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list role defaults")
		return
	}
	defer rows.Close()

	defaults := []models.ContractRoleDefault{}
	for rows.Next() {
		d, err := scanContractRoleDefault(rows)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list role defaults")
			return
		}
		defaults = append(defaults, d)
	}
	writeJSON(w, http.StatusOK, defaults)
}

type contractRoleDefaultWriteRequest struct {
	SharedContractID   string `json:"shared_contract_id"`
	SharedContractName string `json:"shared_contract_name"`
	RoleID             string `json:"role_id"`
	Quantity           int    `json:"quantity"`
}

// UpsertContractRoleDefault both adds a new role default and adjusts an
// existing one's quantity — ON CONFLICT keeps "add a role" and "adjust
// quantity" as the same one call, matching the UNIQUE(shared_contract_id,
// role_id) constraint's own "one row per role per Contract" shape.
func (a *API) UpsertContractRoleDefault(w http.ResponseWriter, r *http.Request) {
	var req contractRoleDefaultWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.SharedContractID == "" || req.SharedContractName == "" || req.RoleID == "" {
		writeError(w, http.StatusBadRequest, "shared_contract_id, shared_contract_name and role_id are required")
		return
	}
	if req.Quantity <= 0 {
		writeError(w, http.StatusBadRequest, "quantity must be greater than zero")
		return
	}

	var id string
	err := a.DB.QueryRow(r.Context(), `
		INSERT INTO contract_role_defaults (shared_contract_id, shared_contract_name, role_id, quantity, organisation_id)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (shared_contract_id, role_id) DO UPDATE
		    SET quantity = EXCLUDED.quantity, shared_contract_name = EXCLUDED.shared_contract_name, updated_at = now()
		RETURNING id`,
		req.SharedContractID, req.SharedContractName, req.RoleID, req.Quantity, currentOrgID,
	).Scan(&id)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to save role default: "+err.Error())
		return
	}

	d, err := scanContractRoleDefault(a.DB.QueryRow(r.Context(), `
		SELECT `+contractRoleDefaultSelectColumns+`
		FROM contract_role_defaults crd JOIN roles r ON r.id = crd.role_id
		WHERE crd.id = $1`, id))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "fetch after save failed")
		return
	}
	writeJSON(w, http.StatusCreated, d)
}

func (a *API) DeleteContractRoleDefault(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM contract_role_defaults WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete role default")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "role default not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
