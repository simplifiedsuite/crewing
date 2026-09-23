-- Backfill — six tables (job_day_labels, password_reset_tokens,
-- staff_password_reset_tokens, org_buyout_settings,
-- booking_response_tokens, job_core_vehicles) shipped in their own
-- migrations without the `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` line
-- their CREATE TABLE should have carried per CLAUDE.md's standing
-- convention, and were only caught later by Supabase's security advisor.
-- RLS was already enabled directly against the live database as an
-- out-of-band fix once the gap was found — this migration exists purely
-- so migration history matches reality instead of silently understating
-- it, not because anything is still exposed. ENABLE ROW LEVEL SECURITY is
-- idempotent (a no-op re-running it on a table that already has it on),
-- so this is safe to apply on top of the already-fixed live database.
ALTER TABLE job_day_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_buyout_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_response_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_core_vehicles ENABLE ROW LEVEL SECURITY;
