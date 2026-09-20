package handlers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/jackc/pgx/v5"

	"ralto/internal/assets"
	"ralto/internal/notify"
)

// Buyout PDF — Ralto Addendum v3 §5. System-generated at Confirmed, from
// booking data, assembled fresh every time (never stored) — same principle
// as the call sheet in ralto-data-model-v0_1.md §7, which turned out not to
// be built yet (checked before adding a PDF dependency — see this file's
// own choice of github.com/go-pdf/fpdf, the same library the sibling
// Equiptra repo already uses for its delivery note/carnet PDFs, rather than
// introducing a second one). Layout replicates LDM.tv's real template
// verbatim (docs/TEMPLATE Freelance buyout UPDATED 29.12.25.xlsx and a real
// filled example, docs/Buyout 5376-61 PETER BONNEBAIGT...pdf) — field
// order, section headings, and T&Cs copy (including its own typos) are
// copied as-is, not paraphrased.

type buyoutView struct {
	PersonName   string
	CompanyName  string // "N/A" when unset, matching the real template
	RoleName     string
	DatesText    string // "21st-23rd August 2026" style, matching the template
	Days         int
	Rate         float64
	RateCurrency string
	TotalValue   float64
	JobName      string
	BuyoutRef    string // Job.project_reference — blank, not erroring, if unset
	Notes        string
	AuthorisedBy string // blank if confirmed_by is somehow unset
	Settings     *buyoutSettingsView
}

type buyoutSettingsView struct {
	CompanyLegalName        string
	BillingAddress          string
	InvoiceEmail            string
	AccountsEmail           string
	OperationsEmail         string
	RateQueryContactName    string
	RateQueryContactEmail   string
	AccidentReportURL       string
	PaymentTermsDays        int
	InvoiceWindowMonths     int
	CancellationNoticeHours int
}

// resolveBuyoutRate — Booking.rate_override -> PersonRole.rate (for the
// role actually booked) -> Person.standard_rate (Addendum v3 §4). A
// separate copy from booking_response_tokens.go's own resolveDisplayRate,
// deliberately — that one was flagged at Stage 2 as display-only, not
// meant to grow into shared PDF-facing logic, and this is that logic now
// getting its own real home rather than reusing the display helper.
func resolveBuyoutRate(rateOverride, personRoleRate, standardRate *float64) float64 {
	if rateOverride != nil {
		return *rateOverride
	}
	if personRoleRate != nil {
		return *personRoleRate
	}
	if standardRate != nil {
		return *standardRate
	}
	return 0
}

