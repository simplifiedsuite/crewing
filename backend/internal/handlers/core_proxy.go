package handlers

import (
	"bytes"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"ralto/internal/middleware"
)

var coreProxyClient = &http.Client{Timeout: 10 * time.Second}

// proxyToCore forwards the caller's own suite_session cookie to a GET on
// Core's API and relays Core's response (status + body) back verbatim.
// Used for every read this Job "Fetch from Monday" flow needs from Core —
// Monday lookup, and the live Client/Contract lists §5a's picker rule
// requires — so a single Core-side auth/response shape only needs
// handling once here rather than once per proxying handler.
func (a *API) proxyToCore(w http.ResponseWriter, r *http.Request, path string) {
	base := middleware.CoreAPIURL()
	if base == "" {
		writeError(w, http.StatusServiceUnavailable, "Simplified Suite Core isn't configured (CORE_API_URL not set)")
		return
	}
	suiteCookie, err := r.Cookie(middleware.CoreSessionCookieName)
	if err != nil || suiteCookie.Value == "" {
		writeError(w, http.StatusServiceUnavailable, "not signed in to Simplified Suite")
		return
	}

	var bodyReader io.Reader
	if r.Method != http.MethodGet {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, base+path, bodyReader)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not reach Simplified Suite Core")
		return
	}
	req.AddCookie(&http.Cookie{Name: middleware.CoreSessionCookieName, Value: suiteCookie.Value})
	if r.Method != http.MethodGet {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := coreProxyClient.Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not reach Simplified Suite Core")
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusBadGateway, "could not reach Simplified Suite Core")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(body)
}

// MondayProjectLookup backs "Fetch from Monday" on Job creation/editing —
// same proxy pattern Equipment's own (equivalent) handler uses: Core owns
// the Monday.com credential, this just forwards the session and relays the
// response. See Simplified_Suite_Product_Structure_v1_0.pdf's decision and
// Equiptra's monday_lookup.go for the pattern this mirrors.
func (a *API) MondayProjectLookup(w http.ResponseWriter, r *http.Request) {
	orderNumber := strings.TrimSpace(r.URL.Query().Get("order_number"))
	if orderNumber == "" {
		writeError(w, http.StatusBadRequest, "order_number is required")
		return
	}
	a.proxyToCore(w, r, "/api/integrations/monday/project-lookup?order_number="+url.QueryEscape(orderNumber))
}

// ListCoreClients backs the Job "match this client against Core" step —
// live per docs/simplified_suite_core_v0_6.md §5a's picker rule ("any
// picker or list view... pulls the current list live from core"), not
// read from Ralto's own local mirror.
func (a *API) ListCoreClients(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/clients")
}

// CreateCoreClient proxies a "no match — create a new Client" request
// straight to Core's own POST /api/clients. Core enforces who's allowed to
// do this (organisation owner only, per Core's own RequireOwner) — Ralto
// doesn't duplicate that check, it just relays whatever Core decides,
// including a 403 for a non-owner scheduler.
func (a *API) CreateCoreClient(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/clients")
}

// ListCoreContracts backs the Job "Link to a Contract?" picker, scoped to
// the resolved Client (required — an unscoped org-wide list isn't what any
// caller here wants). Live per §5a, same as ListCoreClients.
func (a *API) ListCoreContracts(w http.ResponseWriter, r *http.Request) {
	clientID := strings.TrimSpace(r.URL.Query().Get("client_id"))
	if clientID == "" {
		writeError(w, http.StatusBadRequest, "client_id is required")
		return
	}
	a.proxyToCore(w, r, "/api/contracts?client_id="+url.QueryEscape(clientID))
}

// GetCoreJobByOrderNumber is the "check Core first" step of the shared Job
// entity (see Core's own migrations/0008_jobs.sql): an order number is a
// real, exact, unique identifier — unlike Client name, so this is a
// straight lookup, no matching/confirmation involved. 404 means no
// product has fetched this order number before; fall through to the
// existing Monday-fetch + Client match/Contract-picker flow, unchanged.
func (a *API) GetCoreJobByOrderNumber(w http.ResponseWriter, r *http.Request) {
	orderNumber := strings.TrimSpace(r.URL.Query().Get("order_number"))
	if orderNumber == "" {
		writeError(w, http.StatusBadRequest, "order_number is required")
		return
	}
	a.proxyToCore(w, r, "/api/jobs?order_number="+url.QueryEscape(orderNumber))
}

// CreateCoreJob persists a shared Job once this product has already run
// the existing Client match/confirm (and optional Contract picker) flow —
// called only on the "Core doesn't have this order number yet" path, right
// before creating the local Job, so the next fetch (from either product)
// finds it immediately.
func (a *API) CreateCoreJob(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/jobs")
}

// RefreshCoreJob is the explicit "re-check Monday" action on an already-
// found shared Job — the everyday fetch path never calls Monday at all
// once Core already has the order number; only this does.
func (a *API) RefreshCoreJob(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	a.proxyToCore(w, r, "/api/jobs/"+url.PathEscape(id)+"/refresh")
}

// ListCoreLocations backs the Job Venue picker — live per §5a's picker
// rule, same pattern as ListCoreClients. Note: Core's /api/locations group
// is RequireOwner-gated in its entirety (unlike /api/clients, where only
// Create/Update are gated), so this will 403 for a non-owner scheduler's
// session — that's a Core-side constraint this proxy just relays, not one
// Ralto works around.
func (a *API) ListCoreLocations(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/locations")
}

// CreateCoreLocation proxies a "no match — create a new Location" request
// straight to Core's own POST /api/locations, same relay-only pattern as
// CreateCoreClient.
func (a *API) CreateCoreLocation(w http.ResponseWriter, r *http.Request) {
	a.proxyToCore(w, r, "/api/locations")
}
