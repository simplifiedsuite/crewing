-- Self-service "Forgot password" (crew-first). Deliberately its own table,
-- not a reuse of people.must_change_password — that flag/mechanism is for
-- an admin-triggered temp password (InviteToCrewApp) and stays exactly as
-- it is; this is a separate flow a person can trigger themselves, with its
-- own short expiry and single-use semantics that must_change_password has
-- no equivalent of.
--
-- token_hash, not the raw token: unlike calendar_feed_token (a long-lived,
-- low-sensitivity feed-access token stored in plaintext), a reset token is
-- briefly equivalent to full account takeover, so it's hashed (sha256) at
-- rest the same way a password would be — a DB read alone can't produce a
-- usable token. The handler looks rows up by hashing the token it receives
-- and comparing.
--
-- No partial unique index on (person_id) WHERE used_at IS NULL — a person
-- can have more than one outstanding unused token (e.g. they request a
-- second reset before using the first); ResetPassword invalidates all of a
-- person's other outstanding tokens once one is successfully used, rather
-- than the schema trying to enforce "at most one live token" up front.
CREATE TABLE password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id   UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_tokens_person_id ON password_reset_tokens (person_id);
