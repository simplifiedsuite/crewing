package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
	"ralto/internal/notify"
)

// Self-service freelancer offer response — Ralto Addendum v3 §2. A public,
// unauthenticated, token-based accept/decline flow that lives entirely
// outside the crew app's own login-gated RespondToOffer (crew_bookings.go)
// — that stays as the in-app path for a freelancer who happens to be
// logged in; this is the path the actual offer email uses.

const bookingResponseTokenTTL = 14 * 24 * time.Hour

// issueBookingResponseToken generates and stores a token for a freelancer
// booking that's about to get an offer email — called from CreateBooking's
// and PromoteBookingToOffer's Offered branches, never for staff (see those
// call sites: token issuance is itself the employment_type gate, so
// nothing downstream here needs to re-check it). Stored as plain text, not
// hashed like the password-reset tokens — unlike a password reset, the
// worst case of this token leaking is one job offer being accepted/
// declined on the freelancer's behalf, not account takeover, so this
// matches the existing plaintext-token precedent (people.calendar_feed_token,
// org_settings.dakboard_feed_token) rather than the higher-stakes one.
func (a *API) issueBookingResponseToken(ctx context.Context, bookingID string) (string, error) {
	token, err := randomToken(32)
	if err != nil {
		return "", err
	}
	if _, err := a.DB.Exec(ctx,
		`INSERT INTO booking_response_tokens (booking_id, token, expires_at) VALUES ($1, $2, $3)`,
		bookingID, token, time.Now().Add(bookingResponseTokenTTL),
	); err != nil {
		return "", err
	}
	return token, nil
}

// invalidateBookingResponseTokens marks every outstanding, unused token for
// a booking as used — called from every path that moves a booking away
// from Offered other than that booking's own token (RespondToBookingOffer
// marks its own token used as part of its own success path). Addendum v3
// §3: "if a scheduler manually records a response after an email has
// already gone out ... the outstanding token is invalidated" so a stale
// link lands on the "already handled" page, never a conflicting write.
func (a *API) invalidateBookingResponseTokens(ctx context.Context, bookingID string) error {
	_, err := a.DB.Exec(ctx,
		`UPDATE booking_response_tokens SET used_at = now() WHERE booking_id = $1 AND used_at IS NULL`,
		bookingID,
	)
	return err
}

func bookingResponseURL(token string) string {
	origin := os.Getenv("FRONTEND_ORIGIN")
	if origin == "" {
		origin = "http://localhost:5173"
	}
	return origin + "/respond/" + token
}

// offerCTAURL decides what an offer email's link actually points to.
// Freelancers get a token-issued public respond link (Addendum v3 §2 —
// "the token needs to actually reach the freelancer somehow, and this is
// that email"); anyone else falls back to the pre-existing crew-app link.
// Staff essentially never reach here (CreateBooking upgrades them straight
// to Confirmed), but PromoteBookingToOffer has no employment_type gate of
// its own, so a staff booking could in principle still reach Offered via
// Pencilled -> Offer — without a token issued for them, they keep their
// normal in-app link, unchanged.
func (a *API) offerCTAURL(ctx context.Context, bookingID, personID string) string {
	fallback := crewCTAURL("/offers/" + bookingID)
	var employmentType models.EmploymentType
	if err := a.DB.QueryRow(ctx, `SELECT employment_type FROM people WHERE id = $1`, personID).Scan(&employmentType); err != nil {
		return fallback
	}
	if employmentType != models.EmploymentTypeFreelancer {
		return fallback
	}
	token, err := a.issueBookingResponseToken(ctx, bookingID)
	if err != nil {
		log.Printf("offer cta: failed to issue booking response token for booking %s: %v", bookingID, err)
		return fallback
	}
	return bookingResponseURL(token)
}

// resolveDisplayRate — Booking.rate_override -> PersonRole.rate ->
// Person.standard_rate (Addendum v3 §4's resolution order), for the public
// offer page's own "what's this paying" line only. This is NOT the
// buyout-PDF generation stage (explicitly out of scope here, per addendum
// v3 Stage 2's own scope note) — just enough to show a freelancer what
// they're being asked to accept, which an Accept/Decline page can't
// meaningfully omit. No caching/reuse elsewhere: if the buyout stage needs
// this same chain again later, it gets its own copy there rather than this
// display-only helper growing into shared, PDF-facing logic.
func resolveDisplayRate(rateOverride *float64, personRoleRate *float64, personStandardRate *float64) *float64 {
	if rateOverride != nil {
		return rateOverride
	}
	if personRoleRate != nil {
		return personRoleRate
	}
	return personStandardRate
}

type bookingOfferPageResponse struct {
	Status       string   `json:"status"` // "valid" | "used" | "expired" | "not_found"
	RoleName     string   `json:"role_name,omitempty"`
	JobName      string   `json:"job_name,omitempty"`
	DatesText    string   `json:"dates_text,omitempty"`
	VenueName    string   `json:"venue_name,omitempty"`
	CallTime     *string  `json:"call_time,omitempty"`
	Rate         *float64 `json:"rate,omitempty"`
	RateCurrency *string  `json:"rate_currency,omitempty"`
}

