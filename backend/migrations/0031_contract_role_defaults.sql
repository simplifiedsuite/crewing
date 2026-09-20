-- Contract-level defaults, Crewing side: a starting-point template of
-- crew roles/quantities for a Core Contract, applied to a new Job created
-- under it. Keyed by shared_contract_id — a bare UUID, no FK (Core is a
-- separate database), same convention as job_core_vehicles.core_vehicle_id
-- and Job.shared_contract_name. shared_contract_name is cached at the time
-- a default is set, same "not live-refreshed" philosophy as everywhere
-- else this pattern is used — re-picking is how it's updated.
--
-- One row per role default per Contract: UNIQUE(shared_contract_id,
-- role_id) so "adjust quantity" is a plain upsert, not a second row.
CREATE TABLE contract_role_defaults (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shared_contract_id    UUID NOT NULL,
    shared_contract_name  TEXT NOT NULL,
    role_id               UUID NOT NULL REFERENCES roles(id),
    quantity              INTEGER NOT NULL CHECK (quantity > 0),
    organisation_id       UUID NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (shared_contract_id, role_id)
);

CREATE INDEX idx_contract_role_defaults_shared_contract_id ON contract_role_defaults(shared_contract_id);

ALTER TABLE contract_role_defaults ENABLE ROW LEVEL SECURITY;
