package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
	"ralto/internal/notify"
)

// bookingContext is what every notification trigger below needs to render
// its template: role/job/dates/venue plus the identifiers to act on.
type bookingContext struct {
	PersonID  string
	RoleName  string
	JobName   string
	JobID     string
	DatesText string
	Venue     string
}

func (a *API) loadBookingContext(ctx context.Context, bookingID string) (bookingContext, error) {
	var c bookingContext
	err := a.DB.QueryRow(ctx,
		`SELECT b.person_id, ro.name, j.name, j.id,
		        to_char(b.start_date, 'DD Mon') || '–' || to_char(b.end_date, 'DD Mon'),
		        COALESCE(v.name, 'Venue TBC')
		 FROM bookings b
		 JOIN job_requirements jr ON jr.id = b.job_requirement_id
		 JOIN jobs j ON j.id = jr.job_id
		 JOIN roles ro ON ro.id = jr.role_id
		 LEFT JOIN venues v ON v.id = j.venue_id
		 WHERE b.id = $1`,
		bookingID,
	).Scan(&c.PersonID, &c.RoleName, &c.JobName, &c.JobID, &c.DatesText, &c.Venue)
	return c, err
}

func crewCTAURL(path string) string {
	origin := os.Getenv("FRONTEND_ORIGIN")
	if origin == "" {
		origin = "http://localhost:5173"
	}
	return origin + "/crew" + path
}

// bookingWithPersonResponse adds the booked person's name onto the plain
// Booking shape — Jobs' JobRoleRow shows actual names now, not just counts,
// and needs that in the same call rather than a separate lookup per
// booking. Cancelled and Declined bookings are both left out entirely
// rather than returned with a status badge — Jobs shouldn't show anyone no
// longer actually booked (a decline is exactly as "not booked" as a
// cancellation, just recorded before anything was ever confirmed), and
// DeletePerson-style history is already preserved in the row itself for
// anyone who queries it directly.
type bookingWithPersonResponse struct {
	models.Booking
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	// ShiftDates — testing feedback item L — is this booking's actual
	// booking_shifts day coverage (YYYY-MM-DD, ascending), read alongside
	// the booking itself so Jobs/Planner can show which specific days a
	// person covers without a second round trip per booking. Empty for a
	// booking created before this feature existed and never since
	// updated — the frontend treats that the same as full coverage rather
	// than showing a false "0 days" warning (see JobRoleRow/BookedPersonRow).
	ShiftDates []string `json:"shift_dates"`
}

func (a *API) ListBookingsForRequirement(w http.ResponseWriter, r *http.Request) {
	reqID := chi.URLParam(r, "reqId")
	rows, err := a.DB.Query(r.Context(),
		`SELECT b.id, b.job_requirement_id, b.person_id, b.status, b.start_date, b.end_date, b.call_time, b.rate_override,
		        b.offered_at, b.responded_at, b.confirmed_at, b.notes, p.first_name, p.last_name,
		        COALESCE((SELECT array_agg(to_char(bs.date, 'YYYY-MM-DD') ORDER BY bs.date) FROM booking_shifts bs WHERE bs.booking_id = b.id), '{}')
		 FROM bookings b
		 JOIN people p ON p.id = b.person_id
		 WHERE b.job_requirement_id = $1 AND b.status NOT IN ('cancelled', 'declined') AND b.organisation_id = $2
		 ORDER BY b.offered_at`, reqID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list bookings")
		return
	}
	defer rows.Close()

	bookings := []bookingWithPersonResponse{}
	for rows.Next() {
		var b bookingWithPersonResponse
		if err := rows.Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
			&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes, &b.FirstName, &b.LastName, &b.ShiftDates); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list bookings")
			return
		}
		bookings = append(bookings, b)
	}
	writeJSON(w, http.StatusOK, bookings)
}

type createBookingRequest struct {
	PersonID     string               `json:"person_id"`
	StartDate    string               `json:"start_date"`
	EndDate      string               `json:"end_date"`
	CallTime     *string              `json:"call_time"`
	RateOverride *float64             `json:"rate_override"`
	Notes        *string              `json:"notes"`
	Status       models.BookingStatus `json:"status"`
	// Days — testing feedback item L: which specific dates within
	// [StartDate, EndDate] this booking covers. Omitted/empty defaults to
	// every day in the range — see resolveShiftDays in booking_shifts.go.
	Days []string `json:"days,omitempty"`
}

