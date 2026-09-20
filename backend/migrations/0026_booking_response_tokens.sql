-- Ralto Addendum v3, Stage 2 §2 — the "decide at prompt time" piece v3
-- itself flagged: a dedicated table (its own expiry/single-use lifecycle),
-- not a field on Notification.
--
-- No organisation_id: the token itself is the sole authorization for the
-- public, unauthenticated GET/POST it backs (looked up by `token` alone,
-- nothing else supplied by the caller) — same shape as the existing bare-
-- token-is-the-authorization columns already in this schema
-- (people.calendar_feed_token, org_settings.dakboard_feed_token), not the
-- "row ID with an org-scoped parent" case docs/organisation_id_placeholder.md
-- carves out organisation_id for.
CREATE TABLE booking_response_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id  UUID NOT NULL REFERENCES bookings(id),
    token       TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ
);

CREATE INDEX idx_booking_response_tokens_booking_id ON booking_response_tokens (booking_id);
