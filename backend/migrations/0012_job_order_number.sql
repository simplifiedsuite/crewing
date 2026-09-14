-- Testing feedback batch, item C: the Monday order number a Job was
-- fetched with (see the shared_job_id link, 0010_shared_job_link.sql) was
-- never stored locally, so there was nothing to display on the Job's own
-- view without a live proxy call to Core on every page load. Cached here
-- at fetch/create time instead — same pattern as shared_contract_name's
-- own "cached label, not live-refreshed" comment.
--
-- Nullable: only set when the Job was actually linked via a Monday fetch;
-- most jobs are still created by hand.
ALTER TABLE jobs ADD COLUMN order_number TEXT;