// CreateBooking is the "Offer" (or, per addendum v2 §4, "Pencil") action
// from the Planner screen. Pencilled means you're holding someone without
// having formally asked, so unlike an Offer it does not notify the
// person — see PromoteBookingToOffer for the later "actually ask them"
// step. Also accepts Declined directly — the phone-call-based "Not
// available" action in Planner records a no from a call that never went
// through the digital offer/respond flow, reusing the same status a real
// CrewRespondToOffer decline produces (so it surfaces in the same "Already
// Asked → Declined" list) rather than a separate one-off tracking shape.
// No notification fires for a Declined booking either, same reasoning as
// Pencil: nothing digital happened for the person to be notified about.
// Rejects with 409 if the parent Job is cancelled/complete, mirroring
// Equiptra's live project-status guard on booking creation.
func (a *API) CreateBooking(w http.ResponseWriter, r *http.Request) {
	reqID := chi.URLParam(r, "reqId")
	var req createBookingRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Status == "" {
		req.Status = models.BookingStatusOffered
	}
	if req.Status != models.BookingStatusOffered && req.Status != models.BookingStatusPencilled && req.Status != models.BookingStatusDeclined {
		writeError(w, http.StatusBadRequest, "a new booking must start as pencilled, offered, or declined")
		return
	}
	shiftDays, err := resolveShiftDays(req.StartDate, req.EndDate, req.Days)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var jobStatus models.JobStatus
	if err := a.DB.QueryRow(r.Context(),
		`SELECT j.status FROM job_requirements jr JOIN jobs j ON j.id = jr.job_id WHERE jr.id = $1 AND jr.organisation_id = $2`, reqID, currentOrgID,
	).Scan(&jobStatus); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "job requirement not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create booking")
		return
	}
	if jobStatus == models.JobStatusCancelled || jobStatus == models.JobStatusComplete {
		writeError(w, http.StatusConflict, "job is cancelled or complete — cannot create new bookings")
		return
	}

	// A person can only ever be held against a requirement by one active
	// (Pencilled or Offered) booking at a time. Re-pencilling, offering, or
	// phone-declining someone who's already Pencilled/Offered for this same
	// requirement must transition that existing row, not insert a second
	// one — otherwise the crewing-completeness counts (and the progress
	// bar) double-count the same person, exactly the "half hatched, half
	// solid" bug this guards against. A prior Declined/Cancelled/Confirmed/
	// etc. booking for the same pair is left alone and a fresh row is
	// inserted below, since that's genuine history (previously asked and
	// said no, or already worked it), not the same live hold being
	// re-touched.
	var existingID string
	err = a.DB.QueryRow(r.Context(),
		`SELECT id FROM bookings WHERE job_requirement_id = $1 AND person_id = $2 AND status IN ('pencilled', 'offered') AND organisation_id = $3`,
		reqID, req.PersonID, currentOrgID,
	).Scan(&existingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusInternalServerError, "failed to create booking")
		return
	}

	var b models.Booking
	statusCode := http.StatusCreated
	if existingID != "" {
		statusCode = http.StatusOK
		err = a.DB.QueryRow(r.Context(),
			`UPDATE bookings SET status = $1, start_date = $2, end_date = $3, call_time = $4, rate_override = $5, notes = $6,
			        offered_at = CASE WHEN $1 = 'offered' THEN now() ELSE offered_at END,
			        responded_at = CASE WHEN $1 = 'declined' THEN now() ELSE responded_at END
			 WHERE id = $7
			 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
			req.Status, req.StartDate, req.EndDate, req.CallTime, req.RateOverride, req.Notes, existingID,
		).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
			&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	} else {
		// responded_at is only set up-front for a Declined booking, via the CASE
		// below — recorded as already answered (the phone call itself was the
		// response), whereas a fresh pencil/offer has no response yet.
		err = a.DB.QueryRow(r.Context(),
			`INSERT INTO bookings (job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, notes, offered_at, responded_at, organisation_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), CASE WHEN $3 = 'declined' THEN now() ELSE NULL END, $9)
			 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
			reqID, req.PersonID, req.Status, req.StartDate, req.EndDate, req.CallTime, req.RateOverride, req.Notes, currentOrgID,
		).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
			&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to create booking")
		return
	}

	// Best-effort, like the notification below: the booking itself is
	// already committed, so a shift-sync failure (day-coverage detail)
	// shouldn't fail the whole request — it's logged and the booking
	// still comes back created/updated.
	if err := a.syncBookingShifts(r.Context(), b.ID, shiftDays, b.CallTime); err != nil {
		log.Printf("create booking: syncing booking shifts: %v", err)
	}

	if b.Status == models.BookingStatusOffered {
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			subject, body := notify.RenderBookingOffered(ctx.RoleName, ctx.JobName, ctx.DatesText, crewCTAURL("/offers/"+b.ID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingOffered,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
		}
	}

	writeJSON(w, statusCode, b)
}

// PromoteBookingToOffer is a scheduler turning a pencil into a formal ask —
// the "shouldn't fire an offer notification" line in addendum v2 §4 applies
// only up to this point; from here it behaves exactly like a booking
// created directly as Offered.
func (a *API) PromoteBookingToOffer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var b models.Booking
	err := a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET status = 'offered', offered_at = now() WHERE id = $1 AND status = 'pencilled' AND organisation_id = $2
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		id, currentOrgID,
	).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "booking not found, or not currently pencilled")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to offer booking")
		return
	}

	ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
	if ctxErr == nil {
		subject, body := notify.RenderBookingOffered(ctx.RoleName, ctx.JobName, ctx.DatesText, crewCTAURL("/offers/"+b.ID))
		_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingOffered,
			map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
	}

	writeJSON(w, http.StatusOK, b)
}

