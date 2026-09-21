package handlers

import (
	"net/http"
	"os"
	"strings"

	"ralto/internal/notify"
)

// DebugEmailTemplates — temporary, admin-only. Renders every real email
// template (the actual notify.Render* functions, not a reimplementation)
// with sample args, plus the resolved SendGrid from-name, so the
// Ralto->Crewing text rename can be confirmed against the live process
// rather than just the source file. Delete once verified.
func (a *API) DebugEmailTemplates(w http.ResponseWriter, r *http.Request) {
	out := map[string]string{}

	const cta = "https://example.invalid/example"

	subj, body := notify.RenderBookingOffered("Rigger", "Test Job", "1-2 Oct", cta)
	out["booking_offered_subject"] = subj
	out["booking_offered_body"] = body

	subj, body = notify.RenderBookingConfirmed("Rigger", "Test Job", "1-2 Oct", cta)
	out["booking_confirmed_subject"] = subj
	out["booking_confirmed_body"] = body

	subj, body = notify.RenderBookingPencilled("Rigger", "Test Job", "1-2 Oct", "Test Venue", "08:00", cta)
	out["booking_pencilled_subject"] = subj
	out["booking_pencilled_body"] = body

	subj, body = notify.RenderBookingUpdated("Test Job", "Call time changed", cta)
	out["booking_updated_subject"] = subj
	out["booking_updated_body"] = body

	subj, body = notify.RenderShiftReminder("Test Job", "08:00", "Test Venue", cta)
	out["shift_reminder_subject"] = subj
	out["shift_reminder_body"] = body

	subj, body = notify.RenderAvailabilityRequest("1-2 Oct", "Test Venue", cta)
	out["availability_request_subject"] = subj
	out["availability_request_body"] = body

	subj, body = notify.RenderPasswordReset("https://example.invalid/reset")
	out["password_reset_subject"] = subj
	out["password_reset_body"] = body

	// Same resolution NewClient() uses, so this reflects the live env var,
	// not just the code default.
	fromName := os.Getenv("SENDGRID_FROM_NAME")
	if fromName == "" {
		fromName = "Crewing"
	}
	out["from_name_env_raw"] = os.Getenv("SENDGRID_FROM_NAME")
	out["from_name_resolved"] = fromName
	out["contains_ralto"] = "false"
	for _, v := range out {
		if strings.Contains(strings.ToLower(v), "ralto") {
			out["contains_ralto"] = "true"
			break
		}
	}

	writeJSON(w, http.StatusOK, out)
}
