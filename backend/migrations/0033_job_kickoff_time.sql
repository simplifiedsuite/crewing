-- Testing feedback #45 — a Job has per-booking call time (bookings.call_time)
-- but nothing at the Job level for the actual kick-off/on-air moment itself
-- (the match kicking off, the broadcast going live) — the thing every
-- individual call time is actually building towards. Nullable: most Jobs
-- won't have this set retroactively, same "TBC until someone enters it"
-- convention as every other optional time/date field in this schema.
ALTER TABLE jobs ADD COLUMN kick_off_time TIME;
