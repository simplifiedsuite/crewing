-- Shared Vehicle addendum, Stage 3 (final step): retire Ralto's own local
-- Vehicle table now that job_core_vehicles (migrations/0029) is confirmed
-- working end-to-end — Core is the only remaining owner of vehicle
-- identity. job_vehicles is dropped first since it references vehicles.
DROP TABLE job_vehicles;
DROP TABLE vehicles;
