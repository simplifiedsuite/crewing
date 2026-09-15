package main

import (
	"github.com/go-chi/chi/v5"

	"ralto/internal/handlers"
	"ralto/internal/middleware"
)

// registerStaffRoutes wires the scheduler/admin-facing API — everything
// under /api/* except /api/crew/*. RequireStaffAuth + RequireStaffPasswordSet
// on the whole tree, RequireAdmin layered on top for the few routes more
// sensitive than day-to-day crewing (mirrors Equiptra's /users gating).
func registerStaffRoutes(r chi.Router, api *handlers.API) {
	r.Route("/api", func(r chi.Router) {
		r.Use(middleware.RequireStaffAuth)
		r.Use(middleware.RequireStaffPasswordSet)

		r.Get("/me", api.Me)
		r.Patch("/users/me/password", api.ChangeOwnPassword)
		r.Get("/resource-calendar", api.GetResourceCalendar)

		r.Route("/clients", func(r chi.Router) {
			r.Get("/", api.ListClients)
			r.Post("/", api.CreateClient)
			r.Get("/{id}", api.GetClient)
			r.Put("/{id}", api.UpdateClient)
			r.Delete("/{id}", api.DeleteClient)
			r.Post("/link-core", api.LinkCoreClient)
		})

		// Job "Fetch from Monday" (Stage A) — all proxy straight to
		// Simplified Suite Core, which owns the Monday.com credential and
		// the real Client/Contract records. See internal/handlers/core_proxy.go.
		r.Get("/monday/project-lookup", api.MondayProjectLookup)
		r.Get("/core-clients", api.ListCoreClients)
		r.Post("/core-clients", api.CreateCoreClient)
		r.Get("/core-contracts", api.ListCoreContracts)
		r.Get("/core-locations", api.ListCoreLocations)
		r.Post("/core-locations", api.CreateCoreLocation)

		// Shared Core Job entity — one Monday fetch, visible from every
		// product. See Core's own migrations/0008_jobs.sql.
		r.Get("/core-jobs", api.GetCoreJobByOrderNumber)
		r.Post("/core-jobs", api.CreateCoreJob)
		r.Post("/core-jobs/{id}/refresh", api.RefreshCoreJob)

		r.Route("/venues", func(r chi.Router) {
			r.Get("/", api.ListVenues)
			r.Post("/", api.CreateVenue)
			r.Get("/{id}", api.GetVenue)
			r.Put("/{id}", api.UpdateVenue)
			r.Delete("/{id}", api.DeleteVenue)
			r.Post("/link-core", api.LinkCoreVenue)
		})

		r.Route("/roles", func(r chi.Router) {
			r.Get("/", api.ListRoles)
			r.Post("/", api.CreateRole)
			r.Put("/{id}", api.UpdateRole)
			r.Delete("/{id}", api.DeleteRole)
		})

		r.Route("/projects", func(r chi.Router) {
			r.Get("/", api.ListProjects)
			r.Post("/", api.CreateProject)
			r.Get("/{id}", api.GetProject)
			r.Put("/{id}", api.UpdateProject)
			r.Delete("/{id}", api.DeleteProject)
		})

		r.Route("/prospective-events", func(r chi.Router) {
			r.Get("/", api.ListProspectiveEvents)
			r.Post("/", api.CreateProspectiveEvent)
			r.Get("/{id}", api.GetProspectiveEvent)
			r.Put("/{id}", api.UpdateProspectiveEvent)
			r.Delete("/{id}", api.DeleteProspectiveEvent)
			r.Post("/{id}/convert", api.ConvertProspectiveEvent)
			r.Post("/{id}/drop", api.DropProspectiveEvent)
		})

		r.Route("/jobs", func(r chi.Router) {
			r.Get("/", api.ListJobs)
			r.Post("/", api.CreateJob)
			r.Get("/{id}", api.GetJob)
			r.Put("/{id}", api.UpdateJob)
			r.Delete("/{id}", api.DeleteJob)
			r.Post("/{id}/status", api.UpdateJobStatus)
			r.Get("/{id}/contacts", api.ListJobContacts)
			r.Post("/{id}/contacts", api.CreateJobContact)
			r.Get("/{id}/requirements", api.ListJobRequirementsWithCounts)
			r.Post("/{id}/requirements", api.CreateJobRequirement)
			r.Get("/{id}/vehicles", api.ListJobVehicles)
			r.Post("/{id}/vehicles", api.AssignVehicleToJob)
			r.Delete("/{id}/vehicles/{vehicleId}", api.UnassignVehicleFromJob)
		})

		// Fleet vehicles (Settings) — separate from a crew member's own
		// personal vehicle_registration on Person. See internal/handlers/vehicles.go.
		r.Route("/vehicles", func(r chi.Router) {
			r.Get("/", api.ListVehicles)
			r.Post("/", api.CreateVehicle)
			r.Put("/{id}", api.UpdateVehicle)
			r.Delete("/{id}", api.DeleteVehicle)
		})

		r.Route("/job-requirements", func(r chi.Router) {
			r.Put("/{reqId}", api.UpdateJobRequirement)
			r.Delete("/{reqId}", api.DeleteJobRequirement)
			r.Get("/{reqId}/candidates", api.ListCandidatesForJobRequirement)
			r.Get("/{reqId}/bookings", api.ListBookingsForRequirement)
			r.Post("/{reqId}/bookings", api.CreateBooking)
		})

		r.Route("/people", func(r chi.Router) {
			r.Get("/", api.ListPeople)
			r.Post("/", api.CreatePerson)
			r.Get("/{id}", api.GetPerson)
			r.Put("/{id}", api.UpdatePerson)
			r.Delete("/{id}", api.DeletePerson)
			r.Get("/{id}/roles", api.ListPersonRoles)
			r.Post("/{id}/roles", api.AddPersonRole)
			r.Delete("/{id}/roles/{personRoleId}", api.RemovePersonRole)
			r.Get("/{id}/skills", api.ListPersonSkills)
			r.Post("/{id}/skills", api.AddPersonSkill)
			r.Delete("/{id}/skills/{personSkillId}", api.RemovePersonSkill)
			r.Get("/{id}/documents", api.ListPersonDocuments)
			r.Post("/{id}/documents", api.AddPersonDocument)
			r.Delete("/{id}/documents/{documentId}", api.RemovePersonDocument)
			r.Get("/{id}/availability", api.ListAvailabilityForPerson)
			r.Post("/{id}/availability", api.CreateAvailability)
			r.Delete("/{id}/availability/{availabilityId}", api.DeleteAvailability)
			r.Post("/{id}/calendar-feed-token", api.GenerateCalendarFeedToken)
			r.Post("/{id}/invite-to-crew-app", api.InviteToCrewApp)
			r.Get("/{id}/scheduleit-history", api.ListScheduleItHistoryForPerson)
			r.Get("/{id}/completed-jobs", api.ListCompletedJobsForPerson)
		})

		r.Route("/skills", func(r chi.Router) {
			r.Get("/", api.ListSkills)
			r.Post("/", api.CreateSkill)
			r.Put("/{id}", api.UpdateSkill)
			r.Delete("/{id}", api.DeleteSkill)
		})

		r.Route("/overtime-rules", func(r chi.Router) {
			r.Get("/", api.ListOvertimeRules)
			r.Post("/", api.CreateOvertimeRule)
			r.Put("/{id}", api.UpdateOvertimeRule)
			r.Delete("/{id}", api.DeleteOvertimeRule)
		})

		// Org-wide Dakboard feed (Settings) — separate from crew's own
		// per-person feed under /api/crew/calendar-feed. See
		// internal/handlers/calendar_feed.go.
		r.Get("/dakboard-feed", api.GetDakboardFeed)
		r.Post("/dakboard-feed/regenerate", api.RegenerateDakboardFeed)

		r.Route("/bookings", func(r chi.Router) {
			r.Put("/{id}", api.UpdateBooking)
			r.Delete("/{id}", api.DeleteBooking)
			r.Post("/{id}/offer", api.PromoteBookingToOffer)
			r.Post("/{id}/confirm", api.ConfirmBooking)
			r.Post("/{id}/cancel", api.CancelBooking)
			r.Get("/{id}/shifts", api.ListBookingShifts)
			r.Post("/{id}/shifts", api.AddBookingShift)
			r.Delete("/{id}/shifts/{shiftId}", api.RemoveBookingShift)
		})

		r.Route("/timesheets", func(r chi.Router) {
			r.Get("/", api.ListTimesheets)
			r.Get("/{id}", api.GetTimesheet)
			r.Post("/{id}/approve", api.ApproveTimesheet)
			r.Post("/{id}/reject", api.RejectTimesheet)
		})

		r.Route("/availability-requests", func(r chi.Router) {
			r.Get("/", api.ListAvailabilityRequests)
			r.Post("/", api.CreateAvailabilityRequest)
		})

		r.Route("/alerts", func(r chi.Router) {
			r.Get("/", api.ListAlerts)
			r.Post("/{id}/resolve", api.ResolveAlert)
		})

		// Account/login management — admin-only, same access tier Equiptra
		// gives its own /users resource.
		r.Route("/users", func(r chi.Router) {
			r.Use(middleware.RequireAdmin)
			r.Get("/", api.ListUsers)
			r.Post("/", api.CreateUser)
			r.Patch("/{id}", api.UpdateUser)
			r.Patch("/{id}/password", api.AdminResetPassword)
			r.Delete("/{id}", api.DeleteUser)
		})
	})
}
