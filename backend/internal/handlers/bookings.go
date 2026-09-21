package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"ralto/internal/models"
	"ralto/internal/notify"
)

// bookingContext is what every notification trigger below needs to render
// its template: role/job/dates/venue/call time plus the identifiers to act on.
type bookingContext struct {
	PersonID  string
	RoleName  string
	JobName   string
	JobID     string
	DatesText string
	Venue     string
	// CallTime — added for RenderBookingPencilled (Addendum v3 §4, the one
	// trigger that wants it inline in the email rather than leaving it to
	// "open Ralto for details"). nil means TBC, same as everywhere else
	// call_time is nullable.
	CallTime *string
}

func (a *API) loadBookingContext(ctx context.Context, bookingID string) (bookingContext, error) {
	var c bookingContext
	err := a.DB.QueryRow(ctx,
		`SELECT b.person_id, ro.name, j.name, j.id,
		        to_char(b.start_date, 'DD Mon') || '–' || to_char(b.end_date, 'DD Mon'),
		        COALESCE(v.name, 'Venue TBC'), b.call_time
		 FROM bookings b
		 JOIN job_requirements jr ON jr.id = b.job_requirement_id
		 JOIN jobs j ON j.id = jr.job_id
		 JOIN roles ro ON ro.id = jr.role_id
		 LEFT JOIN venues v ON v.id = j.venue_id
		 WHERE b.id = $1`,
		bookingID,
	).Scan(&c.PersonID, &c.RoleName, &c.JobName, &c.JobID, &c.DatesText, &c.Venue, &c.CallTime)
	return c, err
}

func crewCTAURL(path string) string {
	return frontendOrigin() + "/crew" + path
}

// staffCTAURL — scheduler/staff's own equivalent, at the root of the
// frontend rather than under /crew (see App.tsx's SchedulerShell vs
// CrewShell split).
func staffCTAURL(path string) string {
	return frontendOrigin() + path
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
	// EmploymentType — Addendum v3 §1/§3. Planner's BookedPersonRow needs
	// this to gate Confirm correctly (freelancer: pencilled only) and to
	// show the "record a phone response" actions (freelancer + offered
	// only, see RecordBookingResponse) — staff are unaffected either way.
	EmploymentType models.EmploymentType `json:"employment_type"`
}