type updateBookingRequest struct {
	StartDate    string   `json:"start_date"`
	EndDate      string   `json:"end_date"`
	CallTime     *string  `json:"call_time"`
	RateOverride *float64 `json:"rate_override"`
	Notes        *string  `json:"notes"`
	// Days — see createBookingRequest.Days. Also used on its own (dates/
	// call time/etc unchanged) as the "edit which days this booking
	// covers" action — see UpdateBooking.
	Days []string `json:"days,omitempty"`
}

// UpdateBooking covers call-time/date/venue-adjacent edits to an existing
// booking. If the call time actually changed on a live (offered/confirmed)
// booking, this fires booking_updated — the one trigger that covers call
// time, venue, or date changes uniformly (per the templates doc's own
// reasoning: one trigger, not three near-duplicates).
func (a *API) UpdateBooking(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req updateBookingRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	shiftDays, err := resolveShiftDays(req.StartDate, req.EndDate, req.Days)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var previousCallTime *string
	var status models.BookingStatus
	if err := a.DB.QueryRow(r.Context(), `SELECT call_time, status FROM bookings WHERE id = $1 AND organisation_id = $2`, id, currentOrgID).Scan(&previousCallTime, &status); errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	} else if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update booking")
		return
	}

	var b models.Booking
	err = a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET start_date = $1, end_date = $2, call_time = $3, rate_override = $4, notes = $5
		 WHERE id = $6 AND organisation_id = $7
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		req.StartDate, req.EndDate, req.CallTime, req.RateOverride, req.Notes, id, currentOrgID,
	).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update booking")
		return
	}

	if err := a.syncBookingShifts(r.Context(), b.ID, shiftDays, b.CallTime); err != nil {
		log.Printf("update booking: syncing booking shifts: %v", err)
	}

	callTimeChanged := (previousCallTime == nil) != (req.CallTime == nil) ||
		(previousCallTime != nil && req.CallTime != nil && *previousCallTime != *req.CallTime)
	live := status == models.BookingStatusOffered || status == models.BookingStatusConfirmed
	if callTimeChanged && live && previousCallTime != nil && req.CallTime != nil {
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			change := fmt.Sprintf("Call time moved from %s to %s", *previousCallTime, *req.CallTime)
			subject, body := notify.RenderBookingUpdated(ctx.JobName, change, crewCTAURL("/bookings/"+b.ID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingUpdated,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "change": change, "booking_id": b.ID}, subject, body)

			// Raised so the Today screen's "Call-time change unacknowledged"
			// tracker (same event, staff-facing side — see the templates
			// doc's own note) has something to count. Resolved when the
			// crew member hits Acknowledge — see CrewAcknowledgeBooking.
			if _, err := a.DB.Exec(r.Context(),
				`INSERT INTO operational_alerts (job_id, type, related_entity_id, status, organisation_id) VALUES ($1, 'unacknowledged_update', $2, 'open', $3)`,
				ctx.JobID, b.ID, currentOrgID,
			); err != nil {
				log.Printf("update booking: raising unacknowledged_update alert: %v", err)
			}
		}
	}

	writeJSON(w, http.StatusOK, b)
}

// ConfirmBooking is the scheduler directly confirming a booking (as opposed
// to a crew member accepting an offer — see CrewRespondToOffer).
func (a *API) ConfirmBooking(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var b models.Booking
	err := a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET status = 'confirmed', confirmed_at = now() WHERE id = $1 AND organisation_id = $2
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		id, currentOrgID,
	).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to confirm booking")
		return
	}

	ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
	if ctxErr == nil {
		subject, body := notify.RenderBookingConfirmed(ctx.RoleName, ctx.JobName, ctx.DatesText, crewCTAURL("/bookings/"+b.ID))
		_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingConfirmed,
			map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
	}

	writeJSON(w, http.StatusOK, b)
}

func (a *API) CancelBooking(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var b models.Booking
	err := a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND organisation_id = $2
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		id, currentOrgID,
	).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to cancel booking")
		return
	}

	ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
	if ctxErr == nil {
		subject, body := notify.RenderBookingCancelled(ctx.RoleName, ctx.JobName, ctx.DatesText)
		_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingCancelled,
			map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
	}

	writeJSON(w, http.StatusOK, b)
}

// DeleteBooking only allows removing a booking that's still a bare
// pencil or offer — once anything has happened (a response, a
// confirmation), Cancel is the correct action so the history stays real.
// Mirrors Equiptra's history-vs-existence delete guards.
func (a *API) DeleteBooking(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM bookings WHERE id = $1 AND status IN ('pencilled', 'offered') AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to delete booking")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusConflict, "booking not found, or no longer just a pencil/offer — cancel it instead")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
