-- Self-service "Forgot password" for the scheduler/staff login — the same
-- flow migration 0022 added for crew, now extended to `users`. A separate
-- table rather than a shared one: password_reset_tokens is FK'd to
-- `people`, and staff/crew are already kept as fully separate tables
-- throughout this schema (users vs people, their own login handlers, their
-- own session cookies) rather than a shared identity table, so this
-- mirrors that same split instead of reworking 0022 into a dual-FK design.
-- See 0022's own comment for why token_hash (not the raw token) is stored.
CREATE TABLE staff_password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_password_reset_tokens_user_id ON staff_password_reset_tokens (user_id);
