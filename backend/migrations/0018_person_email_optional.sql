-- Testing feedback Y — a crew profile shouldn't require an email address
-- if a phone number is on file. Drops NOT NULL only; the existing
-- UNIQUE(email) and UNIQUE(lower(email)) index (0005_case_insensitive_email.sql)
-- are unaffected — Postgres never treats two NULLs as a duplicate, so any
-- number of phone-only people can coexist with a null email.
-- CreatePerson/UpdatePerson enforce "email or phone, at least one" at the
-- handler level, same tier as this codebase's other app-level invariants
-- (e.g. booking_shifts coverage) rather than a DB CHECK constraint.

ALTER TABLE people ALTER COLUMN email DROP NOT NULL;
