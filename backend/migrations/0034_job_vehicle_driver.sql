-- Testing feedback #47 — assign a specific crew member as the driver of a
-- vehicle already assigned to a Job. A plain column on job_core_vehicles,
-- not a cached label: unlike core_vehicle_id (Core is a separate
-- database, so vehicle_name/registration are cached), `people` is
-- Ralto's own local table, so a real FK plus a JOIN at read time is both
-- correct and simpler — nothing to keep in sync. Nullable and
-- ON DELETE SET NULL: a vehicle can be assigned with no driver picked
-- yet, and removing a person shouldn't be blocked by (or silently keep)
-- a stale driver assignment.
ALTER TABLE job_core_vehicles ADD COLUMN driver_person_id UUID REFERENCES people(id) ON DELETE SET NULL;
