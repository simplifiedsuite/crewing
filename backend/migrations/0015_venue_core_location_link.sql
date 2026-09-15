-- Testing feedback item J: venue/location syncing between Core and
-- Crewing was never actually built — the local `venues` table was seed
-- data (Etihad Campus/Arena, Olympic Stadium) that never connected to
-- Core at all, unlike Client (see 0009_core_client_and_contract_link.sql,
-- which this mirrors exactly).
--
-- Nullable, partial unique index — same shape as clients.core_client_id.
-- The 3 existing local-only rows stay NULL here (unlinked) rather than
-- being deleted: 21 real Jobs already reference them via jobs.venue_id,
-- and deleting them would either break that FK or silently blank out
-- real jobs' venue data. They remain selectable/editable locally; new
-- venue selection goes through Core from this point on.
ALTER TABLE venues ADD COLUMN core_location_id UUID;
CREATE UNIQUE INDEX idx_venues_core_location_id ON venues(core_location_id) WHERE core_location_id IS NOT NULL;
