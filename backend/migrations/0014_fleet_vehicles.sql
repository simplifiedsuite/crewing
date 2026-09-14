-- Testing feedback batch, item G: a company fleet vehicle list, separate
-- from the personal vehicle_registration added to Person (item F,
-- migrations/0013). "Fleet" here means Ralto's own kit — e.g. "Transit
-- Van 1" — assignable to Jobs, not anyone's personal car.
CREATE TABLE vehicles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id     UUID NOT NULL,
    name                TEXT NOT NULL,   -- e.g. "Transit Van 1"
    registration        TEXT NOT NULL,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: "one or more fleet vehicles" per Job. No organisation_id
-- here — reachable only via job_id, which is already organisation-scoped,
-- same exclusion already established for job_contacts (see
-- migrations/0006_organisation_id.sql's own list of deliberate exclusions).
CREATE TABLE job_vehicles (
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    vehicle_id  UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    PRIMARY KEY (job_id, vehicle_id)
);
