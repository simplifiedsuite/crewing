-- Shared Core Job entity (see Core's own migrations/0008_jobs.sql): one
-- Monday order-number fetch, visible from every product. Not a reuse of
-- projects.shared_project_id — that column is reserved for a different,
-- already-documented future purpose (Ralto's own Project entity linking
-- to Core's Contract, per docs/simplified_suite_core_v0_6.md §8a) and
-- lives on a different table entirely. This is a new, separate link:
-- which shared Core Job (if any) this specific Job came from.
--
-- Nullable: most jobs are still created by hand, with no Monday fetch
-- involved at all.

ALTER TABLE jobs ADD COLUMN shared_job_id UUID;
