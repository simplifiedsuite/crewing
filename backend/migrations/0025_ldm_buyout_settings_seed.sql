-- DATA MIGRATION — seeds LDM.tv's org_buyout_settings row, not a schema
-- change. Separate file from 0024 so the schema and the data it's
-- populated with can be reviewed/reverted independently.
--
-- LDM.tv's organisation_id is tenancy.PlaceholderOrganisationID
-- (fa065f2f-25d2-4d9a-9383-3fb1ca506a0a) — confirmed against live data,
-- not guessed: every existing people row with an @ldm.tv email (Becca
-- Bracewell, Rebecca Speller, Steve Burns, Ric Burdge, Chris Taylor, the
-- scheduler/staff team seen throughout this app) already carries this
-- exact organisation_id, which is "the one organisation that currently
-- exists" per docs/organisation_id_placeholder.md — i.e. LDM.tv itself.
-- Values below are LDM.tv's real buyout template, supplied directly.
INSERT INTO org_buyout_settings (
    organisation_id,
    company_legal_name,
    billing_address,
    invoice_email,
    accounts_email,
    operations_email,
    rate_query_contact_name,
    rate_query_contact_email,
    accident_report_url,
    payment_terms_days,
    invoice_window_days,
    cancellation_notice_hours
) VALUES (
    'fa065f2f-25d2-4d9a-9383-3fb1ca506a0a',
    'LDM.tv Ltd',
    E'Blue Tower\nMediaCityUK, Salford\nM50 2ST\nUnited Kingdom',
    'invoice@ldm.tv',
    'accounts@ldm.tv',
    'operations@ldm.tv',
    'Becca Bracewell',
    'becca.bracewell@ldm.tv',
    'http://accidentreport.ldm.tv',
    30,
    180,
    48
)
ON CONFLICT (organisation_id) DO NOTHING;
