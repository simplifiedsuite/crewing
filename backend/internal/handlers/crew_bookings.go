package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/middleware"
	"ralto/internal/models"
	"ralto/internal/notify"
)

// crewBookingResponse flattens in job/venue/client display fields so the
// crew mobile app's Home/JobDetail screens don't need N+1 lookups —
// mirrors the ralto-crew-mobile.jsx mock shape (NEXT_JOB, UPCOMING).
//
// ClientColorHex — testing feedback: the crew app never got the client-
// colour treatment desktop's Planner already has (a stripe/border,
// separate from the status icon/colour so the two channels never
// collide — see desktop's own clientColor/FALLBACK_CLIENT_COLORS). Nil
// when the Client has no brand_color_hex set; the frontend falls back to
// the same default indigo it already uses everywhere.
type crewBookingResponse struct {
	models.Booking
	RoleName       string  `json:"role_name"`
	JobName        string  `json:"job_name"`
	ClientName     string  `json:"client_name"`
	ClientColorHex *string `json:"client_color_hex,omitempty"`
	VenueName      *string `json:"venue_name,omitempty"`
	// VenueAddress/City/Country — the Venue's own Core-synced address
	// fields (see Venue.core_location_id), for the crew app's "open in
	// Maps" link. Absent whenever a Venue was created/edited manually
	// without a Core Location behind it, same as Venue itself is absent
	// whenever no venue is set at all — the frontend falls back
	// accordingly in both cases rather than treating either as an error.
	VenueAddress *string `json:"venue_address,omitempty"`
	VenueCity    *string `json:"venue_city,omitempty"`
	VenueCountry *string `json:"venue_country,omitempty"`
	JobStartDate string  `json:"job_start_date"`
	JobEndDate   string  `json:"job_end_date"`
}

const crewBookingSelect = `
	SELECT b.id, b.job_requirement_id, b.person_id, b.status, b.start_date, b.end_date, b.call_time,
	       b.rate_override, b.offered_at, b.responded_at, b.confirmed_at, b.notes,
	       ro.name, j.name, c.name, c.brand_color_hex, v.name, v.address, v.city, v.country, j.start_date, j.end_date
	FROM bookings b
	JOIN job_requirements jr ON jr.id = b.job_requirement_id
	JOIN jobs j ON j.id = jr.job_id
	JOIN clients c ON c.id = j.client_id
	JOIN roles ro ON ro.id = jr.role_id
	LEFT JOIN venues v ON v.id = j.venue_id
`

func scanCrewBooking(rows pgx.Rows, b *crewBookingResponse) error {
	return rows.Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes,
		&b.RoleName, &b.JobName, &b.ClientName, &b.ClientColorHex, &b.VenueName, &b.VenueAddress, &b.VenueCity, &b.VenueCountry, &b.JobStartDate, &b.JobEndDate)
}

// ListMyBookings returns everything except declined/cancelled — the crew
// app's Home screen splits pending offers from confirmed upcoming work
// itself based on `status`.
//
// Testing feedback AA — Booking.status and Job.status are separate axes
// (see JobsContent's own "internal progress" vs. derived-tag comment on
// the scheduler side): marking a Job complete or cancelled never touches
// its Bookings' own status, so a Booking can sit at status='confirmed'
// forever after its Job is archived. Confirmed directly: a real completed,
// past-dated Job ("MDL Derby Screening") was still showing as the crew
// member's "Next job". Excluding j.status and j.end_date here (not just
// b.status) is what actually fixes it — a job-level status/date filter, not
// a booking-level one, matching what the report asked for.
//
// Pencilled — shown to staff always, and to a freelancer only once they've
// actually responded. Originally "staff only, full stop" (a Pencil was
// purely a scheduler's own provisional hold before any ask went out — a
// freelancer seeing their own name informally pencilled, before anyone had
// asked them, would be confusing at best). Addendum v3 changed what
// Pencilled means for a freelancer: it's now also the informal-hold state
// their own Accept lands on (they said yes, they got a "you're pencilled"
// notice — see RespondToOffer/RecordBookingResponse/RespondToBookingOffer),
// and that one very much should be visible to them. response_channel is
// exactly the signal that tells the two apart: null means "scheduler's own
// provisional hold, no ask sent" (still hidden); set means "a real response
// actually happened" (now visible, freelancer or staff either way).
func (a *API) ListMyBookings(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	rows, err := a.DB.Query(r.Context(),
		crewBookingSelect+` WHERE b.person_id = $1 AND b.status NOT IN ('declined', 'cancelled') AND b.organisation_id = $2
		                     AND (b.status != 'pencilled' OR b.response_channel IS NOT NULL OR EXISTS (
		                           SELECT 1 FROM people p WHERE p.id = $1 AND p.organisation_id = $2 AND p.employment_type = 'staff'
		                         ))
		                     AND j.status NOT IN ('complete', 'cancelled') AND j.end_date >= CURRENT_DATE
		                     ORDER BY b.start_date`,
		claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list bookings")
		return
	}
	defer rows.Close()

	bookings := []crewBookingResponse{}
	for rows.Next() {
		var b crewBookingResponse
		if err := scanCrewBooking(rows, &b); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list bookings")
			return
		}
		bookings = append(bookings, b)
	}
	writeJSON(w, http.StatusOK, bookings)
}

