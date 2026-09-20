package notify

import "fmt"

// The six crew-facing notification triggers, as fixed skeletons with named
// variables — per ralto_notification_templates_v1.md. Written once here so
// email today and WhatsApp later are two renderings of the same definition,
// not two separate things to maintain (the doc's own stated goal).
//
// Each Render* function returns (subject, htmlBody) for SendGrid. The plain
// {role}/{job_name}/etc. placeholders in the doc's email copy are filled in
// directly — no separate templating engine needed for a handful of fixed
// strings.

func RenderBookingOffered(role, jobName, dates, ctaURL string) (subject, body string) {
	subject = fmt.Sprintf("New offer: %s on %s", role, jobName)
	body = fmt.Sprintf(
		`You've been offered %s on %s, %s. <a href="%s">Open Ralto to accept or decline</a>.`,
		role, jobName, dates, ctaURL,
	)
	return subject, body
}

func RenderBookingConfirmed(role, jobName, dates, ctaURL string) (subject, body string) {
	subject = fmt.Sprintf("Confirmed: %s on %s", role, jobName)
	body = fmt.Sprintf(
		`You're confirmed for %s on %s, %s. <a href="%s">Open Ralto for full shift details and call times</a>.`,
		role, jobName, dates, ctaURL,
	)
	return subject, body
}

// RenderBookingPencilled — Addendum v3 §1/§4: the informal "you said yes"
// hold notice, once a freelancer has responded (either path) but before a
// scheduler presses Confirm. Deliberately more detailed inline than
// RenderBookingOffered/RenderBookingConfirmed (which lean on "open Ralto
// for details") — no rate, no buyout, no PDF, per the addendum's own
// explicit exclusions for this one.
func RenderBookingPencilled(role, jobName, dates, venue, callTime, ctaURL string) (subject, body string) {
	subject = fmt.Sprintf("You're pencilled: %s on %s", role, jobName)
	body = fmt.Sprintf(
		`You're pencilled for %s on %s, %s at %s (call time %s). This is an informal hold — a scheduler will confirm once everything's settled. <a href="%s">Open Ralto for details</a>.`,
		role, jobName, dates, venue, callTime, ctaURL,
	)
	return subject, body
}

func RenderBookingUpdated(jobName, changeDescription, ctaURL string) (subject, body string) {
	subject = fmt.Sprintf("Update: %s", jobName)
	body = fmt.Sprintf(`%s. <a href="%s">Open Ralto to review and acknowledge</a>.`, changeDescription, ctaURL)
	return subject, body
}

func RenderBookingCancelled(role, jobName, dates string) (subject, body string) {
	subject = fmt.Sprintf("Cancelled: %s on %s", role, jobName)
	body = fmt.Sprintf("%s on %s (%s) has been cancelled.", role, jobName, dates)
	return subject, body
}

func RenderShiftReminder(jobName, callTime, venue, ctaURL string) (subject, body string) {
	subject = fmt.Sprintf("Reminder: %s today", jobName)
	body = fmt.Sprintf(
		`Call time %s at %s. <a href="%s">Open Ralto for full details</a>.`,
		callTime, venue, ctaURL,
	)
	return subject, body
}

func RenderAvailabilityRequest(dates, location, ctaURL string) (subject, body string) {
	subject = fmt.Sprintf("Availability check: %s", dates)
	body = fmt.Sprintf(
		`Are you available %s for %s? <a href="%s">Respond via Ralto</a>.`,
		dates, location, ctaURL,
	)
	return subject, body
}

// RenderPasswordReset — self-service "Forgot password" (crew-first, see
// ralto_password_reset_v1). Deliberately outside the six triggers above:
// a reset link isn't an in-app notification a person can toggle off via
// notification_channels, so it's sent directly via notify.Client.SendEmail
// rather than through notifyPerson.
func RenderPasswordReset(resetURL string) (subject, body string) {
	subject = "Reset your Crewing password"
	body = fmt.Sprintf(
		`We received a request to reset your Crewing password. <a href="%s">Choose a new password</a>. This link expires in 1 hour and can only be used once. If you didn't request this, you can safely ignore this email.`,
		resetURL,
	)
	return subject, body
}
