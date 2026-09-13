-- Job Fetch-from-Monday, Stage A (see docs/simplified_suite_core_v0_6.md
-- §5/§5a/§8a). Two separate cross-service links, per that doc's own
-- decisions:
--
-- clients.core_client_id: the "products keep core_client_id + mirrored
-- name and brand colour" mirror row §5's table describes. name and
-- brand_color_hex already exist on this table (added inert, ahead of
-- Core existing, per 0001_init.sql's own comment) — only the link column
-- is new. Nullable: existing clients predate Core's Client entity and
-- have no Core identity yet; a client only gains one the first time it's
-- matched or created via this flow. Not a real FK (Core is a separate
-- database) — same convention as core_person_id.
--
-- jobs.shared_contract_id / shared_contract_name: §8a decided Core's
-- Contract is what a Job optionally links to directly (Ralto's own
-- pre-existing `projects` table is a different, unrelated concept per
-- that section and is untouched here — this is a new, separate column on
-- jobs, not a rename of projects.shared_project_id, which stays exactly
-- as it is until that separate migration is actually undertaken).
-- shared_contract_name is a point-in-time cached label (same "manual
-- fetch, no reconciliation" philosophy as the Monday integration itself,
-- per §5b) — not a live-refreshed mirror; re-picking a Contract via the
-- picker is how it's updated.

ALTER TABLE clients ADD COLUMN core_client_id UUID;
CREATE UNIQUE INDEX idx_clients_core_client_id ON clients(core_client_id) WHERE core_client_id IS NOT NULL;

ALTER TABLE jobs ADD COLUMN shared_contract_id UUID;
ALTER TABLE jobs ADD COLUMN shared_contract_name TEXT;
