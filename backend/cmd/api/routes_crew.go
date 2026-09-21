package main

import (
	"github.com/go-chi/chi/v5"

	"ralto/internal/handlers"
	"ralto/internal/middleware"
)

// registerCrewRoutes wires the crew-member-facing API — structurally
// disjoint from registerStaffRoutes (different middleware chain entirely,
// not just a different permission check), so a crew session token can
// never reach a staff-only route.
func registerCrewRoutes(r chi.Router, api *handlers.API) {
	r.Route("/api/crew", func(r chi.Router) {
		r.Use(middleware.RequireCrewAuth)
		r.Use(middleware.RequireCrewPasswordSet)

		r.Get("/me", api.CrewMe)
		r.Put("/me", api.UpdateMyProfile)
		r.Patch("/password", api.ChangeOwnCrewPassword)

		r.Get("/alerts", api.ListMyOpenAlerts)
		r.Get("/bookings", api.ListMyBookings)
		r.Get("/bookings/{id}", api.GetMyBooking)
		r.Get("/bookings/{id}/contact", api.GetMyBookingContact)
		r.Get("/bookings/{id}/crew", api.GetMyBookingCrew)
		r.Post("/offers/{id}/respond", api.RespondToOffer)
		r.Post("/bookings/{id}/acknowledge", api.AcknowledgeBooking)
		r.Post("/bookings/{id}/timesheet", api.SubmitTimesheet)

		r.Get("/availability-requests", api.ListMyAvailabilityRequests)
		r.Post("/availability-requests/{id}/respond", api.RespondToAvailabilityRequest)
		r.Get("/holiday-toil", api.ListMyHolidayToil)

		r.Get("/documents", api.ListMyDocuments)

		// Personal iCal feed — see ralto_schema_addendum_v1.md §2 and
		// internal/handlers/calendar_feed.go.
		r.Get("/calendar-feed", api.GetMyCalendarFeed)
		r.Post("/calendar-feed/regenerate", api.RegenerateMyCalendarFeed)
	})
}