// buildBuyoutView gathers everything the PDF needs in one place, so
// renderBuyoutPDF itself has no database access at all — keeps the "pure
// function (Booking, Job, Person, resolved rate) -> PDF bytes" shape the
// prompt asked for, with this as the one query-heavy step before it.
func (a *API) buildBuyoutView(ctx context.Context, bookingID string) (*buyoutView, error) {
	var personID, jobID, roleID, confirmedBy *string
	var personFirstName, personLastName, roleName, jobName string
	var personCompanyName, jobProjectReference, bookingNotes *string
	var startDate, endDate string

	// Single joined read for everything that comes straight off
	// Booking/Job/JobRequirement/Role/Person — matches the pattern
	// loadBookingContext already uses elsewhere in this package.
	var rateOverrideF, personStandardRateF *float64
	var rateCurrencyStr *string
	err := a.DB.QueryRow(ctx, `
		SELECT b.person_id, jr.job_id, jr.role_id, b.confirmed_by,
		       p.first_name, p.last_name, p.company_name, p.standard_rate, p.rate_currency,
		       ro.name, j.name, j.project_reference,
		       b.start_date, b.end_date, b.rate_override, b.notes
		FROM bookings b
		JOIN job_requirements jr ON jr.id = b.job_requirement_id
		JOIN jobs j ON j.id = jr.job_id
		JOIN roles ro ON ro.id = jr.role_id
		JOIN people p ON p.id = b.person_id
		WHERE b.id = $1`,
		bookingID,
	).Scan(&personID, &jobID, &roleID, &confirmedBy,
		&personFirstName, &personLastName, &personCompanyName, &personStandardRateF, &rateCurrencyStr,
		&roleName, &jobName, &jobProjectReference,
		&startDate, &endDate, &rateOverrideF, &bookingNotes)
	if err != nil {
		return nil, fmt.Errorf("loading booking for buyout: %w", err)
	}

	var personRoleRate *float64
	if err := a.DB.QueryRow(ctx,
		`SELECT rate FROM person_roles WHERE person_id = $1 AND role_id = $2`,
		*personID, *roleID,
	).Scan(&personRoleRate); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("loading person_role rate for buyout: %w", err)
	}

	// Days — from BookingShift rows if any exist (handles a rest day
	// inside the range), else the raw date span. No existing server-side
	// helper computes this already (checked: resolveShiftDays in
	// booking_shifts.go is the write-side day-selection helper, not a
	// read-side count — the frontend's BookingDaysBadge is the only
	// existing "days" display logic, and it's client-side only), so this
	// is a fresh, self-contained query rather than a reuse.
	var shiftCount int
	if err := a.DB.QueryRow(ctx, `SELECT count(*) FROM booking_shifts WHERE booking_id = $1`, bookingID).Scan(&shiftCount); err != nil {
		return nil, fmt.Errorf("counting booking shifts for buyout: %w", err)
	}
	days := shiftCount
	if days == 0 {
		start, errS := time.Parse("2006-01-02", startDate)
		end, errE := time.Parse("2006-01-02", endDate)
		if errS != nil || errE != nil {
			return nil, fmt.Errorf("parsing booking dates for buyout: %v / %v", errS, errE)
		}
		days = int(end.Sub(start).Hours()/24) + 1
	}

	rate := resolveBuyoutRate(rateOverrideF, personRoleRate, personStandardRateF)
	currency := "GBP"
	if rateCurrencyStr != nil && *rateCurrencyStr != "" {
		currency = *rateCurrencyStr
	}

	companyName := "N/A"
	if personCompanyName != nil && strings.TrimSpace(*personCompanyName) != "" {
		companyName = *personCompanyName
	}

	buyoutRef := ""
	if jobProjectReference != nil {
		buyoutRef = *jobProjectReference
	} else {
		// Missing Job.project_reference degrades gracefully (blank field,
		// not a blocked confirmation) per the prompt's own instruction —
		// logged so it's visible that this job is missing one, same
		// treatment as a missing org_buyout_settings row below.
		log.Printf("buyout pdf: booking %s's job %s has no project_reference — buyout reference left blank", bookingID, *jobID)
	}

	notes := ""
	if bookingNotes != nil {
		notes = *bookingNotes
	}

	authorisedBy := ""
	if confirmedBy != nil {
		var name string
		if err := a.DB.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, *confirmedBy).Scan(&name); err == nil {
			authorisedBy = name
		}
	}

	settings, err := a.getOrgBuyoutSettings(ctx)
	if err != nil {
		// Same graceful-degradation principle as a missing project
		// reference, one level up: a query failure here shouldn't block a
		// confirmation that's otherwise already succeeded (the booking
		// status write already committed by the time this runs) — logged,
		// PDF renders without the org boilerplate section's real values.
		log.Printf("buyout pdf: failed to load org_buyout_settings for booking %s: %v", bookingID, err)
		settings = nil
	}

	view := &buyoutView{
		PersonName:   personFirstName + " " + personLastName,
		CompanyName:  companyName,
		RoleName:     roleName,
		DatesText:    formatBuyoutDateRange(startDate, endDate),
		Days:         days,
		Rate:         rate,
		RateCurrency: currency,
		TotalValue:   rate * float64(days),
		JobName:      jobName,
		BuyoutRef:    buyoutRef,
		Notes:        notes,
		AuthorisedBy: authorisedBy,
	}
	if settings != nil {
		view.Settings = &buyoutSettingsView{
			CompanyLegalName:      strOrEmptyP(settings.CompanyLegalName),
			BillingAddress:        strOrEmptyP(settings.BillingAddress),
			InvoiceEmail:          strOrEmptyP(settings.InvoiceEmail),
			AccountsEmail:         strOrEmptyP(settings.AccountsEmail),
			OperationsEmail:       strOrEmptyP(settings.OperationsEmail),
			RateQueryContactName:  strOrEmptyP(settings.RateQueryContactName),
			RateQueryContactEmail: strOrEmptyP(settings.RateQueryContactEmail),
			AccidentReportURL:     strOrEmptyP(settings.AccidentReportURL),
		}
		if settings.PaymentTermsDays != nil {
			view.Settings.PaymentTermsDays = *settings.PaymentTermsDays
		}
		if settings.InvoiceWindowDays != nil {
			view.Settings.InvoiceWindowMonths = *settings.InvoiceWindowDays / 30
		}
		if settings.CancellationNoticeHours != nil {
			view.Settings.CancellationNoticeHours = *settings.CancellationNoticeHours
		}
	}
	return view, nil
}

