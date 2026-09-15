package handlers

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"ralto/internal/models"
)

// BookingShift handles a single Booking having a different call time on
// different days. Per the data model: every date in a Booking's range
// should have exactly one BookingShift row if shifts are used at all — the
// frontend/planner is responsible for that all-or-nothing invariant; the
// API itself just stores whatever rows it's given.
//
// Testing feedback item L: booking_shifts had zero rows in production —
// nothing populated it when someone was pencilled/offered/confirmed, so
// there was no way to see which specific day(s) of a multi-day Job a
// person actually covers. syncBookingShifts below is now called from
// CreateBooking/UpdateBooking (bookings.go) every time a booking's dates
// are set, keeping one BookingShift row per covered day in sync with the
// booking — defaulting to every day in the booking's range unless the
// caller explicitly selects a subset (see resolveShiftDays).

// parseTimeOfDay accepts either a bare "HH:MM" (what a fresh default or a
// browser <input type="time"> sends) or "HH:MM:SS" (what Postgres' TIME
// type round-trips as) — booking_shifts.call_time/end_time are TIME NOT
// NULL columns, so this never has to handle a missing value.
func parseTimeOfDay(s string) (time.Time, error) {
	if t, err := time.Parse("15:04:05", s); err == nil {
		return t, nil
	}
	return time.Parse("15:04", s)
}

// defaultShiftTimes picks the call/end time a booking_shift row gets when
// nothing more specific is known. Neither Booking.call_time nor
// JobRequirement.call_time is required, but booking_shifts' own columns
// are NOT NULL (the iCal sidecar needs a concrete DTSTART/DTEND per
// shift — see migrations/0001's own comment on the table) — a generic
// 9-to-5 placeholder keeps booking_shifts usable purely for day-coverage
// tracking even before a real call time is entered, same as the rest of
// this app already shows "TBC"-style placeholders rather than blocking on
// incomplete data.
func defaultShiftTimes(callTime *string) (call string, end string) {
	call = "09:00"
	if callTime != nil && strings.TrimSpace(*callTime) != "" {
		call = strings.TrimSpace(*callTime)
	}
	end = call
	if t, err := parseTimeOfDay(call); err == nil {
		end = t.Add(8 * time.Hour).Format("15:04")
	}
	return call, end
}

// expandDateRange returns every date from start to end inclusive, in
// YYYY-MM-DD form.
func expandDateRange(start, end string) ([]string, error) {
	s, err := time.Parse("2006-01-02", start)
	if err != nil {
		return nil, fmt.Errorf("invalid start_date")
	}
	e, err := time.Parse("2006-01-02", end)
	if err != nil {
		return nil, fmt.Errorf("invalid end_date")
	}
	if e.Before(s) {
		return nil, fmt.Errorf("end_date is before start_date")
	}
	var days []string
	for d := s; !d.After(e); d = d.AddDate(0, 0, 1) {
		days = append(days, d.Format("2006-01-02"))
	}
	return days, nil
}

// resolveShiftDays turns an (optional) explicit day selection into the
// concrete list of dates a booking's shifts should cover. No selection —
// the common case — defaults to every day in the booking's own date
// range, matching the decision that a booking covers the whole Job span
// unless a scheduler deliberately narrows it. An explicit selection must
// fall entirely within that range.
func resolveShiftDays(startDate, endDate string, days []string) ([]string, error) {
	full, err := expandDateRange(startDate, endDate)
	if err != nil {
		return nil, err
	}
	if len(days) == 0 {
		return full, nil
	}
	valid := make(map[string]bool, len(full))
	for _, d := range full {
		valid[d] = true
	}
	seen := make(map[string]bool, len(days))
	out := make([]string, 0, len(days))
	for _, d := range days {
		if !valid[d] {
			return nil, fmt.Errorf("day %s is outside the booking's date range", d)
		}
		if !seen[d] {
			seen[d] = true
			out = append(out, d)
		}
	}
	return out, nil
}

// syncBookingShifts replaces a booking's whole set of booking_shifts rows
// with exactly `days`, each stamped with the same call/end time (derived
// from whatever call time the booking itself carries). Called after every
// booking create/update that sets dates — see bookings.go.
func (a *API) syncBookingShifts(ctx context.Context, bookingID string, days []string, callTime *string) error {
	call, end := defaultShiftTimes(callTime)
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM booking_shifts WHERE booking_id = $1 AND organisation_id = $2`, bookingID, currentOrgID); err != nil {
		return err
	}
	for _, day := range days {
		if _, err := tx.Exec(ctx,
			`INSERT INTO booking_shifts (booking_id, date, call_time, end_time, organisation_id) VALUES ($1, $2, $3, $4, $5)`,
			bookingID, day, call, end, currentOrgID,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (a *API) ListBookingShifts(w http.ResponseWriter, r *http.Request) {
	bookingID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, booking_id, date, call_time, end_time, notes FROM booking_shifts WHERE booking_id = $1 AND organisation_id = $2 ORDER BY date`, bookingID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list booking shifts")
		return
	}
	defer rows.Close()

	shifts := []models.BookingShift{}
	for rows.Next() {
		var s models.BookingShift
		if err := rows.Scan(&s.ID, &s.BookingID, &s.Date, &s.CallTime, &s.EndTime, &s.Notes); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list booking shifts")
			return
		}
		shifts = append(shifts, s)
	}
	writeJSON(w, http.StatusOK, shifts)
}

type bookingShiftWriteRequest struct {
	Date     string  `json:"date"`
	CallTime string  `json:"call_time"`
	EndTime  string  `json:"end_time"`
	Notes    *string `json:"notes"`
}

func (a *API) AddBookingShift(w http.ResponseWriter, r *http.Request) {
	bookingID := chi.URLParam(r, "id")
	var req bookingShiftWriteRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var s models.BookingShift
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO booking_shifts (booking_id, date, call_time, end_time, notes, organisation_id) VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, booking_id, date, call_time, end_time, notes`,
		bookingID, req.Date, req.CallTime, req.EndTime, req.Notes, currentOrgID,
	).Scan(&s.ID, &s.BookingID, &s.Date, &s.CallTime, &s.EndTime, &s.Notes)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to add booking shift")
		return
	}
	writeJSON(w, http.StatusCreated, s)
}

func (a *API) RemoveBookingShift(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "shiftId")
	tag, err := a.DB.Exec(r.Context(), `DELETE FROM booking_shifts WHERE id = $1 AND organisation_id = $2`, id, currentOrgID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to remove booking shift")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "booking shift not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
