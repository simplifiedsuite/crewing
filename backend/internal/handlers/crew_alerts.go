package handlers

import (
	"net/http"

	"ralto/internal/middleware"
	"ralto/internal/models"
)

type crewAlertResponse struct {
	models.OperationalAlert
	JobName string `json:"job_name"`
}

// ListMyOpenAlerts scopes operational_alerts down to the ones relevant to
// this crew member — currently just unacknowledged_update, since that's
// the one alert type whose related_entity_id is a Booking the crew member
// themself owns (AutoSuggestedBooking and the rest are scheduler-only
// concerns raised against a Job, not a specific person). Powers the crew
// Home screen's "needs your attention" section alongside pending offers.
//
// Testing feedback AA — same job-status/date gap as ListMyBookings: an
// unacknowledged_update alert only ever gets resolved by the crew member
// acknowledging it (see AcknowledgeBooking), never by the Job it's against
// completing or being cancelled, so a stale alert against an archived Job
// could otherwise sit in "needs your attention" indefinitely.
func (a *API) ListMyOpenAlerts(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	rows, err := a.DB.Query(r.Context(), `
		SELECT oa.id, oa.job_id, oa.type, oa.related_entity_id, oa.status, oa.created_at, oa.resolved_at, j.name
		FROM operational_alerts oa
		JOIN jobs j ON j.id = oa.job_id
		JOIN bookings b ON b.id = oa.related_entity_id
		WHERE oa.type = 'unacknowledged_update' AND oa.status = 'open' AND b.person_id = $1 AND oa.organisation_id = $2
		      AND j.status NOT IN ('complete', 'cancelled') AND j.end_date >= CURRENT_DATE
		ORDER BY oa.created_at DESC`, claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	defer rows.Close()

	alerts := []crewAlertResponse{}
	for rows.Next() {
		var al crewAlertResponse
		if err := rows.Scan(&al.ID, &al.JobID, &al.Type, &al.RelatedEntityID, &al.Status, &al.CreatedAt, &al.ResolvedAt, &al.JobName); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list alerts")
			return
		}
		alerts = append(alerts, al)
	}
	writeJSON(w, http.StatusOK, alerts)
}