func strOrEmptyP(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// formatBuyoutDateRange matches the real template's "21st-23rd August 2026"
// style for a multi-day range spanning one month, falling back to a plainer
// "1 Oct 2026 - 3 Nov 2026" form when the range crosses a month or is a
// single day — the real example only shows the single-month case, so this
// covers the cases it doesn't rather than guessing at a convention for them.
func formatBuyoutDateRange(startDate, endDate string) string {
	start, errS := time.Parse("2006-01-02", startDate)
	end, errE := time.Parse("2006-01-02", endDate)
	if errS != nil || errE != nil {
		return startDate + " - " + endDate
	}
	if start.Equal(end) {
		return ordinalDate(start) + " " + start.Format("January 2006")
	}
	if start.Month() == end.Month() && start.Year() == end.Year() {
		return fmt.Sprintf("%s-%s %s", ordinalDay(start.Day()), ordinalDate(end), end.Format("January 2006"))
	}
	return fmt.Sprintf("%s - %s", start.Format("2 Jan 2006"), end.Format("2 Jan 2006"))
}

func ordinalDate(t time.Time) string {
	return ordinalDay(t.Day())
}

func ordinalDay(day int) string {
	suffix := "th"
	switch day % 10 {
	case 1:
		if day != 11 {
			suffix = "st"
		}
	case 2:
		if day != 12 {
			suffix = "nd"
		}
	case 3:
		if day != 13 {
			suffix = "rd"
		}
	}
	return fmt.Sprintf("%d%s", day, suffix)
}

// renderBuyoutPDF — pure function, no I/O: (view) -> PDF bytes. Layout
// mirrors the real LDM.tv template field-for-field (see this file's own
// top comment) — the info block order (Name, Company, Role, Date(s) + Days,
// Rate, Total Value, Job Name, then Buyout Reference on its own after a
// gap), the two boxed sections, and every T&Cs heading/paragraph verbatim,
// including the template's own wording (not corrected for typos —
// "additonal", "individal", "occured", "distrubuted" are all in LDM's real
// document, not introduced here).
func renderBuyoutPDF(view *buyoutView) []byte {
	const leftMargin = 15.0
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(leftMargin, 10, leftMargin)
	pdf.SetAutoPageBreak(true, 15)
	tr := pdf.UnicodeTranslatorFromDescriptor("")
	pdf.AddPage()

	if len(assets.LDMLogoPNG) > 0 {
		pdf.RegisterImageOptionsReader("ldm_logo", fpdf.ImageOptions{ImageType: "PNG"}, bytes.NewReader(assets.LDMLogoPNG))
		pdf.ImageOptions("ldm_logo", leftMargin, 12, 45, 0, false, fpdf.ImageOptions{ImageType: "PNG"}, 0, "")
	}

	// Info block — top right, matching the template's label/value column
	// pair exactly (label bold, value plain, both 9pt).
	labelW, valueW := 32.0, 75.0
	infoX := 105.0
	infoRow := func(y float64, label, value string) {
		pdf.SetXY(infoX, y)
		pdf.SetFont("Helvetica", "B", 9)
		pdf.CellFormat(labelW, 5, label, "", 0, "L", false, 0, "")
		pdf.SetFont("Helvetica", "", 9)
		pdf.CellFormat(valueW, 5, tr(value), "", 0, "L", false, 0, "")
	}
	y := 12.0
	infoRow(y, "NAME", view.PersonName)
	y += 5
	infoRow(y, "COMPANY", view.CompanyName)
	y += 5
	infoRow(y, "ROLE", view.RoleName)
	y += 5
	infoRow(y, "DATE(S)", view.DatesText)
	pdf.SetXY(infoX+labelW+valueW+5, y)
	pdf.SetFont("Helvetica", "B", 9)
	pdf.CellFormat(15, 5, "DAYS", "", 0, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 9)
	pdf.CellFormat(10, 5, fmt.Sprintf("%d", view.Days), "", 0, "L", false, 0, "")
	y += 5
	infoRow(y, "RATE", formatBuyoutMoney(view.Rate, view.RateCurrency))
	y += 8
	infoRow(y, "TOTAL VALUE", formatBuyoutMoney(view.TotalValue, view.RateCurrency))
	y += 5
	infoRow(y, "JOB NAME", view.JobName)
	y += 10
	// BUYOUT REFERENCE is the one label wider than the shared labelW
	// column (17 characters, bold) — given its own wider cell so it
	// doesn't run into the value straight after it, unlike the shorter
	// labels above that fit labelW comfortably.
	pdf.SetXY(infoX, y)
	pdf.SetFont("Helvetica", "B", 9)
	pdf.CellFormat(45, 5, "BUYOUT REFERENCE", "", 0, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 9)
	pdf.CellFormat(valueW, 5, tr(view.BuyoutRef), "", 0, "L", false, 0, "")

	pdf.SetY(58)
	pdf.SetX(leftMargin)
	pdf.SetFont("Helvetica", "", 9)
	pdf.MultiCell(0, 5, tr("This buyout is a sub-contract between LDM.tv Ltd (hereinafter referred to as LDMtv) and the individual and/or company named above.\nLDMtv would like to engage you to undertake the above duties on a freelance contract basis."), "", "L", false)
	pdf.Ln(2)

	sectionHeading := func(text string) {
		pdf.SetX(leftMargin)
		pdf.SetFont("Helvetica", "BI", 9)
		pdf.CellFormat(0, 6, tr(text), "", 1, "L", false, 0, "")
		pdf.SetFont("Helvetica", "", 9)
	}
	bodyText := func(text string) {
		pdf.SetX(leftMargin)
		pdf.MultiCell(0, 4.6, tr(text), "", "L", false)
	}
	pageW, _ := pdf.GetPageSize()
	boxW := pageW - 2*leftMargin
	// boxedText draws a fixed-height bordered box (matching the real
	// template's empty boxes) with the text laid inside at a normal small
	// line height — MultiCell's own height param is a *per-line* height,
	// not a total box height, so passing a big number for "how tall
	// should this box be" (an earlier version of this function did)
	// stretched every line of wrapped/multi-line text out to that height
	// instead, leaving huge gaps between lines. Drawing the border
	// separately from the text sidesteps that entirely.
	boxedText := func(text string, height float64) {
		x, y := pdf.GetX(), pdf.GetY()
		pdf.Rect(leftMargin, y, boxW, height, "D")
		pdf.SetXY(leftMargin+2, y+2)
		pdf.SetFont("Helvetica", "", 9)
		pdf.MultiCell(boxW-4, 4.6, tr(text), "", "L", false)
		pdf.SetXY(x, y+height)
	}

	sectionHeading("Any additional notes about booking:")
	boxedText(view.Notes, 15)
	pdf.Ln(3)

	s := view.Settings

	sectionHeading("Invoicing instructions")
	invoiceEmail := "invoice@ldm.tv"
	accountsEmail := "accounts@ldm.tv"
	invoiceWindow := 6
	if s != nil {
		if s.InvoiceEmail != "" {
			invoiceEmail = s.InvoiceEmail
		}
		if s.AccountsEmail != "" {
			accountsEmail = s.AccountsEmail
		}
		if s.InvoiceWindowMonths > 0 {
			invoiceWindow = s.InvoiceWindowMonths
		}
	}
	bodyText(fmt.Sprintf(
		"Please send all invoices as a pdf/doc attachment to %s once the job is complete. Our invoicing system cannot read invoices sent as a web link.\n"+
			"Please include your name, the job name, the job date and the buyout reference on your invoice to assist our processing.\n"+
			"** %s is not a monitored inbox. Please direct all other invoicing queries/ statement of accounts to %s **\n"+
			"If your invoice is not submitted to us within %d months of the job dates, we reserve the right to not fulfil the payment.",
		invoiceEmail, invoiceEmail, accountsEmail, invoiceWindow,
	))
	pdf.Ln(2)

	pdf.SetX(leftMargin)
	pdf.SetFont("Helvetica", "", 9)
	pdf.CellFormat(0, 5, "Billing address:", "", 1, "L", false, 0, "")
	// The real template's box shows the company legal name as its own
	// first line, then the address — but org_buyout_settings keeps those
	// as two separate columns (Addendum v3 §5), matching billing_address
	// alone (no name baked in, see migrations/0025's own seed value), so
	// they're joined back together here for display, not stored joined.
	billingAddress := "Blue Tower\nMediaCityUK, Salford,\nM50 2ST\nUnited Kingdom"
	companyLegalName := "LDM.tv Ltd"
	if s != nil {
		if s.BillingAddress != "" {
			billingAddress = s.BillingAddress
		}
		if s.CompanyLegalName != "" {
			companyLegalName = s.CompanyLegalName
		}
	}
	billingBox := companyLegalName + "\n" + billingAddress
	boxedText(billingBox, 4.6*float64(strings.Count(billingBox, "\n")+1)+4)
	pdf.Ln(2)

	paymentTerms := 30
	if s != nil && s.PaymentTermsDays > 0 {
		paymentTerms = s.PaymentTermsDays
	}
	pdf.SetX(leftMargin)
	pdf.CellFormat(0, 5, tr(fmt.Sprintf("Invoices will be paid %d days from receipt", paymentTerms)), "", 1, "L", false, 0, "")
	pdf.Ln(2)

	sectionHeading("Terms of engagement")
	bodyText("Your rate is inclusive of any travel & expenses (except VAT) unless otherwise agreed as per the below")
	pdf.Ln(1)

	rateQueryEmail := "becca.bracewell@ldm.tv"
	if s != nil && s.RateQueryContactEmail != "" {
		rateQueryEmail = s.RateQueryContactEmail
	}
	bodyText(fmt.Sprintf("Any additonal expenses on the day must be signed off by the unit manager prior to leaving site.\nIf the amount on your invoice does not match the rate agreed in this buyout, you must contact %s", rateQueryEmail))
	pdf.Ln(2)

	pdf.SetX(leftMargin)
	pdf.SetFont("Helvetica", "BI", 9)
	pdf.CellFormat(60, 6, "Authorised by", "", 0, "L", false, 0, "")
	pdf.SetFont("Helvetica", "", 9)
	pdf.CellFormat(0, 6, tr(view.AuthorisedBy), "", 1, "L", false, 0, "")
	pdf.Ln(2)

	cancellationHours := 48
	if s != nil && s.CancellationNoticeHours > 0 {
		cancellationHours = s.CancellationNoticeHours
	}
	sectionHeading("Cancellation")
	bodyText(fmt.Sprintf(
		"If a job is unfortunately cancelled with more than %d hours notice LDMtv will not be required to fulfil the payment obligation.\n"+
			"LDMtv do not take any responsibility for any hotel and/or travel expenses if a job is cancelled with more than %d hours notice.\n"+
			"If the booking is cancelled by the individal at any point LDMtv are not required to fulfil the payment obligation.",
		cancellationHours, cancellationHours,
	))
	pdf.Ln(2)

	operationsEmail := "operations@ldm.tv"
	if s != nil && s.OperationsEmail != "" {
		operationsEmail = s.OperationsEmail
	}
	sectionHeading("Equipment Damage")
	bodyText(fmt.Sprintf("If you encounter damage to any equipment it is imperative that this is reported to the Engineer in Charge (EIC) and LDM Operations (%s) immediately, regardless of the circumstance in which the damage occured. Please ensure you document any encountered damage with photographs captured and sent to the above contacts as soon as possible.", operationsEmail))
	pdf.Ln(2)

	sectionHeading("Professionalism")
	bodyText(fmt.Sprintf("It is expected that all subcontracted individuals will represent LDMtv with a high level of professionalism for the duration of the booking. This includes good timekeeping, appropriate attire and polite personal conduct. It is also expected that all communications related to the booking, including but not limited to, planning sheets and risk assessments, will be read and adhered to.\nIf you are going to be late to site, please inform the Engineer in Charge (EIC) and LDM Operations (%s)", operationsEmail))
	pdf.Ln(2)

	accidentURL := "http://accidentreport.ldm.tv"
	if s != nil && s.AccidentReportURL != "" {
		accidentURL = s.AccidentReportURL
	}
	sectionHeading("Accident Reporting")
	bodyText(fmt.Sprintf("Any accidents involving yourself and/or others that occur onsite should be reported to the Engineer in Charge (EIC) and to LDM Operations via this form\n%s", accidentURL))
	pdf.Ln(2)

	rateQueryContactRef := rateQueryEmail
	sectionHeading("GDPR")
	bodyText(fmt.Sprintf("LDMtv will retain your contact details (name, email address, mobile number) securely on our system and use them responsibly for operational purposes and future engagement opportunities only. \"Operational purposes\" includes, but is not limited to, call sheets/planning sheets, which are distributed to the crew for the specific job name mentioned above. If you do not wish your contact details to be displayed on operational documentations and/or retained, please inform %s.", rateQueryContactRef))
	pdf.Ln(1)
	bodyText("All documentation e.g. planning sheets received by the individual for the duration of the job should be treated sensitively and confidentially. It should not be distrubuted to external individuals and both paper and electronic copies should be destroyed once the job is complete.")

	_ = companyLegalName // reserved for a future letterhead line if the real template turns out to want one; not shown separately today since "LDM.tv Ltd" already opens the billing address block

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		log.Printf("buyout pdf: fpdf output failed: %v", err)
		return nil
	}
	return buf.Bytes()
}

func formatBuyoutMoney(v float64, currency string) string {
	symbol := "£"
	switch currency {
	case "USD":
		symbol = "$"
	case "EUR":
		symbol = "€"
	}
	return fmt.Sprintf("%s%.2f", symbol, v)
}

// buyoutAttachment builds the notify.Attachment for a freelancer's
// booking_confirmed email — nil (no attachment, not an error) if PDF
// generation fails for any reason, so a PDF problem never blocks the
// confirmation email itself from going out.
func (a *API) buyoutAttachment(ctx context.Context, bookingID string) *notify.Attachment {
	view, err := a.buildBuyoutView(ctx, bookingID)
	if err != nil {
		log.Printf("buyout pdf: failed to build view for booking %s: %v", bookingID, err)
		return nil
	}
	pdfBytes := renderBuyoutPDF(view)
	if len(pdfBytes) == 0 {
		return nil
	}
	return &notify.Attachment{
		Filename: "buyout.pdf",
		Content:  pdfBytes,
		Type:     "application/pdf",
	}
}
