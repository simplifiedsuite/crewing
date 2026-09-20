package handlers

import "net/http"

// TEMPORARY — added only to confirm SENDGRID_API_KEY (just set on ralto-api
// for the first time) actually sends real mail, before building the
// password-reset flow on top of it. Admin-only, sends a fixed message to a
// caller-supplied address (never a stored Person/User row), so there's no
// enumeration or spam-relay surface. Remove once verified — see the
// forgot-password work this precedes.
type sendTestEmailRequest struct {
	ToEmail string `json:"to_email"`
}

func (a *API) SendTestEmail(w http.ResponseWriter, r *http.Request) {
	if a.Notify == nil {
		writeError(w, http.StatusServiceUnavailable, "SENDGRID_API_KEY is not set")
		return
	}
	var req sendTestEmailRequest
	if err := readJSON(r, &req); err != nil || req.ToEmail == "" {
		writeError(w, http.StatusBadRequest, "to_email is required")
		return
	}
	fromEmail, fromName, keyPrefix, keyLen := a.Notify.DebugInfo()
	debug := map[string]interface{}{"from_email": fromEmail, "from_name": fromName, "key_prefix": keyPrefix, "key_len": keyLen}
	if err := a.Notify.SendEmail(req.ToEmail, "", "Ralto SendGrid test", "This is a one-off test send confirming SendGrid delivery is working."); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]interface{}{"error": "sendgrid send failed: " + err.Error(), "debug": debug})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"sent": true, "debug": debug})
}
