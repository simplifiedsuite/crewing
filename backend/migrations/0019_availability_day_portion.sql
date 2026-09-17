-- Testing feedback S — a half-day (e.g. PM-only) Availability entry used
-- to render identically to a full-day one, with no structured way to say
-- "just the afternoon" at all. day_portion is a second axis alongside
-- status/type, same pattern as commitment (see 0004_pencil.sql): applies
-- to the whole entry's date range, not per-day — a scheduler wanting
-- AM-only Monday + PM-only Tuesday creates two entries, same granularity
-- Availability already has via start_date/end_date.

CREATE TYPE availability_day_portion AS ENUM ('full', 'am', 'pm');

ALTER TABLE availability ADD COLUMN day_portion availability_day_portion NOT NULL DEFAULT 'full';