// GetMyBooking mirrors ListMyBookings' own Pencilled visibility guard (see
// its comment) — not reachable from the current UI (JobDetailScreen only
// ever opens a booking already returned by ListMyBookings), but a direct
// API call with a booking id a freelancer happened to already have
// shouldn't be able to read a still-provisional (no response recorded)
// Pencilled booking's details just because the list-level guard doesn't
// apply to a single-id lookup.
func (a *API) GetMyBooking(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	id := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		crewBookingSelect+` WHERE b.id = $1 AND b.person_id = $2 AND b.organisation_id = $3
		                     AND (b.status != 'pencilled' OR b.response_channel IS NOT NULL OR EXISTS (
		                           SELECT 1 FROM people p WHERE p.id = $2 AND p.organisation_id = $3 AND p.employment_type = 'staff'
		                         ))`,
		id, claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get booking")
		return
	}
	defer rows.Close()
	if !rows.Next() {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}
	var b crewBookingResponse
	if err := scanCrewBooking(rows, &b); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get booking")
		return
	}
	writeJSON(w, http.StatusOK, b)
}

type respondToOfferRequest struct {
	Response string `json:"response"` // "accept" | "decline"
}

// RespondToOffer is the crew-side (logged-in) half of the offer response —
// alongside, not instead of, the token-based public flow the actual offer
// email now uses (RespondToBookingOffer in booking_response_tokens.go): a
// freelancer who happens to be logged into the crew app can respond here
// directly rather than via the emailed link, and both must produce the
// same end state.
//
// Addendum v3 §1: for a freelancer, Accept lands on Pencilled (an
// informal hold — a scheduler presses Confirm separately, once terms are
// settled), not Confirmed directly. Staff are structurally never Offered
// in the first place (CreateBooking upgrades them straight to Confirmed at
// creation — see its own comment), so the Confirmed branch below is dead
// code for them today, kept only so this doesn't silently misbehave if
// that invariant ever changes.
func (a *API) RespondToOffer(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	id := chi.URLParam(r, "id")

	var req respondToOfferRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Response != "accept" && req.Response != "decline" {
		writeError(w, http.StatusBadRequest, "response must be accept or decline")
		return
	}

	var employmentType models.EmploymentType
	if err := a.DB.QueryRow(r.Context(), `SELECT employment_type FROM people WHERE id = $1`, claims.PersonID).Scan(&employmentType); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to respond to offer")
		return
	}

	var newStatus models.BookingStatus
	switch {
	case req.Response == "decline":
		newStatus = models.BookingStatusDeclined
	case employmentType == models.EmploymentTypeFreelancer:
		newStatus = models.BookingStatusPencilled
	default:
		newStatus = models.BookingStatusConfirmed
	}

	var b models.Booking
	err := a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET status = $1, responded_at = now(), response_channel = 'self_service',
		        confirmed_at = CASE WHEN $1 = 'confirmed' THEN now() ELSE confirmed_at END
		 WHERE id = $2 AND person_id = $3 AND status = 'offered' AND organisation_id = $4
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		newStatus, id, claims.PersonID, currentOrgID,
	).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "offer not found, or already responded to")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to respond to offer")
		return
	}

	if err := a.invalidateBookingResponseTokens(r.Context(), b.ID); err != nil {
		log.Printf("respond to offer: invalidating response tokens: %v", err)
	}

	switch newStatus {
	case models.BookingStatusConfirmed:
		// No buyout PDF here (Addendum v3 §5 is freelancer-only) — this
		// branch is only reached for non-freelancers; a freelancer's own
		// accept goes to Pencilled below instead (see the switch above
		// this function's own UPDATE), never straight to Confirmed.
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			subject, body := notify.RenderBookingConfirmed(ctx.RoleName, ctx.JobName, ctx.DatesText, crewCTAURL("/bookings/"+b.ID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingConfirmed,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
		}
	case models.BookingStatusPencilled:
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			callTimeText := "TBC"
			if ctx.CallTime != nil {
				callTimeText = *ctx.CallTime
			}
			subject, body := notify.RenderBookingPencilled(ctx.RoleName, ctx.JobName, ctx.DatesText, ctx.Venue, callTimeText, crewCTAURL("/bookings/"+b.ID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingPencilled,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
			// Testing feedback #63 — let the scheduler know without having
			// to keep re-checking the Job themselves.
			if _, err := a.DB.Exec(r.Context(),
				`INSERT INTO operational_alerts (job_id, type, related_entity_id, status, organisation_id) VALUES ($1, 'freelancer_accepted', $2, 'open', $3)`,
				ctx.JobID, b.ID, currentOrgID,
			); err != nil {
				log.Printf("respond to offer: raising freelancer_accepted alert: %v", err)
			}
		}
	}

	writeJSON(w, http.StatusOK, b)
}

// GetMyBookingContact returns the primary production contact for a crew
// member's own booking's Job — JobContact itself is a staff-managed
// resource (/api/jobs/{id}/contacts), not reachable from a crew session,
// so this is the narrow, ownership-checked read crew's JobDetail screen
// actually needs. Same Pencilled visibility guard as GetMyBooking (see its
// own comment) — a freelancer shouldn't learn a production contact's
// details for a still-provisional hold they haven't actually responded to.
func (a *API) GetMyBookingContact(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	bookingID := chi.URLParam(r, "id")

	var contact models.JobContact
	err := a.DB.QueryRow(r.Context(), `
		SELECT jc.id, jc.job_id, jc.name, jc.role_title, jc.email, jc.phone
		FROM job_contacts jc
		JOIN jobs j ON j.id = jc.job_id
		JOIN job_requirements jr ON jr.job_id = j.id
		JOIN bookings b ON b.job_requirement_id = jr.id
		WHERE b.id = $1 AND b.person_id = $2 AND b.organisation_id = $3
		      AND (b.status != 'pencilled' OR b.response_channel IS NOT NULL OR EXISTS (
		            SELECT 1 FROM people p WHERE p.id = $2 AND p.organisation_id = $3 AND p.employment_type = 'staff'
		          ))
		ORDER BY jc.name
		LIMIT 1`,
		bookingID, claims.PersonID, currentOrgID,
	).Scan(&contact.ID, &contact.JobID, &contact.Name, &contact.RoleTitle, &contact.Email, &contact.Phone)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "no contact on file for this job")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get contact")
		return
	}
	writeJSON(w, http.StatusOK, contact)
}

