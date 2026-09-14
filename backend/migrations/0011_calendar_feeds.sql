-- Surfaces the personal iCal feed (Person.calendar_feed_token already
-- existed, unused — see ralto_schema_addendum_v1.md §2) and adds a second,
-- genuinely separate org-wide feed for an internal Dakboard display.
--
-- The Dakboard feed is one shared link for the whole organisation, not
-- per-person, so it can't live on `people`. There's no `organisations`
-- table yet (Core owns that entity in future — see
-- internal/tenancy/tenancy.go), so this is a minimal one-row-per-org
-- settings table rather than a stray column bolted onto an unrelated
-- table. Today there's exactly one row, keyed by the same placeholder
-- organisation_id every other table already uses.
--
-- Token is nullable and generated on first request, same pattern as
-- Person.calendar_feed_token — never proactively created.
CREATE TABLE org_settings (
    organisation_id      UUID PRIMARY KEY,
    dakboard_feed_token  TEXT UNIQUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
