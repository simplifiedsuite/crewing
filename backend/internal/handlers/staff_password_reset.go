package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"ralto/internal/notify"
)

// Self-service "Forgot password" for the scheduler/staff login — the same
// flow as crew_password_reset.go, ported to `users`/staff_password_reset_tokens
// (migration 0023). See that file's own comments for the reasoning behind
// the generic response, the token hashing, and the row-lock on confirm;
// none of it is repeated here. This is a separate flow alongside
// AdminResetPassword/must_change_password, which stays untouched.

func (a *API) RequestStaffPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req forgotPasswordRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	email := normalizeEmail(req.Email)
	if email != "" {
		var userID string
		err := a.DB.QueryRow(r.Context(), `SELECT id FROM users WHERE lower(email) = $1`, email).Scan(&userID)
		if err == nil {
			if sendErr := a.issueStaffPasswordResetToken(r.Context(), userID); sendErr != nil {
				log.Printf("staff password reset: failed to issue token for user %s: %v", userID, sendErr)
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			log.Printf("staff password reset: lookup failed: %v", err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": forgotPasswordResponseMessage})
}

// issueStaffPasswordResetToken — users.email is NOT NULL (unlike people's,
// which testing feedback Y made optional), so there's no "person has no
// email" no-op case to handle here, only "SendGrid isn't configured."
func (a *API) issueStaffPasswordResetToken(ctx context.Context, userID string) error {
	var email, name string
	if err := a.DB.QueryRow(ctx, `SELECT email, name FROM users WHERE id = $1`, userID).Scan(&email, &name); err != nil {
		return err
	}
	if a.Notify == nil {
		return nil
	}

	token, err := randomToken(32)
	if err != nil {
		return err
	}
	hash := hashResetToken(token)
	expiresAt := time.Now().Add(passwordResetTokenTTL)
	if _, err := a.DB.Exec(ctx,
		`INSERT INTO staff_password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, hash, expiresAt,
	); err != nil {
		return err
	}

	resetURL := staffCTAURL("/reset-password?token=" + token)
	subject, body := notify.RenderPasswordReset(resetURL)
	return a.Notify.SendEmail(email, name, subject, body)
}

func (a *API) ConfirmStaffPasswordReset(w http.ResponseWriter, r *http.Request) {
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

	var userID string
	err = tx.QueryRow(ctx,
		`SELECT user_id FROM staff_password_reset_tokens
		 WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		 FOR UPDATE`,
		hashResetToken(req.Token),
	).Scan(&userID)
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
		`UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2`,
		string(newHash), userID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "password reset failed")
		return
	}
	if _, err := tx.Exec(ctx,
		`UPDATE staff_password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
		userID,
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
