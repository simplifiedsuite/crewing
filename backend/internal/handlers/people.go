package handlers

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"ralto/internal/models"
)

const personSelectColumns = `id, first_name, last_name, email, phone, base_location, employment_type, status,
	preferred_status, standard_rate, rate_currency, overtime_rule_id, notes, phone_number,
	notification_channels, vehicle_registration, company_name, active, must_change_password, created_at, updated_at`

// scanPerson scans the fixed personSelectColumns list into p. extra lets a
// caller select additional trailing columns (e.g. password_hash for login)
// without duplicating the whole column list.
func scanPerson(row pgx.Row, p *models.Person, extra ...interface{}) error {
	dest := []interface{}{&p.ID, &p.FirstName, &p.LastName, &p.Email, &p.Phone, &p.BaseLocation, &p.EmploymentType, &p.Status,
		&p.PreferredStatus, &p.StandardRate, &p.RateCurrency, &p.OvertimeRuleID, &p.Notes, &p.PhoneNumber,
		&p.NotificationChannels, &p.VehicleRegistration, &p.CompanyName, &p.Active, &p.MustChangePassword, &p.CreatedAt, &p.UpdatedAt}
	dest = append(dest, extra...)
	return row.Scan(dest...)
}

// personListResponse adds the person's primary role's category onto the
// plain Person shape — Crew's discipline filter needs this on every card,
// and CrewContent was deliberately built without a per-person roles
// follow-up call to avoid an N+1 (see the comment at the top of the Crew
// section in RaltoDesktopApp.tsx), so it has to come back with the list
// itself rather than from a separate lookup.
type personListResponse struct {
	models.Person
	PrimaryRoleCategory *string `json:"primary_role_category,omitempty"`
	// RoleCategories is every distinct category across ALL of this person's
	// roles (not just their primary one) — the Crew screen's discipline
	// filter matches against this, not PrimaryRoleCategory, so someone
	// whose primary role is e.g. Camera Op but who also holds a Sound role
	// is still findable under a Sound filter. See disciplineBuckets/
	// personHasDiscipline in RaltoDesktopApp.tsx.
	RoleCategories []string `json:"role_categories"`
}

func (a *API) ListPeople(w http.ResponseWriter, r *http.Request) {
	// A scalar subquery rather than a plain LEFT JOIN on person_roles/roles:
	// is_primary isn't actually enforced as at-most-one-per-person at the DB
	// level, so a straight JOIN could fan a person out into duplicate rows
	// if they somehow ended up with more than one primary role. This stays
	// a single query either way — no N+1 — and LIMIT 1 guarantees exactly
	// one output row per person regardless of that data ever going bad.
	rows, err := a.DB.Query(r.Context(),
		`SELECT `+personSelectColumns+`,
		        (SELECT ro.category FROM person_roles pr JOIN roles ro ON ro.id = pr.role_id
		         WHERE pr.person_id = p.id AND pr.is_primary = true LIMIT 1) AS primary_role_category,
		        (SELECT COALESCE(array_agg(DISTINCT ro.category), '{}') FROM person_roles pr JOIN roles ro ON ro.id = pr.role_id
		         WHERE pr.person_id = p.id AND ro.category IS NOT NULL) AS role_categories
		 FROM people p WHERE p.organisation_id = $1 ORDER BY p.first_name, p.last_name`, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list people")
		return
	}
	defer rows.Close()

	people := []personListResponse{}
	for rows.Next() {
		var p personListResponse
		if err := scanPerson(rows, &p.Person, &p.PrimaryRoleCategory, &p.RoleCategories); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list people")
			return
		}
		people = append(people, p)
	}
	writeJSON(w, http.StatusOK, people)
}

func (a *API) GetPerson(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var p models.Person
	err := scanPerson(a.DB.QueryRow(r.Context(), `SELECT `+personSelectColumns+` FROM people WHERE id = $1 AND organisation_id = $2`, id, currentOrgID), &p)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get person")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type personWriteRequest struct {
	FirstName            string                 `json:"first_name"`
	LastName             string                 `json:"last_name"`
	Email                string                 `json:"email"`
	Phone                *string                `json:"phone"`
	BaseLocation         *string                `json:"base_location"`
	EmploymentType       models.EmploymentType  `json:"employment_type"`
	Status               models.PersonStatus    `json:"status"`
	PreferredStatus      models.PreferredStatus `json:"preferred_status"`
	StandardRate         *float64               `json:"standard_rate"`
	RateCurrency         *string                `json:"rate_currency"`
	OvertimeRuleID       *string                `json:"overtime_rule_id"`
	Notes                *string                `json:"notes"`
	PhoneNumber          *string                `json:"phone_number"`
	NotificationChannels *string                `json:"notification_channels"`
	VehicleRegistration  *string                `json:"vehicle_registration"`
	CompanyName          *string                `json:"company_name"`
}

