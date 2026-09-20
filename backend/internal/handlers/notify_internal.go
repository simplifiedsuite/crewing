package handlers

import (
	"context"
	"encoding/json"

	"ralto/internal/models"
	"ralto/internal/notify"
)

// notifyPerson records a Notification + its in-app NotificationDelivery, and
// additionally sends (and records) an email delivery when a.Notify is
// configured. This is the one place every one of the six trigger points
// (see internal/notify/templates.go) funnels through, so "add a channel
// later" (per the addendum's stated goal) only ever means adding one more
// delivery row here, not touching each call site.
//
// attachments — variadic, so the five other trigger points (which never
// attach anything) are unaffected; only booking_confirmed's buyout PDF
// (Addendum v3 §5) passes one.
func (a *API) notifyPerson(ctx context.Context, personID string, notifType models.NotificationType, payload map[string]string, emailSubject, emailBody string, attachments ...notify.Attachment) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	var notificationID string
	if err := a.DB.QueryRow(ctx,
		`INSERT INTO notifications (person_id, type, payload, organisation_id) VALUES ($1, $2, $3, $4) RETURNING id`,
		personID, notifType, string(payloadJSON), currentOrgID,
	).Scan(&notificationID); err != nil {
		return err
	}

	if _, err := a.DB.Exec(ctx,
		`INSERT INTO notification_deliveries (notification_id, channel, status, sent_at) VALUES ($1, 'in_app', 'delivered', now())`,
		notificationID,
	); err != nil {
		return err
	}

	if a.Notify == nil {
		return nil
	}

	// email is nullable (testing feedback Y: phone-only crew members) — no
	// email on file means no email channel to send through, same as if
	// a.Notify itself were unconfigured. The in-app delivery above already
	// recorded the notification either way.
	var email *string
	var firstName string
	var channelsJSON *string
	if err := a.DB.QueryRow(ctx, `SELECT email, first_name, notification_channels FROM people WHERE id = $1`, personID).Scan(&email, &firstName, &channelsJSON); err != nil {
		return err
	}
	if email == nil {
		return nil
	}
	// Bug fix — the crew Profile screen's own "Email" toggle
	// (notification_channels, written by UpdateMyProfile) was saved but
	// never read anywhere: every one of the six trigger points funnels
	// through here per this function's own comment, and this was the only
	// place that could have honoured it. Someone unchecking Email kept
	// getting emails regardless. Same default-on convention the crew form
	// itself uses (ProfileEditForm's `notifyEmail !== false`) — unset or
	// unparseable means on, only an explicit false turns it off.
	if !emailChannelEnabled(channelsJSON) {
		return nil
	}

	status := "sent"
	sendErr := a.Notify.SendEmail(*email, firstName, emailSubject, emailBody, attachments...)
	if sendErr != nil {
		status = "failed"
	}
	_, dbErr := a.DB.Exec(ctx,
		`INSERT INTO notification_deliveries (notification_id, channel, status, sent_at) VALUES ($1, 'email', $2, now())`,
		notificationID, status,
	)
	if dbErr != nil {
		return dbErr
	}
	return sendErr
}

// emailChannelEnabled mirrors ProfileEditForm's own read of the same field
// (`initialChannels.email !== false`) — null (never set), a malformed value,
// or an object with no "email" key all mean on; only an explicit false
// means someone actually turned it off.
func emailChannelEnabled(channelsJSON *string) bool {
	if channelsJSON == nil {
		return true
	}
	var channels struct {
		Email *bool `json:"email"`
	}
	if err := json.Unmarshal([]byte(*channelsJSON), &channels); err != nil {
		return true
	}
	if channels.Email == nil {
		return true
	}
	return *channels.Email
}
