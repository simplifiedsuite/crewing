package handlers

import "net/http"

// DebugFrontendOrigin — temporary, admin-only. Exposes what the CTA-URL
// builders actually resolve to in this live process right now, so the
// FRONTEND_ORIGINS reordering (canonical domain moved first) can be
// confirmed against production. Delete once verified.
func (a *API) DebugFrontendOrigin(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"crew_cta":         crewCTAURL("/example"),
		"staff_cta":        staffCTAURL("/example"),
		"booking_response": bookingResponseURL("example-token"),
	})
}
