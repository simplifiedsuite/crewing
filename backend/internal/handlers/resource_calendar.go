package handlers

import (
	"net/http"
	"strings"
	"time"

	"ralto/internal/models"
)

// Resource calendar — addendum v2 §1. One row per person, one column per
// date; this endpoint is the read model behind that grid. No new entity:
// it queries Person/Booking/Availability/ProspectiveEvent by date window
// and returns the rows the grid needs, leaving cell layout (which is a
// day-by-day rendering concern) to the frontend.

type resourceCalendarBooking struct {
	ID                string               `json:"id"`
	JobID             string               `json:"job_id"`
	JobName           string               `json:"job_name"`
	RoleName          string               `json:"role_name"`
	JobStatus         models.JobStatus     `json:"job_status"`
	JobCommitment     models.JobCommitment `json:"job_commitment"`
	EffectiveColorHex *string              `json:"effective_color_hex,omitempty"`
	Status            models.BookingStatus `json:"status"`
	StartDate         string               `json:"start_date"`
	EndDate           string               `json:"end_date"`
	CallTime          *string              `json:"call_time,omitempty"`
}

type resourceCalendarAvailability struct {
	ID         string                        `json:"id"`
	Status     models.AvailabilityStatus     `json:"status"`
	Type       *models.AvailabilityType      `json:"type,omitempty"`
	DayPortion models.AvailabilityDayPortion `json:"day_portion"`
	StartDate  string                        `json:"start_date"`
	EndDate    string                        `json:"end_date"`
	Notes      *string                       `json:"notes,omitempty"`
}

type resourceCalendarRow struct {
	PersonID       string                         `json:"person_id"`
	Name           string                         `json:"name"`
	EmploymentType models.EmploymentType          `json:"employment_type"`
	Bookings       []resourceCalendarBooking      `json:"bookings"`
	Availability   []resourceCalendarAvailability `json:"availability"`
}

type resourceCalendarResponse struct {
	StartDate         string                    `json:"start_date"`
	EndDate           string                    `json:"end_date"`
	Rows              []resourceCalendarRow     `json:"rows"`
	ProspectiveEvents []models.ProspectiveEvent `json:"prospective_events"`
}

