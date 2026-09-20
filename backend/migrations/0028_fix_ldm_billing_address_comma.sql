-- DATA MIGRATION — trivial correction, found while building the buyout PDF
-- (Stage 3) against LDM.tv's real template: 0025's seeded billing_address
-- was missing the trailing comma after "MediaCityUK, Salford" that the
-- real template has ("MediaCityUK, Salford,"). Address text matters for a
-- real invoicing document, so this fixes it to match the authentic source
-- exactly rather than leaving a near-miss.
UPDATE org_buyout_settings
SET billing_address = E'Blue Tower\nMediaCityUK, Salford,\nM50 2ST\nUnited Kingdom',
    updated_at = now()
WHERE organisation_id = 'fa065f2f-25d2-4d9a-9383-3fb1ca506a0a';
