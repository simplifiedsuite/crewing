-- Testing feedback — "Delete cancelled jobs into an archive". A second
-- axis alongside Job.status, same pattern as commitment (see 0004): a
-- Cancelled job can now also be soft-deleted without folding "deleted"
-- into the status enum. status stays whatever it was (Cancelled, the
-- only realistic path here); deleted_at/deleted_by track the archive
-- action independently, mirroring created_by's users(id) link rather
-- than people(id) — this is a staff/scheduler action, not a crew record.

ALTER TABLE jobs
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES users(id);