// nilIfEmpty treats a *string pointing at "" the same as an absent key —
// overtime_rule_id is the one optional field here backed by a UUID column
// rather than TEXT, so an explicit "" (vs. the key being omitted entirely)
// reaches Postgres as `invalid input syntax for type uuid: ""` instead of
// NULL. The other *string fields (phone, notes, etc.) are plain TEXT
// columns where "" is a legitimate value, so this is deliberately scoped
// to just this field rather than applied to the whole struct.
func nilIfEmpty(s *string) *string {
	if s != nil && *s == "" {
		return nil
	}
	return s
}

// emailOrNil — testing feedback Y: an empty email must reach Postgres as
// NULL, never "". people.email keeps its UNIQUE(lower(email)) index
// (0005_case_insensitive_email.sql), which allows any number of NULLs but
// would reject a second person with the literal empty string.
func emailOrNil(email string) *string {
	if email == "" {
		return nil
	}
	return &email
}

// hasContactInfo — testing feedback Y: email is no longer required if a
// phone number is present, but a person needs at least one way to be
// reached, so this is the one thing CreatePerson/UpdatePerson still
// enforce rather than allowing a fully contact-less record.
func hasContactInfo(email string, phone *string) bool {
	return email != "" || (phone != nil && *phone != "")
}

func (a *API) CreatePerson(w http.ResponseWriter, r *http.Request) {
	var req personWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Status == "" {
		req.Status = models.PersonStatusActive
	}
	if req.PreferredStatus == "" {
		req.PreferredStatus = models.PreferredStatusStandard
	}
	req.Email = normalizeEmail(req.Email)
	req.OvertimeRuleID = nilIfEmpty(req.OvertimeRuleID)
	if !hasContactInfo(req.Email, req.Phone) {
		writeError(w, http.StatusBadRequest, "email or phone is required")
		return
	}
	var p models.Person
	err := scanPerson(a.DB.QueryRow(r.Context(),
		`INSERT INTO people (first_name, last_name, email, phone, base_location, employment_type, status,
		                      preferred_status, standard_rate, rate_currency, overtime_rule_id, notes,
		                      phone_number, notification_channels, vehicle_registration, company_name, organisation_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		 RETURNING `+personSelectColumns,
		req.FirstName, req.LastName, emailOrNil(req.Email), req.Phone, req.BaseLocation, req.EmploymentType, req.Status,
		req.PreferredStatus, req.StandardRate, req.RateCurrency, req.OvertimeRuleID, req.Notes,
		req.PhoneNumber, req.NotificationChannels, req.VehicleRegistration, req.CompanyName, currentOrgID,
	), &p)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create person")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (a *API) UpdatePerson(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req personWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = normalizeEmail(req.Email)
	req.OvertimeRuleID = nilIfEmpty(req.OvertimeRuleID)
	if !hasContactInfo(req.Email, req.Phone) {
		writeError(w, http.StatusBadRequest, "email or phone is required")
		return
	}
	var p models.Person
	err := scanPerson(a.DB.QueryRow(r.Context(),
		`UPDATE people SET first_name = $1, last_name = $2, email = $3, phone = $4, base_location = $5,
		        employment_type = $6, status = $7, preferred_status = $8, standard_rate = $9, rate_currency = $10,
		        overtime_rule_id = $11, notes = $12, phone_number = $13, notification_channels = $14, vehicle_registration = $15,
		        company_name = $16, updated_at = now()
		 WHERE id = $17 AND organisation_id = $18
		 RETURNING `+personSelectColumns,
		req.FirstName, req.LastName, emailOrNil(req.Email), req.Phone, req.BaseLocation, req.EmploymentType, req.Status,
		req.PreferredStatus, req.StandardRate, req.RateCurrency, req.OvertimeRuleID, req.Notes,
		req.PhoneNumber, req.NotificationChannels, req.VehicleRegistration, req.CompanyName, id, currentOrgID,
	), &p)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update person")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// DeletePerson is blocked if the person appears on any booking history —
// deactivate (Status) instead. Mirrors Equiptra's DeleteUser guard, which
// checks real allocation history rather than mere row existence.
func (a *API) DeletePerson(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var hasBookings bool
	if err := a.DB.QueryRow(r.Context(),
		`SELECT EXISTS (SELECT 1 FROM bookings WHERE person_id = $1)`, id,
	).Scan(&hasBookings); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete person")
		return
	}
	if hasBookings {
		writeError(w, http.StatusConflict, "person has booking history — deactivate instead of deleting")
		return
	}
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM people WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete person")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- Person roles (capabilities) ---

type personRoleResponse struct {
	models.PersonRole
	RoleName string `json:"role_name"`
}

func (a *API) ListPersonRoles(w http.ResponseWriter, r *http.Request) {
	personID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT pr.id, pr.person_id, pr.role_id, pr.is_primary, ro.name
		 FROM person_roles pr JOIN roles ro ON ro.id = pr.role_id
		 WHERE pr.person_id = $1 AND pr.organisation_id = $2 ORDER BY pr.is_primary DESC, ro.name`, personID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list person roles")
		return
	}
	defer rows.Close()

	out := []personRoleResponse{}
	for rows.Next() {
		var pr personRoleResponse
		if err := rows.Scan(&pr.ID, &pr.PersonID, &pr.RoleID, &pr.IsPrimary, &pr.RoleName); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list person roles")
			return
		}
		out = append(out, pr)
	}
	writeJSON(w, http.StatusOK, out)
}

type personRoleWriteRequest struct {
	RoleID    string `json:"role_id"`
	IsPrimary bool   `json:"is_primary"`
}

func (a *API) AddPersonRole(w http.ResponseWriter, r *http.Request) {
	personID := chi.URLParam(r, "id")
	var req personRoleWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var pr models.PersonRole
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO person_roles (person_id, role_id, is_primary, organisation_id) VALUES ($1, $2, $3, $4)
		 RETURNING id, person_id, role_id, is_primary`,
		personID, req.RoleID, req.IsPrimary, currentOrgID,
	).Scan(&pr.ID, &pr.PersonID, &pr.RoleID, &pr.IsPrimary)
	if err != nil {
		log.Printf("AddPersonRole: %v", err)
		writeError(w, http.StatusBadRequest, "failed to add person role")
		return
	}
	writeJSON(w, http.StatusCreated, pr)
}

