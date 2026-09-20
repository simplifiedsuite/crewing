-- Bug fix, found live-testing Addendum v3 Stage 2: bookings.confirmed_by
-- (0024_addendum_v3_schema.sql) was given a FK to people(id), following the
-- literal "confirmed_by (uuid FK -> Person)" wording in the addendum's own
-- pseudocode. But confirmed_by is populated with the *scheduler's* own
-- identity ("whoever pressed Confirm" — see ConfirmBooking), and in this
-- schema staff/scheduler identity lives in `users`, not `people` (`people`
-- is the crew/freelancer persona — a different table entirely, per the
-- staff/crew split throughout this codebase). Every real Confirm attempt
-- was failing on a foreign-key violation until this fixed it — confirmed_by
-- was still null on every existing row, so this is a pure constraint
-- correction, no data to migrate.
ALTER TABLE bookings DROP CONSTRAINT bookings_confirmed_by_fkey;
ALTER TABLE bookings ADD CONSTRAINT bookings_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES users(id);