func (a *API) ListBookingsForRequirement(w http.ResponseWriter, r *http.Request) {
	reqID := chi.URLParam(r, "reqId")
	rows, err := a.DB.Query(r.Context(),
		`SELECT b.id, b.job_requirement_id, b.person_id, b.status, b.start_date, b.end_date, b.call_time, b.rate_override,
		        b.offered_at, b.responded_at, b.confirmed_at, b.notes, p.first_name, p.last_name, p.employment_type,
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
			&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes, &b.FirstName, &b.LastName, &b.EmploymentType, &b.ShiftDates); err != nil {
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
// Equiptra's live project-status guard on booking creation. A request for
// Offered against a Staff person is silently upgraded to Confirmed (see
// effectiveStatus below) — a scheduler directly picking someone for a
// role is already a firm ask, unlike a Freelancer offer awaiting a
// response.
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

	// Testing feedback "Direct-confirm staff bookings, skip the offer
	// step": a scheduler adding a Staff person directly to a role here is
	// already a firm, specific ask — unlike the generic AvailabilityRequest
	// auto-draft path (see autoSuggestBooking in crew_availability.go,
	// which inserts its own 'offered' row directly and never calls this
	// handler), so it can skip Offered and land straight on Confirmed.
	// Freelancers are unaffected. effectiveStatus (not req.Status) is what
	// actually gets written below and is what the notification branches on.
	effectiveStatus := req.Status
	if effectiveStatus == models.BookingStatusOffered {
		var employmentType models.EmploymentType
		if err := a.DB.QueryRow(r.Context(),
			`SELECT employment_type FROM people WHERE id = $1 AND organisation_id = $2`,
			req.PersonID, currentOrgID,
		).Scan(&employmentType); err != nil {
			writeError(w, http.StatusBadRequest, "failed to look up person")
			return
		}
		if employmentType == models.EmploymentTypeStaff {
			effectiveStatus = models.BookingStatusConfirmed
		}
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
			        responded_at = CASE WHEN $1 = 'declined' THEN now() ELSE responded_at END,
			        confirmed_at = CASE WHEN $1 = 'confirmed' THEN now() ELSE confirmed_at END
			 WHERE id = $7
			 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
			effectiveStatus, req.StartDate, req.EndDate, req.CallTime, req.RateOverride, req.Notes, existingID,
		).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
			&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	} else {
		// responded_at is only set up-front for a Declined booking, via the CASE
		// below — recorded as already answered (the phone call itself was the
		// response), whereas a fresh pencil/offer has no response yet.
		// confirmed_at is set the same way for a fresh staff booking that
		// lands straight on Confirmed (effectiveStatus above) — offered_at
		// still gets its usual now() regardless, since it's NOT NULL and
		// there's no reason to leave it unset just because Offered was
		// skipped.
		err = a.DB.QueryRow(r.Context(),
			`INSERT INTO bookings (job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, notes, offered_at, responded_at, confirmed_at, organisation_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), CASE WHEN $3 = 'declined' THEN now() ELSE NULL END, CASE WHEN $3 = 'confirmed' THEN now() ELSE NULL END, $9)
			 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
			reqID, req.PersonID, effectiveStatus, req.StartDate, req.EndDate, req.CallTime, req.RateOverride, req.Notes, currentOrgID,
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

	switch b.Status {
	case models.BookingStatusOffered:
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			subject, body := notify.RenderBookingOffered(ctx.RoleName, ctx.JobName, ctx.DatesText, a.offerCTAURL(r.Context(), b.ID, ctx.PersonID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingOffered,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
		}
	case models.BookingStatusConfirmed:
		// The direct-confirm-staff path above — same notification a
		// scheduler's explicit ConfirmBooking sends, since from the
		// person's point of view it's the same thing: booked, nothing to
		// accept or decline. RenderBookingConfirmed says "you're
		// confirmed", never "offer", so it doesn't misrepresent this as
		// awaiting a response.
		//
		// No buyout PDF here (Addendum v3 §5 is freelancer-only): this
		// branch is only ever reached for staff — req.Status is validated
		// above to only ever be pencilled/offered/declined on creation, so
		// the only way b.Status ends up Confirmed here is the staff
		// auto-upgrade a few lines up, which is itself gated to
		// employment_type == staff.
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			subject, body := notify.RenderBookingConfirmed(ctx.RoleName, ctx.JobName, ctx.DatesText, crewCTAURL("/bookings/"+b.ID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingConfirmed,
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
		subject, body := notify.RenderBookingOffered(ctx.RoleName, ctx.JobName, ctx.DatesText, a.offerCTAURL(r.Context(), b.ID, ctx.PersonID))
		_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingOffered,
			map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
	}

	writeJSON(w, http.StatusOK, b)
}

type recordBookingResponseRequest struct {
	Response string `json:"response"` // "pencil" | "decline"
}

// RecordBookingResponse is the scheduler-manual half of Addendum v3 §3 —
// a scheduler recording a freelancer's phone/WhatsApp/in-person response
// to an outstanding offer, as a first-class alternative to the self-
// service token flow (RespondToBookingOffer), not a fallback for it.
// Requires the booking to currently be Offered — a scheduler using this to
// record "they said yes" or "they said no" to an ask that's actually gone
// out, matching the same Offered -> Pencilled | Declined transition the
// token/app self-service paths use. Confirming (Pencilled -> Confirmed) is
// ConfirmBooking, not this — this only covers the response to the original
// ask.
func (a *API) RecordBookingResponse(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req recordBookingResponseRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var newStatus models.BookingStatus
	switch req.Response {
	case "pencil":
		newStatus = models.BookingStatusPencilled
	case "decline":
		newStatus = models.BookingStatusDeclined
	default:
		writeError(w, http.StatusBadRequest, "response must be pencil or decline")
		return
	}

	var b models.Booking
	err := a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET status = $1, responded_at = now(), response_channel = 'scheduler_manual'
		 WHERE id = $2 AND status = 'offered' AND organisation_id = $3
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		newStatus, id, currentOrgID,
	).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
		&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "booking not found, or not currently offered")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to record response")
		return
	}

	if err := a.invalidateBookingResponseTokens(r.Context(), b.ID); err != nil {
		log.Printf("record booking response: invalidating response tokens: %v", err)
	}

	if newStatus == models.BookingStatusPencilled {
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			callTimeText := "TBC"
			if ctx.CallTime != nil {
				callTimeText = *ctx.CallTime
			}
			subject, body := notify.RenderBookingPencilled(ctx.RoleName, ctx.JobName, ctx.DatesText, ctx.Venue, callTimeText, crewCTAURL("/bookings/"+b.ID))
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingPencilled,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
		}
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
	// Bug fix — the extra `previousCallTime != nil && req.CallTime != nil`
	// guard here used to silently drop the two most common real cases: a
	// call time being set for the first time (very common — Booking.call_time
	// is routinely left unset at pencil/offer time, see the iCal feed's own
	// nullable handling) or being cleared back to TBC. callTimeChanged above
	// already correctly detects both as real changes ("if the call time
	// actually changed... this fires", per this function's own doc comment);
	// the guard only existed to protect the Sprintf below from a nil
	// dereference, which the three-way switch now handles directly instead
	// of narrowing which changes count as changes.
	if callTimeChanged && live {
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			var change string
			switch {
			case previousCallTime == nil:
				change = fmt.Sprintf("Call time set to %s", *req.CallTime)
			case req.CallTime == nil:
				change = fmt.Sprintf("Call time removed (was %s)", *previousCallTime)
			default:
				change = fmt.Sprintf("Call time moved from %s to %s", *previousCallTime, *req.CallTime)
			}
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

// ConfirmBooking is the scheduler directly confirming a booking (Confirm or
// Confirm Everyone — the latter is just the frontend calling this once per
// pending booking, no separate bulk endpoint) — as opposed to a crew
// member accepting an offer — see RespondToOffer.
//
// Addendum v3 §1: for a freelancer, Confirmed is only reached from
// Pencilled (Offered -> Confirmed directly is not a valid transition once
// someone actually has to say yes first) — staff are unaffected, since
// this whole state-machine addition is scoped to freelancers (see
// CreateBooking's own direct-confirm-staff comment). confirmed_by/
// response_channel are set for both personas though: any press of Confirm
// is a scheduler action worth recording, regardless of whose booking it is.
func (a *API) ConfirmBooking(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID, _ := staffClaimsFromContext(r)

	var status models.BookingStatus
	var employmentType models.EmploymentType
	err := a.DB.QueryRow(r.Context(),
		`SELECT b.status, p.employment_type FROM bookings b JOIN people p ON p.id = b.person_id WHERE b.id = $1 AND b.organisation_id = $2`,
		id, currentOrgID,
	).Scan(&status, &employmentType)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to confirm booking")
		return
	}

	if employmentType == models.EmploymentTypeFreelancer && status != models.BookingStatusPencilled {
		if status == models.BookingStatusConfirmed {
			// Idempotent re-confirm (e.g. Confirm Everyone re-run, or a
			// double-click) — same end state, no re-fire, no error.
			var b models.Booking
			if err := a.DB.QueryRow(r.Context(),
				`SELECT id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes FROM bookings WHERE id = $1`,
				id,
			).Scan(&b.ID, &b.JobRequirementID, &b.PersonID, &b.Status, &b.StartDate, &b.EndDate, &b.CallTime,
				&b.RateOverride, &b.OfferedAt, &b.RespondedAt, &b.ConfirmedAt, &b.Notes); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to confirm booking")
				return
			}
			writeJSON(w, http.StatusOK, b)
			return
		}
		writeError(w, http.StatusConflict, "a freelancer booking must be pencilled before it can be confirmed")
		return
	}

	var b models.Booking
	err = a.DB.QueryRow(r.Context(),
		`UPDATE bookings SET status = 'confirmed', confirmed_at = now(), confirmed_by = $1, response_channel = 'scheduler_manual'
		 WHERE id = $2 AND organisation_id = $3
		 RETURNING id, job_requirement_id, person_id, status, start_date, end_date, call_time, rate_override, offered_at, responded_at, confirmed_at, notes`,
		userID, id, currentOrgID,
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

	if err := a.invalidateBookingResponseTokens(r.Context(), b.ID); err != nil {
		log.Printf("confirm booking: invalidating response tokens: %v", err)
	}

	ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
	if ctxErr == nil {
		subject, body := notify.RenderBookingConfirmed(ctx.RoleName, ctx.JobName, ctx.DatesText, crewCTAURL("/bookings/"+b.ID))
		// Buyout PDF (Addendum v3 §5) — freelancer only, per the addendum's
		// scope throughout. employmentType is already in scope from the
		// Pencilled-gate check above, so no extra lookup needed here.
		var attachments []notify.Attachment
		if employmentType == models.EmploymentTypeFreelancer {
			if att := a.buyoutAttachment(r.Context(), b.ID); att != nil {
				attachments = append(attachments, *att)
			}
		}
		_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingConfirmed,
			map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body, attachments...)
	}

	writeJSON(w, http.StatusOK, b)
}