func (a *API) RemovePersonRole(w http.ResponseWriter, r *http.Request) {
	personRoleID := chi.URLParam(r, "personRoleId")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM person_roles WHERE id = $1 AND organisation_id = $2`, personRoleID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to remove person role")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "person role not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// --- Calendar feed token ---

// issuePersonCalendarFeedToken generates a fresh token and overwrites
// whatever a Person already had — regenerating and first-time issuing are
// the same operation here, since overwriting is also how revocation works
// (no separate revocation table, per ralto_schema_addendum_v1.md §2).
// Shared by the scheduler-facing GenerateCalendarFeedToken below and the
// crew-facing endpoints in calendar_feed.go, so both call sites can never
// drift into two different token formats or write paths.
func (a *API) issuePersonCalendarFeedToken(ctx context.Context, personID string) (string, error) {
	token, err := randomToken(24)
	if err != nil {
		return "", err
	}
	tag, err := a.DB.Exec(ctx, `UPDATE people SET calendar_feed_token = $1, updated_at = now() WHERE id = $2 AND organisation_id = $3`, token, personID, currentOrgID)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", pgx.ErrNoRows
	}
	return token, nil
}

// personFeedURL renders the public URL for a person's feed token —
// ICAL_FEED_BASE_URL points at the ical-sidecar's own /feed route (see
// render.yaml), e.g. https://ralto-ical.onrender.com/feed.
func personFeedURL(token string) string {
	return os.Getenv("ICAL_FEED_BASE_URL") + "/" + token + ".ics"
}

// GenerateCalendarFeedToken issues (or regenerates) a Person's iCal feed
// token from the scheduler side — e.g. to hand a crew member their link
// during onboarding. The crew member's own self-service version of this
// lives in calendar_feed.go.
func (a *API) GenerateCalendarFeedToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	token, err := a.issuePersonCalendarFeedToken(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to generate calendar feed token")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"token": token, "feed_url": personFeedURL(token)})
}

// --- Crew-app invitation (enables login for an existing Person) ---

func (a *API) InviteToCrewApp(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tempPassword, err := randomToken(12)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to invite person")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(tempPassword), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to invite person")
		return
	}
	tag, err := a.DB.Exec(r.Context(),
		`UPDATE people SET password_hash = $1, must_change_password = true, updated_at = now() WHERE id = $2 AND organisation_id = $3`,
		string(hash), id, currentOrgID,
	)
	if err != nil || tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"temporary_password": tempPassword})
}
