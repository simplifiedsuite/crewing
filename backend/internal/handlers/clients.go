package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

const clientSelectColumns = `id, name, contact_name, contact_email, contact_phone, notes, brand_color_hex, website, core_client_id, created_at, updated_at`

func scanClient(row pgx.Row, c *models.Client) error {
	return row.Scan(&c.ID, &c.Name, &c.ContactName, &c.ContactEmail, &c.ContactPhone, &c.Notes, &c.BrandColorHex, &c.Website, &c.CoreClientID, &c.CreatedAt, &c.UpdatedAt)
}

func (a *API) ListClients(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(),
		`SELECT `+clientSelectColumns+` FROM clients WHERE organisation_id = $1 ORDER BY name`, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list clients")
		return
	}
	defer rows.Close()

	clients := []models.Client{}
	for rows.Next() {
		var c models.Client
		if err := scanClient(rows, &c); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list clients")
			return
		}
		clients = append(clients, c)
	}
	writeJSON(w, http.StatusOK, clients)
}

func (a *API) GetClient(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var c models.Client
	err := scanClient(a.DB.QueryRow(r.Context(),
		`SELECT `+clientSelectColumns+` FROM clients WHERE id = $1 AND organisation_id = $2`, id, currentOrgID,
	), &c)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "client not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get client")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

type clientWriteRequest struct {
	Name          string  `json:"name"`
	ContactName   *string `json:"contact_name"`
	ContactEmail  *string `json:"contact_email"`
	ContactPhone  *string `json:"contact_phone"`
	Notes         *string `json:"notes"`
	BrandColorHex *string `json:"brand_color_hex"`
	Website       *string `json:"website"`
}

func (a *API) CreateClient(w http.ResponseWriter, r *http.Request) {
	var req clientWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var c models.Client
	err := scanClient(a.DB.QueryRow(r.Context(),
		`INSERT INTO clients (name, contact_name, contact_email, contact_phone, notes, brand_color_hex, website, organisation_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		 RETURNING `+clientSelectColumns,
		req.Name, req.ContactName, req.ContactEmail, req.ContactPhone, req.Notes, req.BrandColorHex, req.Website, currentOrgID,
	), &c)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create client")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (a *API) UpdateClient(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req clientWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var c models.Client
	err := scanClient(a.DB.QueryRow(r.Context(),
		`UPDATE clients SET name = $1, contact_name = $2, contact_email = $3, contact_phone = $4,
		        notes = $5, brand_color_hex = $6, website = $7, updated_at = now()
		 WHERE id = $8 AND organisation_id = $9
		 RETURNING `+clientSelectColumns,
		req.Name, req.ContactName, req.ContactEmail, req.ContactPhone, req.Notes, req.BrandColorHex, req.Website, id, currentOrgID,
	), &c)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "client not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update client")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *API) DeleteClient(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM clients WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete client (it may still have jobs or projects)")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "client not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type linkCoreClientRequest struct {
	CoreClientID  string  `json:"core_client_id"`
	Name          string  `json:"name"`
	BrandColorHex *string `json:"brand_color_hex"`
	Website       *string `json:"website"`
}

// LinkCoreClient is the "confirm" step of Job creation's Client match:
// once a person has confirmed which Core Client a fetched name resolves
// to (whether pre-existing in Core or just created there), this finds or
// creates the local Ralto mirror row jobs.client_id actually needs — see
// docs/simplified_suite_core_v0_6.md §5's mirroring table (core_client_id
// + mirrored name/brand colour) and migrations/0009. Idempotent: calling
// this again for a core_client_id already mirrored just returns the
// existing local row unchanged, it never creates a duplicate.
//
// Testing feedback item M: the lookup below used to check only
// core_client_id, missing every client row seeded before that column
// existed — the original Stage 1 migration mirrored Core's Client by
// setting the local row's own `id` equal to Core's Client id directly
// (core_client_id left NULL), a different, older linking convention. Any
// of those legacy rows matched through this flow found no core_client_id
// match, fell through to the INSERT branch, and created a genuine
// duplicate every time (confirmed live: IMG (UFC), UEFA, and a "Man City
// Events" row all duplicated this way). Checking `id = $1` too covers
// both conventions.
func (a *API) LinkCoreClient(w http.ResponseWriter, r *http.Request) {
	var req linkCoreClientRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.CoreClientID == "" || req.Name == "" {
		writeError(w, http.StatusBadRequest, "core_client_id and name are required")
		return
	}

	var c models.Client
	err := scanClient(a.DB.QueryRow(r.Context(),
		`SELECT `+clientSelectColumns+` FROM clients WHERE (core_client_id = $1 OR id = $1) AND organisation_id = $2`,
		req.CoreClientID, currentOrgID,
	), &c)
	if err == nil {
		writeJSON(w, http.StatusOK, c)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to look up client")
		return
	}

	err = scanClient(a.DB.QueryRow(r.Context(),
		`INSERT INTO clients (name, brand_color_hex, website, core_client_id, organisation_id)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING `+clientSelectColumns,
		req.Name, req.BrandColorHex, req.Website, req.CoreClientID, currentOrgID,
	), &c)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create local client mirror")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}
