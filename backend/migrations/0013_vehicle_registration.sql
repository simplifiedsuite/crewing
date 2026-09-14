-- Testing feedback batch, item F: a crew member's own personal vehicle
-- registration, for site/parking access purposes. Simple optional text
-- field — editable both by the scheduler (Crew management) and by the
-- crew member themselves (Profile), same as phone/base_location already are.
ALTER TABLE people ADD COLUMN vehicle_registration TEXT;
