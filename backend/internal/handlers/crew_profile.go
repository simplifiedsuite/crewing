package handlers

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"ralto/internal/middleware"
	"ralto/internal/models"
)

// updateMyProfileRequest is deliberately its own narrow type rather than
// personWriteRequest — a crew member can edit their own contact details and
// notification preferences, not their rate, employment type, status, or
// preferred_status (those are scheduler-owned fields), and this struct
// simply has no field for them to be silently accepted-and-ignored through.
type updateMyProfileRequest struct {
	Email                string  `json:"email"`
	Phone                *string `json:"phone"`
	BaseLocation         *string `json:"base_location"`
	PhoneNumber          *string `json:"phone_number"`
	NotificationChannels *string `json:"notification_channels"`
	// VehicleRegistration — testing feedback item F: a crew member's own
	// personal vehicle, for site/parking access. Same self-edit tier as
	// phone/base_location (no password re-check, unlike Email).
	VehicleRegistration *string `json:"vehicle_registration"`
	// CurrentPassword is required only when Email differs from what's on
	// file — see below. Ignored otherwise.
	CurrentPassword string `json:"current_password"`
}

// UpdateMyProfile lets a crew member edit their own contact details.
// Email doubles as the crew login identifier, so changing it re-proves the
// current password first — reusing the exact bcrypt check
// ChangeOwnCrewPassword already does, rather than a second implementation
// of the same verification. The whole request is rejected (nothing saved,
// email included) if that check is required and fails; the other three
// fields save with no password check at all when email isn't changing.
func (a *API) UpdateMyProfile(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	var req updateMyProfileRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	newEmail := normalizeEmail(req.Email)

	// password_hash is guaranteed set here, the same reasoning
	// ChangeOwnCrewPassword's own comment gives: reaching any /api/crew/*
	// route at all requires a session, which only exists once a password
	// has been set.
	var currentEmail, passwordHash string
	if err := a.DB.QueryRow(r.Context(),
		`SELECT email, password_hash FROM people WHERE id = $1 AND organisation_id = $2`,
		claims.PersonID, currentOrgID,
	).Scan(&currentEmail, &passwordHash); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}

	if newEmail != normalizeEmail(currentEmail) {
		if bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.CurrentPassword)) != nil {
			writeError(w, http.StatusUnauthorized, "current password is incorrect")
			return
		}
	}

	var p models.Person
	err := scanPerson(a.DB.QueryRow(r.Context(),
		`UPDATE people SET email = $1, phone = $2, base_location = $3, phone_number = $4, notification_channels = $5, vehicle_registration = $6, updated_at = now()
		 WHERE id = $7 AND organisation_id = $8
		 RETURNING `+personSelectColumns,
		newEmail, req.Phone, req.BaseLocation, req.PhoneNumber, req.NotificationChannels, req.VehicleRegistration, claims.PersonID, currentOrgID,
	), &p)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to update profile")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (a *API) ListMyDocuments(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	rows, err := a.DB.Query(r.Context(),
		`SELECT id, person_id, type, file_ref, expiry_date, uploaded_at FROM person_documents WHERE person_id = $1 AND organisation_id = $2 ORDER BY uploaded_at DESC`,
		claims.PersonID, currentOrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list documents")
		return
	}
	defer rows.Close()

	docs := []models.PersonDocument{}
	for rows.Next() {
		var d models.PersonDocument
		if err := rows.Scan(&d.ID, &d.PersonID, &d.Type, &d.FileRef, &d.ExpiryDate, &d.UploadedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list documents")
			return
		}
		docs = append(docs, d)
	}
	writeJSON(w, http.StatusOK, docs)
}

// SubmitTimesheet creates the Timesheet row for a Complete-stage booking —
// the crew member reports actuals; ApproveTimesheet (staff-side) is what
// computes calculated_cost, not this handler.
type submitTimesheetRequest struct {
	ActualStart  string `json:"actual_start"`
	ActualEnd    string `json:"actual_end"`
	BreakMinutes int    `json:"break_minutes"`
}

func (a *API) SubmitTimesheet(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.CrewFromContext(r.Context())
	bookingID := chi.URLParam(r, "id")

	// Same Pencilled-staff-only ownership gate as GetMyBooking/
	// GetMyBookingContact — a freelancer shouldn't be able to act on a
	// booking they're not supposed to know exists just because they
	// already have its id.
	var owns bool
	if err := a.DB.QueryRow(r.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM bookings b
			WHERE b.id = $1 AND b.person_id = $2 AND b.organisation_id = $3
			      AND (b.status != 'pencilled' OR EXISTS (
			            SELECT 1 FROM people p WHERE p.id = $2 AND p.organisation_id = $3 AND p.employment_type = 'staff'
			          ))
		)`, bookingID, claims.PersonID, currentOrgID).Scan(&owns); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to submit timesheet")
		return
	}
	if !owns {
		writeError(w, http.StatusNotFound, "booking not found")
		return
	}

	var req submitTimesheetRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var t models.Timesheet
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO timesheets (booking_id, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes, status, submitted_at, organisation_id)
		 SELECT b.id, (b.start_date || ' ' || COALESCE(b.call_time, '00:00'))::timestamptz,
		        (b.end_date || ' ' || COALESCE(b.call_time, '00:00'))::timestamptz,
		        $2::timestamptz, $3::timestamptz, $4, 'submitted', now(), $5
		 FROM bookings b WHERE b.id = $1 AND b.organisation_id = $5
		 RETURNING id, booking_id, scheduled_start, scheduled_end, actual_start, actual_end, break_minutes,
		           status, submitted_at, approved_by, approved_at, calculated_cost`,
		bookingID, req.ActualStart, req.ActualEnd, req.BreakMinutes, currentOrgID,
	).Scan(&t.ID, &t.BookingID, &t.ScheduledStart, &t.ScheduledEnd, &t.ActualStart, &t.ActualEnd,
		&t.BreakMinutes, &t.Status, &t.SubmittedAt, &t.ApprovedBy, &t.ApprovedAt, &t.CalculatedCost)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to submit timesheet")
		return
	}
	writeJSON(w, http.StatusCreated, t)
}
