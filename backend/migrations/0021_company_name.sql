-- Crewing-local field: many freelancers operate through their own limited
-- company, which is who Simplified Suite actually contracts with on
-- paperwork. Captured now so it's available when auto-generated paperwork
-- (contracts, purchase orders) is built later — Person/Crew already holds
-- Crewing-local fields distinct from Core's own Person entity, same as
-- vehicle_registration (0013). Simple optional text field, same pattern.
ALTER TABLE people ADD COLUMN company_name TEXT;
