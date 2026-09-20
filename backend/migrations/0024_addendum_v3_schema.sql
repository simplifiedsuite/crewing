-- Ralto Addendum v3, Stage 1 (schema only) — freelancer offer/pencil/
-- confirm flow, rate resolution, and buyout settings. This migration adds
-- only the columns/tables the schema layer needs; trigger wiring, email
-- templates, and PDF generation are separate later work (not touched here).
--
-- Naming/convention notes (checked against the actual schema rather than
-- assumed — see docs/organisation_id_placeholder.md):
--   - There is no real `organisation` table yet (Core, which will own it,
--     doesn't exist as a service). Every other domain table scopes itself
--     with a bare `organisation_id UUID NOT NULL` column, no FK, backfilled
--     with tenancy.PlaceholderOrganisationID. org_buyout_settings below
--     follows that exact convention instead of the org_id/REFERENCES
--     organisation(id) shape originally sketched for it.
--   - The Person entity's table is `people`, not `person` — confirmed_by
--     references that.
--   - notification_type is a genuine Postgres ENUM (not an app-level-only
--     constant), so booking_pencilled needs a real ALTER TYPE below.
--     booking_confirmed is NOT new — it's already in the enum
--     (0001_init.sql) and in models.NotificationType — so it's deliberately
--     not added again here.

-- --- Booking: response_channel, confirmed_by ---

-- Distinguishes a freelancer's own self-service response (once that flow
-- exists) from a scheduler recording a response on someone's behalf
-- (phone call, WhatsApp, etc.) — null until a response is actually
-- recorded, so every existing Booking row is unaffected.
CREATE TYPE booking_response_channel AS ENUM ('self_service', 'scheduler_manual');

ALTER TABLE bookings ADD COLUMN response_channel booking_response_channel;

-- Populated when a scheduler presses Confirm — the actual write path is
-- later work; this is just the column.
ALTER TABLE bookings ADD COLUMN confirmed_by UUID REFERENCES people(id);

-- --- PersonRole: standing per-role rate override ---

-- A person's rate can differ by which Role they're booked into (e.g. a
-- higher rate for a secondary/senior role) — this is the standing
-- override for that pairing. The actual resolution chain
-- (Booking.rate_override -> PersonRole.rate -> Person.standard_rate)
-- belongs with the later buyout-generation stage, not here. Same numeric
-- shape as people.standard_rate.
ALTER TABLE person_roles ADD COLUMN rate NUMERIC(10,2);

-- --- Notification: new type value ---

-- booking_confirmed already exists (0001_init.sql) — only booking_pencilled
-- is actually new. Postgres forbids using a value added by ALTER TYPE ...
-- ADD VALUE inside the same transaction that adds it; this migration only
-- adds the value; nothing in this file (or any single-migration-per-
-- transaction run of cmd/migrate) uses it.
ALTER TYPE notification_type ADD VALUE 'booking_pencilled';

-- --- OrgBuyoutSettings: one row per org, mostly nullable ---

-- Mirrors org_settings' one-row-per-organisation shape (0011_calendar_feeds.sql)
-- rather than inventing a new org-scoped-settings pattern. Every column
-- besides organisation_id is nullable on purpose — most orgs (i.e. today,
-- every org except LDM.tv, see the paired seed migration) won't have a
-- populated row yet, and every future read of this table has to treat
-- "no row" and "row with nulls" as equally normal, not exceptional.
-- payment_terms_days/invoice_window_days/cancellation_notice_hours carry
-- real DEFAULTs (30/180/48) per addendum v3 §5 — the one place this table
-- isn't "blank until configured": a brand-new org's row still gets sane
-- buyout terms for these three even before anyone's touched Settings, and
-- they happen to equal LDM.tv's own seeded values too.
CREATE TABLE org_buyout_settings (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id           UUID NOT NULL,
    company_legal_name        TEXT,
    billing_address           TEXT,
    invoice_email             TEXT,
    accounts_email            TEXT,
    operations_email          TEXT,
    rate_query_contact_name   TEXT,
    rate_query_contact_email  TEXT,
    accident_report_url       TEXT,
    payment_terms_days        INT DEFAULT 30,
    invoice_window_days       INT DEFAULT 180,
    cancellation_notice_hours INT DEFAULT 48,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX org_buyout_settings_organisation_id_idx ON org_buyout_settings (organisation_id);
