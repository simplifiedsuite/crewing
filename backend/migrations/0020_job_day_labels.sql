-- Testing feedback R — label individual days within a multi-day Job
-- (e.g. "Rig", "Match day", "Get-out") so the day itself carries meaning
-- at a glance, not just a date. Deliberately a Job-level concept, not a
-- Booking/BookingShift one: a day's meaning ("Match day") is the same for
-- every person on the job regardless of who's covering it, so this is a
-- new small table keyed by (job_id, date), same shape as booking_shifts'
-- own (booking_id, date) uniqueness — not a column added to jobs itself,
-- since a Job can span many days and this is naturally one-row-per-day.

CREATE TABLE job_day_labels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    label           TEXT NOT NULL,
    organisation_id UUID NOT NULL,
    UNIQUE (job_id, date)
);

CREATE INDEX idx_job_day_labels_job ON job_day_labels (job_id);