// CancelBooking notifies the person unless the booking was still just a
// Pencil — a Pencil never notified anyone when it was created (see
// CreateBooking's own comment: it's a soft hold, not a formal ask, so
// nothing digital happened for the person to be told about), and that
// has to hold on the way out too, or this becomes the one path that
// quietly reveals a Pencil's existence, undermining the crew app/iCal
// feed's own Pencilled-staff-only guard. Captured before the UPDATE
// since RETURNING only ever gives the new (cancelled) status, never the
// old one.
func (a *API) CancelBooking(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var previousStatus models.BookingStatus
	err := a.DB.QueryRow(r.Context(), `SELECT status FROM bookings WHERE id = $1 AND organisation_id = $2`, id, currentOrgID).Scan(&previousStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to cancel booking")
		return
	}

	var b models.Booking
	err = a.DB.QueryRow(r.Context(),
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

	if err := a.invalidateBookingResponseTokens(r.Context(), b.ID); err != nil {
		log.Printf("cancel booking: invalidating response tokens: %v", err)
	}

	if previousStatus != models.BookingStatusPencilled {
		ctx, ctxErr := a.loadBookingContext(r.Context(), b.ID)
		if ctxErr == nil {
			subject, body := notify.RenderBookingCancelled(ctx.RoleName, ctx.JobName, ctx.DatesText)
			_ = a.notifyPerson(r.Context(), ctx.PersonID, models.NotificationTypeBookingCancelled,
				map[string]string{"role": ctx.RoleName, "job_name": ctx.JobName, "dates": ctx.DatesText}, subject, body)
		}
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
