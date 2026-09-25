package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"ralto/internal/notify"
)

// Self-service "Forgot password" (crew-first) — a separate flow alongside
// people.must_change_password/InviteToCrewApp, not a replacement. That
// mechanism is admin-triggered (a scheduler hands someone a temp password
// directly, see people.go's InviteToCrewApp); this one a crew member
// triggers themselves, via a time-limited, single-use token tied to a
// specific reset request (password_reset_tokens, migration 0022) rather
// than anything stored on the people row itself.

const passwordResetTokenTTL = time.Hour

type forgotPasswordRequest struct {
	Email string `json:"email"`
}

// forgotPasswordResponseMessage is returned identically whether or not the
// email matches an account — CrewLogin already treats "no such account" and
// "account has no crew-app access yet" as indistinguishable, for the same
// reason (see its own comment); a reset-request endpoint that responded
// differently for each case would just reopen the same enumeration hole
// through a different door.
const forgotPasswordResponseMessage = "If that email has an account, we've sent a link to reset your password."

// RequestCrewPasswordReset issues a reset token and emails it — or does
// nothing at all — but responds identically either way.
func (a *API) RequestCrewPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	email := normalizeEmail(req.Email)
	if email != "" {
		var personID string
		var passwordHash *string
		err := a.DB.QueryRow(r.Context(),
			`SELECT id, password_hash FROM people WHERE lower(email) = $1`, email,
		).Scan(&personID, &passwordHash)
		// Same collapse as CrewLogin: no row, or a row that's never had
		// crew-app login enabled (password_hash still null), both look
		// like "nothing to do here" from the outside.
		if err == nil && passwordHash != nil {
			if sendErr := a.issuePasswordResetToken(r.Context(), personID); sendErr != nil {
				// Logged server-side only (a transient DB/SendGrid error) —
				// the response to the caller must stay generic regardless,
				// so a failure here can't be used to distinguish a real
				// account from a fake one either.
				log.Printf("password reset: failed to issue token for person %s: %v", personID, sendErr)
			}
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("password reset: lookup failed: %v", err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": forgotPasswordResponseMessage})
}

// issuePasswordResetToken generates the token, stores its hash, and emails
// the raw token to the person's own address — looked up fresh here rather
// than passed in from the caller, so nothing upstream can redirect where
// it gets sent. A no-op (not an error) when the person has no email on
// file (testing feedback Y: crew can be phone-only) or SendGrid isn't
// configured — either way there's genuinely nothing to send.
func (a *API) issuePasswordResetToken(ctx context.Context, personID string) error {
	var email *string
	var firstName string
	if err := a.DB.QueryRow(ctx, `SELECT email, first_name FROM people WHERE id = $1`, personID).Scan(&email, &firstName); err != nil {
		return err
	}
	if email == nil || a.Notify == nil {
		return nil
	}

	token, err := randomToken(32)
	if err != nil {
		return err
	}
	hash := hashResetToken(token)
	expiresAt := time.Now().Add(passwordResetTokenTTL)
	if _, err := a.DB.Exec(ctx,
		`INSERT INTO password_reset_tokens (person_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		personID, hash, expiresAt,
	); err != nil {
		return err
	}

	resetURL := crewCTAURL("/reset-password?token=" + token)
	subject, body := notify.RenderPasswordReset(resetURL)
	return a.Notify.SendEmail(*email, firstName, subject, body, nil)
}

func hashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

type resetPasswordRequest struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// ConfirmCrewPasswordReset validates the token (unexpired, unused),
// applies the new password, and invalidates it — along with any other
// outstanding tokens for the same person (see migration 0022's own
// comment on why a person can have more than one live token, and why
// using any one of them retires all of them).
func (a *API) ConfirmCrewPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req resetPasswordRequest
	if err := readJSON(r, &req); err != nil || req.Token == "" {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.NewPassword) < 8 {
		writeError(w, http.StatusBadRequest, "new password must be at least 8 characters")
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	var personID string
	// FOR UPDATE — closes the race between two concurrent requests both
	// reading the same still-unused token before either has a chance to
	// mark it used, which would otherwise let it be spent twice.
	err = tx.QueryRow(ctx,
		`SELECT person_id FROM password_reset_tokens
		 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		 FOR UPDATE`,
		hashResetToken(req.Token),
	).Scan(&personID)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusBadRequest, "this reset link is invalid or has expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE people SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2`,
		string(newHash), personID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE password_reset_tokens SET used_at = now() WHERE person_id = $1 AND used_at IS NULL`,
		personID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
