package handlers

import (
	"context"
	"errors"
	"net/http"
	"os"

	"github.com/jackc/pgx/v5"

	"ralto/internal/middleware"
)

// --- Crew-facing: a person's own feed ---

// GetMyCalendarFeed returns the calling crew member's own feed URL,
// generating a token on first request — tokens are never created
// proactively for everyone, only when a person actually views this screen
// (ralto_schema_addendum_v1.md §2). Later views reuse the same token/URL
// until an explicit regenerate.
func (a *API) GetMyCalendarFeed(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())

	var token *string
	if err := a.DB.QueryRow(r.Context(),
		`SELECT calendar_feed_token FROM people WHERE id = $1 AND organisation_id = $2`,
		claims.PersonID, currentOrgID,
	).Scan(&token); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load calendar feed")
		return
	}

	if token == nil {
		issued, err := a.issuePersonCalendarFeedToken(r.Context(), claims.PersonID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate calendar feed")
			return
		}
		token = &issued
	}
	writeJSON(w, http.StatusOK, map[string]string{"feed_url": personFeedURL(*token)})
}

// RegenerateMyCalendarFeed replaces the crew member's own token — the old
// URL stops resolving immediately (see issuePersonCalendarFeedToken).
func (a *API) RegenerateMyCalendarFeed(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	token, err := a.issuePersonCalendarFeedToken(r.Context(), claims.PersonID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to regenerate calendar feed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"feed_url": personFeedURL(token)})
}

// --- Scheduler-facing: one shared, org-wide Dakboard feed ---
//
// Deliberately separate from the per-person feed above: one link for the
// whole organisation (not personalised), covering Booked/firm-commitment
// Jobs and their Confirmed crew only, meant to be pinned into an internal
// Dakboard display rather than handed to any individual. See the org-wide
// feed decision in the Job Fetch-from-Monday/calendar-feed work — this is
// a superseding, explicit exception to ralto_schema_addendum_v1.md §2's
// original "no scheduler-wide feed for v1" call.

// issueDakboardFeedToken generates a fresh token and upserts the
// single org_settings row — there's no Organisation entity locally yet
// (see internal/tenancy), so this is a one-row-per-organisation settings
// table keyed on the same placeholder organisation_id every other table
// uses, rather than a real Organisation foreign key.
func (a *API) issueDakboardFeedToken(ctx context.Context) (string, error) {
	token, err := randomToken(24)
	if err != nil {
		return "", err
	}
	_, err = a.DB.Exec(ctx, `
		INSERT INTO org_settings (organisation_id, dakboard_feed_token, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (organisation_id) DO UPDATE SET dakboard_feed_token = $2, updated_at = now()`,
		currentOrgID, token,
	)
	if err != nil {
		return "", err
	}
	return token, nil
}

// dakboardFeedURL renders the public URL for the org-wide feed — a
// distinct sidecar route (/feed/dakboard/{token}.ics) from the per-person
// one, so the two feeds can never be confused for each other by a caller
// that only has a token and no other context.
func dakboardFeedURL(token string) string {
	return os.Getenv("ICAL_FEED_BASE_URL") + "/dakboard/" + token + ".ics"
}

// GetDakboardFeed returns the org's shared Dakboard feed URL, generating
// the token on first request (same "generated on first request" rule as
// the per-person feed).
func (a *API) GetDakboardFeed(w http.ResponseWriter, r *http.Request) {
	var token *string
	err := a.DB.QueryRow(r.Context(),
		`SELECT dakboard_feed_token FROM org_settings WHERE organisation_id = $1`, currentOrgID,
	).Scan(&token)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to load dakboard feed")
		return
	}

	if token == nil {
		issued, err := a.issueDakboardFeedToken(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate dakboard feed")
			return
		}
		token = &issued
	}
	writeJSON(w, http.StatusOK, map[string]string{"feed_url": dakboardFeedURL(*token)})
}

// RegenerateDakboardFeed replaces the org-wide token — the old Dakboard
// link stops resolving immediately, matching the per-person feed's own
// regenerate semantics.
func (a *API) RegenerateDakboardFeed(w http.ResponseWriter, r *http.Request) {
	token, err := a.issueDakboardFeedToken(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to regenerate dakboard feed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"feed_url": dakboardFeedURL(token)})
}
