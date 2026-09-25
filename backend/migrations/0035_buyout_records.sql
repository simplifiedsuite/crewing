-- Testing feedback #61/#62 — a buyout was generated fresh every time and
-- never stored (this file's own sibling, buyout_pdf.go, says so directly:
-- "assembled fresh every time (never stored)"), so there was nothing to
-- refer back to later for record-keeping or an invoicing query once the
-- email had gone out. One row per actual send (ConfirmBooking, freelancer
-- only) — job_id/person_id denormalized (not just booking_id) so this can
-- be queried by either without a join back through job_requirements, and
-- because the underlying booking's own job/person could theoretically
-- change identity later (it can't today, but this is a permanent record,
-- not a live-joined view).
-- booking_id deliberately has no ON DELETE CASCADE (see testing feedback
-- #65's own investigation, in the same batch this table shipped in):
-- unlike booking_shifts/booking_response_tokens (purely operational,
-- safe to cascade away), a persisted buyout is a financial record this
-- table exists specifically to keep — same "no cascade" protection
-- timesheets.booking_id already has, and for the same reason. This is a
-- deliberate choice, not an oversight: deleting a role/booking that has
-- an actual sent buyout on record should stay blocked.
CREATE TABLE buyout_records (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id       UUID NOT NULL REFERENCES bookings(id),
    job_id           UUID NOT NULL REFERENCES jobs(id),
    person_id        UUID NOT NULL REFERENCES people(id),
    pdf_content      BYTEA NOT NULL,
    generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    organisation_id  UUID NOT NULL
);

CREATE INDEX idx_buyout_records_booking_id ON buyout_records(booking_id);
CREATE INDEX idx_buyout_records_job_id ON buyout_records(job_id);
CREATE INDEX idx_buyout_records_person_id ON buyout_records(person_id);

ALTER TABLE buyout_records ENABLE ROW LEVEL SECURITY;
