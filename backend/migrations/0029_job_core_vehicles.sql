-- Shared Vehicle addendum, Stage 3: Job vehicle assignment now points at
-- Core's shared Vehicle (see Core's migrations/0009_vehicles.sql) instead
-- of Ralto's own local `vehicles` table. No local mirror row — same
-- direct-cache pattern jobs.shared_contract_id/shared_contract_name
-- already use for Contract (migrations/0009_core_client_and_contract_link.sql):
-- core_vehicle_id is a bare UUID (no FK — Core is a separate database),
-- vehicle_name/registration are a point-in-time cached label for display,
-- not live-refreshed — re-picking is how it's updated, matching Contract's
-- own "cached label, not live-refreshed" philosophy exactly.
--
-- Many-to-many, same shape as the job_vehicles table it replaces (a Job
-- can have more than one vehicle).
CREATE TABLE job_core_vehicles (
    job_id           UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    core_vehicle_id  UUID NOT NULL,
    vehicle_name     TEXT NOT NULL,
    registration     TEXT NOT NULL,
    PRIMARY KEY (job_id, core_vehicle_id)
);

-- Migrate the 3 real existing job_vehicles assignments (Rugby Super League
-- - Warrington Wolves v Hull KR: Tender/T16 TSV, Scanner/T16 LDM,
-- Edit/V16 LDM) to their Core Vehicle ids, matched by registration since
-- that's how Stage 1 (Core's migrations/0009_vehicles.sql) migrated the
-- same 5 real vehicles in the first place. vehicles.id -> Core Vehicle id
-- mapping is hardcoded here (not looked up live) since this is a one-time,
-- known-real-data migration, same convention as 0025's LDM buyout seed.
INSERT INTO job_core_vehicles (job_id, core_vehicle_id, vehicle_name, registration)
SELECT jv.job_id,
       CASE v.registration
           WHEN 'V16 LDM'  THEN '46e1f1f9-7d11-4197-83dc-bcd62863be3e'
           WHEN 'P100 LDM' THEN '7142bc3e-c9f8-4453-aace-08f4e468fdb3'
           WHEN 'T16 LDM'  THEN 'b8eb7bcf-b162-4698-9c9a-5da52b73fce9'
           WHEN '9 LDM'    THEN '41c191cf-a684-4143-83eb-f138413b97c0'
           WHEN 'T16 TSV'  THEN '0014d31f-8d3d-44af-9231-c8891889cece'
       END::uuid,
       v.name,
       v.registration
FROM job_vehicles jv JOIN vehicles v ON v.id = jv.vehicle_id;
