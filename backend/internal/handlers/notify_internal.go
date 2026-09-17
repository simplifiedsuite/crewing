package handlers

import (
	"context"
	"encoding/json"

	"ralto/internal/models"
)

// notifyPerson records a Notification + its in-app NotificationDelivery, and
// additionally sends (and records) an email delivery when a.Notify is
// configured. This is the one place every one of the six trigger points
// (see internal/notify/templates.go) funnels through, so "add a channel
// later" (per the addendum's stated goal) only ever means adding one more
// delivery row here, not touching each call site.
func (a *API) notifyPerson(ctx context.Context, personID string, notifType models.NotificationType, payload map[string]string, emailSubject, emailBody string) error {
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
	if err := a.DB.QueryRow(ctx, `SELECT email, first_name FROM people WHERE id = $1`, personID).Scan(&email, &firstName); err != nil {
		return err
	}
	if email == nil {
		return nil
	}

	status := "sent"
	sendErr := a.Notify.SendEmail(*email, firstName, emailSubject, emailBody)
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