// GetResourceCalendar builds the "people down, dates across" grid.
//
// Row inclusion (the part addendum v2 §1 calls out as load-bearing):
//   - Staff: always included, whether or not they have anything this window.
//   - Freelancers: included only if they have a Booking (any status,
//     including Pencilled/Offered) or an Availability row overlapping the
//     window — otherwise the grid would be as large as the whole freelancer
//     pool.
//   - Explicitly requested via ?include=: added for this call regardless —
//     this is how a scheduler pulls in one specific freelancer to check
//     them against the grid. Not persisted; the frontend owns re-sending
//     it on subsequent requests for the session.
//
// Cell precedence (a Booking overlapping an Unavailable Availability row)
// is deliberately not resolved here — both are returned as-is, and the
// frontend renders both and flags the overlap, per the doc's "render both
// and flag it rather than picking a winner."
func (a *API) GetResourceCalendar(w http.ResponseWriter, r *http.Request) {
	start, end, err := parseCalendarWindow(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	include := parseIncludeIDs(r.URL.Query().Get("include"))

	peopleRows, err := a.DB.Query(r.Context(), `
		SELECT p.id, p.first_name || ' ' || p.last_name, p.employment_type
		FROM people p
		WHERE p.organisation_id = $4 AND p.status = 'active' AND (
			p.employment_type = 'staff'
			OR p.id = ANY($3::uuid[])
			OR EXISTS (SELECT 1 FROM bookings b WHERE b.person_id = p.id AND b.organisation_id = $4 AND b.start_date <= $2 AND b.end_date >= $1)
			OR EXISTS (SELECT 1 FROM availability av WHERE av.person_id = p.id AND av.organisation_id = $4 AND av.start_date <= $2 AND av.end_date >= $1)
		)
		ORDER BY p.employment_type, p.first_name, p.last_name`,
		start, end, include, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
		return
	}

	rowsByPerson := map[string]*resourceCalendarRow{}
	order := []string{}
	for peopleRows.Next() {
		var row resourceCalendarRow
		if err := peopleRows.Scan(&row.PersonID, &row.Name, &row.EmploymentType); err != nil {
			peopleRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
			return
		}
		row.Bookings = []resourceCalendarBooking{}
		row.Availability = []resourceCalendarAvailability{}
		rowsByPerson[row.PersonID] = &row
		order = append(order, row.PersonID)
	}
	peopleRows.Close()

	personIDs := make([]string, 0, len(order))
	personIDs = append(personIDs, order...)

	bookingRows, err := a.DB.Query(r.Context(), `
		SELECT b.person_id, b.id, jr.job_id, j.name, ro.name, j.status, j.commitment,
		       COALESCE(j.color_hex, proj.color_hex, cl.brand_color_hex),
		       b.status, b.start_date, b.end_date, b.call_time
		FROM bookings b
		JOIN job_requirements jr ON jr.id = b.job_requirement_id
		JOIN jobs j ON j.id = jr.job_id
		JOIN roles ro ON ro.id = jr.role_id
		LEFT JOIN projects proj ON proj.id = j.project_id
		LEFT JOIN clients cl ON cl.id = j.client_id
		WHERE b.person_id = ANY($1::uuid[]) AND b.organisation_id = $4 AND b.start_date <= $3 AND b.end_date >= $2
		ORDER BY b.start_date`,
		personIDs, start, end, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
		return
	}
	for bookingRows.Next() {
		var personID string
		var b resourceCalendarBooking
		if err := bookingRows.Scan(&personID, &b.ID, &b.JobID, &b.JobName, &b.RoleName, &b.JobStatus, &b.JobCommitment,
			&b.EffectiveColorHex, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime); err != nil {
			bookingRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
			return
		}
		if row, ok := rowsByPerson[personID]; ok {
			row.Bookings = append(row.Bookings, b)
		}
	}
	bookingRows.Close()

	availabilityRows, err := a.DB.Query(r.Context(), `
		SELECT person_id, id, status, type, day_portion, start_date, end_date, notes
		FROM availability
		WHERE person_id = ANY($1::uuid[]) AND organisation_id = $4 AND start_date <= $3 AND end_date >= $2
		ORDER BY start_date`,
		personIDs, start, end, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
		return
	}
	for availabilityRows.Next() {
		var personID string
		var av resourceCalendarAvailability
		if err := availabilityRows.Scan(&personID, &av.ID, &av.Status, &av.Type, &av.DayPortion, &av.StartDate, &av.EndDate, &av.Notes); err != nil {
			availabilityRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
			return
		}
		if row, ok := rowsByPerson[personID]; ok {
			row.Availability = append(row.Availability, av)
		}
	}
	availabilityRows.Close()

	eventRows, err := a.DB.Query(r.Context(),
		`SELECT `+prospectiveEventColumns+` FROM prospective_events
		 WHERE status = 'open' AND organisation_id = $3 AND date_start <= $2 AND date_end >= $1
		 ORDER BY date_start`, start, end, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
		return
	}
	events := []models.ProspectiveEvent{}
	for eventRows.Next() {
		var e models.ProspectiveEvent
		if err := scanProspectiveEvent(eventRows, &e); err != nil {
			eventRows.Close()
			writeError(w, http.StatusInternalServerError, "failed to load resource calendar")
			return
		}
		events = append(events, e)
	}
	eventRows.Close()

	resp := resourceCalendarResponse{StartDate: start, EndDate: end, ProspectiveEvents: events}
	for _, id := range order {
		resp.Rows = append(resp.Rows, *rowsByPerson[id])
	}
	writeJSON(w, http.StatusOK, resp)
}

// parseCalendarWindow defaults to the current calendar month — the doc's
// confirmed default window — when start/end aren't supplied, so the
// endpoint is usable on first load before the frontend has computed
// month boundaries for prev/next navigation.
func parseCalendarWindow(startParam, endParam string) (string, string, error) {
	if startParam == "" || endParam == "" {
		now := time.Now().UTC()
		firstOfMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		lastOfMonth := firstOfMonth.AddDate(0, 1, -1)
		return firstOfMonth.Format("2006-01-02"), lastOfMonth.Format("2006-01-02"), nil
	}
	if _, err := time.Parse("2006-01-02", startParam); err != nil {
		return "", "", err
	}
	if _, err := time.Parse("2006-01-02", endParam); err != nil {
		return "", "", err
	}
	return startParam, endParam, nil
}

func parseIncludeIDs(raw string) []string {
	if raw == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	ids := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			ids = append(ids, p)
		}
	}
	return ids
}
