-- Testing feedback T — add "Bank Holiday" as a distinct unavailability
-- reason, alongside annual_leave/sick/toil/other (see 0002_availability_type.sql).
-- Adding the enum value alone (no use of it yet) is safe inside this
-- migration's transaction on Postgres 12+, same pattern as 0004_pencil.sql.

ALTER TYPE availability_type ADD VALUE 'bank_holiday';