// crewOnJob is one other person confirmed on the same Job as the caller's
// own booking — deliberately just name + role, not the full crewBookingResponse
// shape (this is "who else is on this job", not another bookable resource).
type crewOnJob struct {
	PersonID  string `json:"person_id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	RoleName  string `json:"role_name"`
}

// GetMyBookingCrew lists everyone else Confirmed on the same Job as the
// caller's own booking — reported gap: a crew member had no way to see who
// else was on a job. Confirmed only, never Pencilled/Offered/Declined —
// someone merely asked (or provisionally held) isn't locked in yet, and a
// crew member has no business knowing who's been approached. Same
// ownership + Pencilled-visibility guard as GetMyBookingContact (see its
// own comment) gates whether the caller can see this at all; the caller
// themselves is excluded from the list (it answers "who ELSE").
func (a *API) GetMyBookingCrew(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	bookingID := chi.URLParam(r, "id")

	rows, err := a.DB.Query(r.Context(), `
		SELECT p.id, p.first_name, p.last_name, ro.name
		FROM bookings b2
		JOIN job_requirements jr2 ON jr2.id = b2.job_requirement_id
		JOIN roles ro ON ro.id = jr2.role_id
		JOIN people p ON p.id = b2.person_id
		WHERE jr2.job_id = (
			SELECT jr.job_id
			FROM bookings b
			JOIN job_requirements jr ON jr.id = b.job_requirement_id
			WHERE b.id = $1 AND b.person_id = $2 AND b.organisation_id = $3
			      AND (b.status != 'pencilled' OR b.response_channel IS NOT NULL OR EXISTS (
			            SELECT 1 FROM people pp WHERE pp.id = $2 AND pp.organisation_id = $3 AND pp.employment_type = 'staff'
			          ))
		)
		AND b2.status = 'confirmed'
		AND b2.person_id != $2
		AND b2.organisation_id = $3
		ORDER BY p.first_name, p.last_name`,
		bookingID, claims.PersonID, currentOrgID,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get job crew")
		return
	}
	defer rows.Close()

	out := []crewOnJob{}
	for rows.Next() {
		var c crewOnJob
		if err := rows.Scan(&c.PersonID, &c.FirstName, &c.LastName, &c.RoleName); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get job crew")
			return
		}
		out = append(out, c)
	}
	writeJSON(w, http.StatusOK, out)
}

// AcknowledgeBooking is the crew-side "Acknowledge" action on a
// booking_updated notification (call-time/venue/date change) — resolves
// the matching unacknowledged_update OperationalAlert raised by
// UpdateBooking, which is what the scheduler's Today screen tracker counts.
func (a *API) AcknowledgeBooking(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	bookingID := chi.URLParam(r, "id")

	var owns bool
	if err := a.DB.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM bookings WHERE id = $1 AND person_id = $2 AND organisation_id = $3)`, bookingID, claims.PersonID, currentOrgID).Scan(&owns); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to acknowledge booking")
		return
	}
	if !owns {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}

	if _, err := a.DB.Exec(r.Context(),
		`UPDATE operational_alerts SET status = 'resolved', resolved_at = now()
		 WHERE type = 'unacknowledged_update' AND related_entity_id = $1 AND status = 'open' AND organisation_id = $2`,
		bookingID, currentOrgID,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to acknowledge booking")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
