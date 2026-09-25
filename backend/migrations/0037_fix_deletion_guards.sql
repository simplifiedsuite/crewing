-- Testing feedback #65 — a real report: a role couldn't be deleted even
-- after the person was removed from it, despite the earlier work that
-- added exactly this capability (DeleteJobRequirement). Every real
-- freelancer booking gets a booking_response_tokens row the moment it's
-- offered (see booking_response_tokens.go's whole self-service flow) —
-- but unlike every other booking-child table (booking_shifts, and now
-- buyout_records — see that migration's own comment on why it's the one
-- deliberate exception), this table's original migration
-- (0026_booking_response_tokens.sql) never added ON DELETE CASCADE,
-- so deleting a job_requirement whose booking still has response-token
-- rows failed on this FK — surfaced only as DeleteJobRequirement's
-- generic "it may still have bookings" message, with no obvious link to
-- an offer email sent weeks earlier. These tokens are purely operational
-- (an email-response security token, largely already spent/invalidated
-- by the time a booking reaches Confirmed — see
-- invalidateBookingResponseTokens) with no record-keeping value once
-- the booking itself is gone, so cascading them away is correct, not
-- just convenient.
ALTER TABLE booking_response_tokens DROP CONSTRAINT booking_response_tokens_booking_id_fkey;
ALTER TABLE booking_response_tokens ADD CONSTRAINT booking_response_tokens_booking_id_fkey
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
