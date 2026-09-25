-- Testing feedback #63 — a scheduler previously had to keep re-checking a
-- Job to see if a freelancer had responded to an offer. Reuses the
-- existing operational_alerts mechanism (Today screen's "Needs
-- attention") rather than a new notification channel — same pattern as
-- unacknowledged_update/auto_suggested_booking, just a new alert_type.
-- Raised at both self-service accept paths (the crew app and the public
-- email-token link) — not the scheduler-manual "record their phone
-- response" path, since the scheduler is the one doing that recording
-- and already knows.
ALTER TYPE alert_type ADD VALUE 'freelancer_accepted';
