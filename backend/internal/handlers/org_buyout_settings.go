package handlers

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
)

// --- OrgBuyoutSettings (Addendum v3 §5) ---
//
// Schema-stage only (Stage 1) — no HTTP endpoint yet, matching the
// existing minimal read-path convention for org-scoped settings
// (GetDakboardFeed in calendar_feed.go: SELECT by organisation_id,
// pgx.ErrNoRows means "not configured yet" rather than an error). The
// later buyout-generation stage wires an actual route around this.

const orgBuyoutSettingsColumns = `id, organisation_id, company_legal_name, billing_address, invoice_email,
	accounts_email, operations_email, rate_query_contact_name, rate_query_contact_email,
	accident_report_url, payment_terms_days, invoice_window_days, cancellation_notice_hours,
	created_at, updated_at`

// getOrgBuyoutSettings returns nil (not an error) when the org has no row
// yet — every org except LDM.tv, today (see
// migrations/0025_ldm_buyout_settings_seed.sql) — since that's the normal
// state for most orgs, not an exceptional one (see OrgBuyoutSettings' own
// doc comment in internal/models).
func (a *API) getOrgBuyoutSettings(ctx context.Context) (*models.OrgBuyoutSettings, error) {
	var s models.OrgBuyoutSettings
	err := a.DB.QueryRow(ctx,
		`SELECT `+orgBuyoutSettingsColumns+` FROM org_buyout_settings WHERE organisation_id = $1`,
		currentOrgID,
	).Scan(
		&s.ID, &s.OrganisationID, &s.CompanyLegalName, &s.BillingAddress, &s.InvoiceEmail,
		&s.AccountsEmail, &s.OperationsEmail, &s.RateQueryContactName, &s.RateQueryContactEmail,
		&s.AccidentReportURL, &s.PaymentTermsDays, &s.InvoiceWindowDays, &s.CancellationNoticeHours,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}
