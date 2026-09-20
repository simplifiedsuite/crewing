package notify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
)

// Client is a minimal SendGrid v3 Mail Send wrapper — hand-rolled rather
// than pulling in SendGrid's Go SDK, since the API surface actually needed
// (one recipient, one subject, one HTML body) is a single small JSON POST.
// Mirrors Equiptra's own preference for talking to a REST API directly
// (internal/storage/supabase.go) over adding an SDK dependency for a
// narrow, well-documented endpoint.
type Client struct {
	apiKey    string
	fromEmail string
	fromName  string
	http      *http.Client
}

// NewClient returns nil if SENDGRID_API_KEY is unset — email notifications
// are then disabled rather than the app failing to boot, matching how
// Equiptra's storage/monday clients feature-gate on missing env vars.
func NewClient() *Client {
	apiKey := os.Getenv("SENDGRID_API_KEY")
	if apiKey == "" {
		return nil
	}
	fromEmail := os.Getenv("SENDGRID_FROM_EMAIL")
	if fromEmail == "" {
		fromEmail = "no-reply@ralto.io"
	}
	fromName := os.Getenv("SENDGRID_FROM_NAME")
	if fromName == "" {
		fromName = "Ralto"
	}
	return &Client{apiKey: apiKey, fromEmail: fromEmail, fromName: fromName, http: &http.Client{}}
}

type sendGridPayload struct {
	Personalizations []sendGridPersonalization `json:"personalizations"`
	From             sendGridAddress           `json:"from"`
	Subject          string                    `json:"subject"`
	Content          []sendGridContent         `json:"content"`
}

type sendGridPersonalization struct {
	To []sendGridAddress `json:"to"`
}

type sendGridAddress struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type sendGridContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// SendEmail sends a single HTML email. Errors are returned, not swallowed —
// callers decide whether a failed send should also mark the
// NotificationDelivery row as failed (it should).
func (c *Client) SendEmail(toEmail, toName, subject, htmlBody string) error {
	payload := sendGridPayload{
		Personalizations: []sendGridPersonalization{{To: []sendGridAddress{{Email: toEmail, Name: toName}}}},
		From:             sendGridAddress{Email: c.fromEmail, Name: c.fromName},
		Subject:          subject,
		Content:          []sendGridContent{{Type: "text/html", Value: htmlBody}},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshaling sendgrid payload: %w", err)
	}
	req, err := http.NewRequest(http.MethodPost, "https://api.sendgrid.com/v3/mail/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("building sendgrid request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("calling sendgrid: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		// SendGrid's error responses name the specific check that failed
		// (unverified sender, malformed key, etc.) — swallowing the body
		// down to just a status code was making a first real failure
		// impossible to diagnose from the caller side.
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("sendgrid returned status %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}