// GetBookingOffer is the public, unauthenticated page-data read behind the
// emailed link's GET — deliberately read-only (see RespondToBookingOffer's
// own comment on why the action itself is POST-only). Never a 404/500 for
// a syntactically plausible token: the frontend always gets a 200 with a
// `status` field telling it which of the offer page / "already handled" /
// "expired" states to render, so a mail client or security scanner
// pre-fetching the GET can never produce a confusing error page for the
// freelancer who clicks it for real afterward.
func (a *API) GetBookingOffer(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	var bookingID string
	var usedAt, expiresAt *time.Time
	err := a.DB.QueryRow(r.Context(),
		`SELECT booking_id, used_at, expires_at FROM booking_response_tokens WHERE token = $1`, token,
	).Scan(&bookingID, &usedAt, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "not_found"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load offer")
		return
	}
	if usedAt != nil {
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "used"})
		return
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "expired"})
		return
	}

	var status string
	var roleName, jobName, datesText, venueName string
	var callTime *string
	var rateOverride, personRoleRate, standardRate *float64
	var rateCurrency *string
	err = a.DB.QueryRow(r.Context(), `
		SELECT b.status, ro.name, j.name,
		       to_char(b.start_date, 'DD Mon') || '–' || to_char(b.end_date, 'DD Mon'),
		       COALESCE(v.name, 'Venue TBC'), b.call_time,
		       b.rate_override, pr.rate, p.standard_rate, p.rate_currency
		FROM bookings b
		JOIN job_requirements jr ON jr.id = b.job_requirement_id
		JOIN jobs j ON j.id = jr.job_id
		JOIN roles ro ON ro.id = jr.role_id
		JOIN people p ON p.id = b.person_id
		LEFT JOIN venues v ON v.id = j.venue_id
		LEFT JOIN person_roles pr ON pr.person_id = b.person_id AND pr.role_id = jr.role_id
		WHERE b.id = $1`,
		bookingID,
	).Scan(&status, &roleName, &jobName, &datesText, &venueName, &callTime, &rateOverride, &personRoleRate, &standardRate, &rateCurrency)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load offer")
		return
	}
	// Belt-and-braces: a token can only reach here unused/unexpired, but the
	// booking itself may have moved on via a different channel a moment
	// before invalidateBookingResponseTokens caught up (or, defensively, if
	// it never should have but somehow didn't) — treat "not currently
	// Offered" the same as "already handled" either way.
	if status != "offered" {
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "used"})
		return
	}

	writeJSON(w, http.StatusOK, bookingOfferPageResponse{
		Status:       "valid",
		RoleName:     roleName,
		JobName:      jobName,
		DatesText:    datesText,
		VenueName:    venueName,
		CallTime:     callTime,
		Rate:         resolveDisplayRate(rateOverride, personRoleRate, standardRate),
		RateCurrency: rateCurrency,
	})
}

type respondToBookingOfferRequest struct {
	Response string `json:"response"` // "accept" | "decline"
}

// RespondToBookingOffer is the two-step confirmation's actual action —
// POST-only, deliberately: a bare GET must never action anything (mail
// clients and security scanners routinely pre-fetch links), so accept/
// decline only ever happens from an explicit button press on the page
// GetBookingOffer renders. Row-locks the token row for the duration of the
// transition, so two near-simultaneous requests for the same token (a
// double-click, or a scheduler recording a manual response at the same
// moment) can't both succeed.
func (a *API) RespondToBookingOffer(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	var req respondToBookingOfferRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var newStatus string
	switch req.Response {
	case "accept":
		newStatus = "pencilled"
	case "decline":
		newStatus = "declined"
	default:
		writeError(w, http.StatusBadRequest, "response must be accept or decline")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to respond to offer")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	var bookingID string
	var usedAt, expiresAt *time.Time
	err = tx.QueryRow(ctx,
		`SELECT booking_id, used_at, expires_at FROM booking_response_tokens WHERE token = $1 FOR UPDATE`, token,
	).Scan(&bookingID, &usedAt, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "not_found"})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to respond to offer")
		return
	}
	if usedAt != nil {
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "used"})
		return
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "expired"})
		return
	}

	tag, err := tx.Exec(ctx,
		`UPDATE bookings SET status = $1, responded_at = now(), response_channel = 'self_service' WHERE id = $2 AND status = 'offered'`,
		newStatus, bookingID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to respond to offer")
		return
	}
	if tag.RowsAffected() == 0 {
		// The booking moved on via a different channel between the GET and
		// this POST — same "already handled" outcome as a stale token.
		writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "used"})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE booking_response_tokens SET used_at = now() WHERE token = $1`, token); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to respond to offer")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to respond to offer")
		return
	}

	if newStatus == "pencilled" {
		bctx, ctxErr := a.loadBookingContext(ctx, bookingID)
		if ctxErr == nil {
			callTimeText := "TBC"
			if bctx.CallTime != nil {
				callTimeText = *bctx.CallTime
			}
			subject, body := notify.RenderBookingPencilled(bctx.RoleName, bctx.JobName, bctx.DatesText, bctx.Venue, callTimeText, crewCTAURL("/bookings/"+bookingID))
			_ = a.notifyPerson(ctx, bctx.PersonID, models.NotificationTypeBookingPencilled,
				map[string]string{"role": bctx.RoleName, "job_name": bctx.JobName, "dates": bctx.DatesText}, subject, body)
		}
	}

	writeJSON(w, http.StatusOK, bookingOfferPageResponse{Status: "responded"})
}
