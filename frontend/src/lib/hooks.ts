import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type {
  Availability,
  AvailabilityStatus,
  AvailabilityType,
  AvailabilityDayPortion,
  Booking,
  CandidateGroups,
  Client,
  CoreClient,
  CoreContract,
  CoreJob,
  CoreLocation,
  CoreVehicle,
  EmploymentType,
  Job,
  JobCommitment,
  JobDayLabel,
  JobRequirementWithCounts,
  JobVehicle,
  JobStatus,
  OperationalAlert,
  OvertimeRule,
  Person,
  PersonRole,
  PersonStatus,
  PreferredStatus,
  Project,
  ProspectiveEvent,
  ResourceCalendarResponse,
  ResourceCalendarRow,
  Role,
  ScheduleItHistory,
  Skill,
  SkillType,
  Venue,
} from '../types'

// Shared read/write hooks for the scheduler apps (desktop + mobile) — one
// place to fetch each resource so both prototype shells stay in sync
// rather than duplicating fetch logic per screen.

function useCollection<T>(path: string) {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    return api
      .get<T[]>(path)
      .then(setData)
      .finally(() => setLoading(false))
  }, [path])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

export function useJobs() {
  return useCollection<Job>('/jobs')
}

export function useClients() {
  return useCollection<Client>('/clients')
}

export function useVenues() {
  return useCollection<Venue>('/venues')
}

// createVenue — testing feedback item C: the backend has had a full
// venues CRUD API since it was first built, but nothing on the frontend
// ever called the write endpoints; a scheduler needing a new venue had to
// go into Core's own admin instead. This is the local-only equivalent of
// Client's inline-create (no Core-Location-linking scaffolding exists for
// venues yet — that would be a separate, bigger piece of work if ever
// wanted, matching Client/Core's own mirror pattern).
export function createVenue(input: { name: string; address?: string; city?: string; country?: string; timezone: string; notes?: string }) {
  return api.post<Venue>('/venues', input)
}

export function usePeople() {
  return useCollection<Person>('/people')
}

export function useAlerts() {
  return useCollection<OperationalAlert>('/alerts')
}

export function useRoles() {
  return useCollection<Role>('/roles')
}

export function createRole(input: { name: string; category?: string }) {
  return api.post<Role>('/roles', input)
}

export function updateRole(id: string, input: { name: string; category?: string }) {
  return api.put<Role>(`/roles/${id}`, input)
}

export function deleteRole(id: string) {
  return api.delete<{ ok: boolean }>(`/roles/${id}`)
}

// listCoreVehicles backs the Job "Assign a vehicle" picker — live per
// §5a's picker rule, same pattern as listCoreClients/listCoreLocations.
// Ralto no longer owns a local vehicles table (Stage 3 of the shared
// Vehicle addendum) — Core is the only source for "which vehicles exist".
export function listCoreVehicles() {
  return api.get<CoreVehicle[]>('/core-vehicles')
}

export function listJobVehicles(jobId: string) {
  return api.get<JobVehicle[]>(`/jobs/${jobId}/vehicles`)
}

export function assignVehicleToJob(jobId: string, vehicle: CoreVehicle) {
  return api.post(`/jobs/${jobId}/vehicles`, { core_vehicle_id: vehicle.id, name: vehicle.name, registration: vehicle.registration })
}

export function unassignVehicleFromJob(jobId: string, coreVehicleId: string) {
  return api.delete(`/jobs/${jobId}/vehicles/${coreVehicleId}`)
}

// useJobDayLabels — testing feedback R: what each day within a Job means
// (e.g. "Rig", "Match day"), keyed by date so callers can look one up with
// a plain object index rather than scanning the array each time.
export function useJobDayLabels(jobId: string | undefined) {
  const [byDate, setByDate] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!jobId) {
      setByDate({})
      setLoading(false)
      return
    }
    setLoading(true)
    api
      .get<JobDayLabel[]>(`/jobs/${jobId}/day-labels`)
      .then((labels) => setByDate(Object.fromEntries(labels.map((l) => [l.date, l.label]))))
      .finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  return { byDate, loading, reload }
}

// setJobDayLabel — an empty label clears it (see SetJobDayLabel
// server-side): same call either way, no separate delete endpoint to call.
export function setJobDayLabel(jobId: string, date: string, label: string) {
  return api.put<JobDayLabel>(`/jobs/${jobId}/day-labels/${date}`, { label })
}

export function useOvertimeRules() {
  return useCollection<OvertimeRule>('/overtime-rules')
}

export function createOvertimeRule(input: { name: string; threshold_hours: number; multiplier: number }) {
  return api.post<OvertimeRule>('/overtime-rules', input)
}

export function updateOvertimeRule(id: string, input: { name: string; threshold_hours: number; multiplier: number }) {
  return api.put<OvertimeRule>(`/overtime-rules/${id}`, input)
}

export function deleteOvertimeRule(id: string) {
  return api.delete<{ ok: boolean }>(`/overtime-rules/${id}`)
}

export function useSkills() {
  return useCollection<Skill>('/skills')
}

export function createSkill(input: { name: string; type: SkillType; expiry_tracked: boolean }) {
  return api.post<Skill>('/skills', input)
}

export function updateSkill(id: string, input: { name: string; type: SkillType; expiry_tracked: boolean }) {
  return api.put<Skill>(`/skills/${id}`, input)
}

export function deleteSkill(id: string) {
  return api.delete<{ ok: boolean }>(`/skills/${id}`)
}

export function useProjects() {
  return useCollection<Project>('/projects')
}

export interface CreateJobInput {
  name: string
  client_id: string
  project_id?: string
  venue_id?: string
  project_reference?: string
  shared_contract_id?: string
  shared_contract_name?: string
  shared_job_id?: string
  start_date: string
  end_date: string
  status: JobStatus
  commitment: JobCommitment
  notes?: string
}

export function createJob(input: CreateJobInput) {
  return api.post<Job>('/jobs', input)
}

export function updateJob(id: string, input: CreateJobInput) {
  return api.put<Job>(`/jobs/${id}`, input)
}

// updateJobStatus — testing feedback item E's Cancel/Complete actions. A
// dedicated single-field endpoint (see UpdateJobStatus in
// backend/internal/handlers/jobs.go), not a partial call into
// createJob/updateJob's full-record shape.
export function updateJobStatus(id: string, status: JobStatus) {
  return api.post<Job>(`/jobs/${id}/status`, { status })
}

// deleteJob/restoreJob — testing feedback "Delete cancelled jobs into an
// archive". Soft delete only: the backend rejects deleteJob unless the
// job is already Cancelled (see SoftDeleteJob), so this deliberately
// doesn't take a confirmation param — the calling UI owns that step, same
// as updateJobStatus's cancel/complete actions.
export function deleteJob(id: string) {
  return api.post<Job>(`/jobs/${id}/delete`)
}

export function restoreJob(id: string) {
  return api.post<Job>(`/jobs/${id}/restore`)
}

// A completed Job worked by a specific person — the Archive view's crew
// filter and PersonDetail's "Completed jobs" tab both read this, mirroring
// ScheduleItHistory's own shape (see backend's completedJobSummary).
export interface CompletedJobSummary {
  id: string
  name: string
  client_name: string
  start_date: string
  end_date: string
}

export function useCompletedJobsForPerson(personId: string | undefined) {
  const [data, setData] = useState<CompletedJobSummary[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!personId) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    api
      .get<CompletedJobSummary[]>(`/people/${personId}/completed-jobs`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [personId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

// --- Job "Fetch from Monday", Stage A — everything here proxies through
// Ralto's own backend to Simplified Suite Core, which owns the Monday.com
// credential and the real Client/Contract records. See
// internal/handlers/core_proxy.go and docs/simplified_suite_core_v0_6.md.

export interface MondayProjectLookup {
  name: string
  client?: string
  start_date?: string
  end_date?: string
  client_reference?: string
  delivery_address?: string
}

export function fetchMondayProjectLookup(orderNumber: string) {
  return api.get<MondayProjectLookup>(`/monday/project-lookup?order_number=${encodeURIComponent(orderNumber)}`)
}

export function listCoreClients() {
  return api.get<CoreClient[]>('/core-clients')
}

export function createCoreClient(input: { name: string; website?: string | null; brand_color_hex?: string | null }) {
  return api.post<CoreClient>('/core-clients', input)
}

// Finds or creates the local Ralto client mirror for a confirmed Core
// Client — idempotent, see LinkCoreClient's own comment server-side.
export function linkCoreClient(input: { core_client_id: string; name: string; brand_color_hex?: string | null; website?: string | null }) {
  return api.post<Client>('/clients/link-core', input)
}

export function listCoreContracts(clientId: string) {
  return api.get<CoreContract[]>(`/core-contracts?client_id=${encodeURIComponent(clientId)}`)
}

// Testing feedback item J: venue/location sync was never actually built —
// the local `venues` table was stale seed data disconnected from Core.
// This trio mirrors the Core Client one above exactly, bringing venue
// picking up to the same "pickers always go live" standard.
export function listCoreLocations() {
  return api.get<CoreLocation[]>('/core-locations')
}

export function createCoreLocation(input: { name: string; address?: string | null; timezone?: string | null }) {
  return api.post<CoreLocation>('/core-locations', input)
}

// Finds or creates the local Ralto venue mirror for a confirmed Core
// Location — idempotent, see LinkCoreVenue's own comment server-side.
export function linkCoreVenue(input: { core_location_id: string; name: string; address?: string | null; timezone?: string | null }) {
  return api.post<Venue>('/venues/link-core', input)
}

// --- Shared Core Job entity — one Monday fetch, visible from every
// product. See Core's own migrations/0008_jobs.sql.

export function getCoreJobByOrderNumber(orderNumber: string) {
  return api.get<CoreJob>(`/core-jobs?order_number=${encodeURIComponent(orderNumber)}`)
}

export function createCoreJob(input: {
  order_number: string
  name: string
  client_id: string
  contract_id?: string
  date_start?: string
  date_end?: string
  client_reference?: string
  delivery_address?: string
}) {
  return api.post<CoreJob>('/core-jobs', input)
}

// The explicit "re-check Monday" action — the everyday fetch path never
// calls Monday at all once Core already has this order number; only this
// does. Refreshes name/dates/client_reference/delivery_address only —
// client_id/contract_id are left untouched server-side (see
// RefreshJobFromMonday's own comment).
export function refreshCoreJob(id: string) {
  return api.post<CoreJob>(`/core-jobs/${id}/refresh`)
}

export function createJobRequirement(
  jobId: string,
  input: { role_id: string; quantity_required: number; start_date: string; end_date: string; call_time?: string; notes?: string },
) {
  return api.post(`/jobs/${jobId}/requirements`, input)
}

export function updateJobRequirement(
  reqId: string,
  input: { role_id: string; quantity_required: number; start_date: string; end_date: string; call_time?: string; notes?: string },
) {
  return api.put(`/job-requirements/${reqId}`, input)
}

// deleteJobRequirement cascades every booking against it (backend FK is
// ON DELETE CASCADE, not a blocking guard) — the caller is responsible
// for warning about that before calling this, same as the confirm step
// already used for Cancel job/Mark complete.
export function deleteJobRequirement(reqId: string) {
  return api.delete<{ ok: boolean }>(`/job-requirements/${reqId}`)
}

export function createJobContact(jobId: string, input: { name: string; role_title?: string; email?: string; phone?: string }) {
  return api.post(`/jobs/${jobId}/contacts`, input)
}

export function convertProspectiveEvent(eventId: string, jobId: string) {
  return api.post(`/prospective-events/${eventId}/convert`, { job_id: jobId })
}

export function useProspectiveEvents() {
  return useCollection<ProspectiveEvent>('/prospective-events')
}

export function createProspectiveEvent(input: { name: string; date_start: string; date_end: string; client_id?: string; notes?: string }) {
  return api.post('/prospective-events', input)
}

// updateProspectiveEvent — testing feedback V: the backend has supported a
// full update since ProspectiveEvent was first built (UpdateProspectiveEvent
// in prospective_events.go, PUT /prospective-events/{id}), but nothing on
// the frontend ever called it — editing dates meant delete-and-recreate.
export function updateProspectiveEvent(id: string, input: { name: string; date_start: string; date_end: string; client_id?: string; notes?: string }) {
  return api.put<ProspectiveEvent>(`/prospective-events/${id}`, input)
}

export function dropProspectiveEvent(id: string) {
  return api.post(`/prospective-events/${id}/drop`)
}

function shiftISODate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fetchResourceCalendarRange(start: string, end: string, includeKey: string) {
  const params = new URLSearchParams({ start, end })
  if (includeKey) params.set('include', includeKey)
  return api.get<ResourceCalendarResponse>(`/resource-calendar?${params.toString()}`)
}

// useResourceCalendarWindow — the "people down, dates across" read model
// (addendum v2 §1), rebuilt for the Team view's continuous-scroll redesign
// (DD). Replaces the old useResourceCalendar's single fixed start/end
// fetch: the Team view now grows its visible date range as the scheduler
// scrolls, and this hook grows the *loaded* range to match without ever
// re-fetching a date already in hand — expandStart/expandEnd each request
// only the newly-exposed slice and merge it (by booking/availability id)
// into what's already loaded. That's what keeps "scrolling shouldn't load
// an unreasonable chunk at once" true regardless of how far someone
// scrolls in one sitting, rather than just picking a bigger fixed window
// and calling it done.
export function useResourceCalendarWindow(initialStart: string, initialEnd: string, includeIds: string[]) {
  const [rangeStart, setRangeStart] = useState(initialStart)
  const [rangeEnd, setRangeEnd] = useState(initialEnd)
  const [rowsByPerson, setRowsByPerson] = useState<Map<string, ResourceCalendarRow>>(new Map())
  const [events, setEvents] = useState<ProspectiveEvent[]>([])
  const [loading, setLoading] = useState(true)
  const includeKey = includeIds.join(',')
  // Guards a stale in-flight fetch (e.g. a slow expandStart response)
  // landing after a newer reset (includeIds changed) has already replaced
  // the whole window — bumped on every reset, checked before merging.
  const generationRef = useRef(0)

  function mergeResponse(resp: ResourceCalendarResponse) {
    setRowsByPerson((prev) => {
      const next = new Map(prev)
      for (const row of resp.rows) {
        const existing = next.get(row.person_id)
        if (!existing) {
          next.set(row.person_id, row)
          continue
        }
        const bookingIds = new Set(existing.bookings.map((b) => b.id))
        const availabilityIds = new Set(existing.availability.map((a) => a.id))
        next.set(row.person_id, {
          ...existing,
          bookings: [...existing.bookings, ...row.bookings.filter((b) => !bookingIds.has(b.id))],
          availability: [...existing.availability, ...row.availability.filter((a) => !availabilityIds.has(a.id))],
        })
      }
      return next
    })
    setEvents((prev) => {
      const ids = new Set(prev.map((e) => e.id))
      return [...prev, ...resp.prospective_events.filter((e) => !ids.has(e.id))]
    })
  }

  // Full reset — mount, or includeIds changed (a newly-added freelancer's
  // existing bookings outside the currently-loaded window need a real
  // fetch, not a merge, since nothing about them is cached yet).
  const resetTo = useCallback((start: string, end: string) => {
    const generation = ++generationRef.current
    setLoading(true)
    setRangeStart(start)
    setRangeEnd(end)
    return fetchResourceCalendarRange(start, end, includeKey)
      .then((resp) => {
        if (generation !== generationRef.current) return
        setRowsByPerson(new Map(resp.rows.map((r) => [r.person_id, r])))
        setEvents(resp.prospective_events)
      })
      .finally(() => {
        if (generation === generationRef.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeKey])

  useEffect(() => {
    resetTo(initialStart, initialEnd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeKey])

  // expandStart/expandEnd — the scroll-edge handlers call these with the
  // new, wider boundary; only the newly-exposed slice (old boundary to new
  // boundary) is actually requested.
  const expandStart = useCallback(
    (newStart: string) => {
      if (newStart >= rangeStart) return
      const sliceEnd = shiftISODate(rangeStart, -1)
      const generation = generationRef.current
      setRangeStart(newStart)
      fetchResourceCalendarRange(newStart, sliceEnd, includeKey).then((resp) => {
        if (generation === generationRef.current) mergeResponse(resp)
      })
    },
    [rangeStart, includeKey],
  )
  const expandEnd = useCallback(
    (newEnd: string) => {
      if (newEnd <= rangeEnd) return
      const sliceStart = shiftISODate(rangeEnd, 1)
      const generation = generationRef.current
      setRangeEnd(newEnd)
      fetchResourceCalendarRange(sliceStart, newEnd, includeKey).then((resp) => {
        if (generation === generationRef.current) mergeResponse(resp)
      })
    },
    [rangeEnd, includeKey],
  )

  // Testing feedback item D's polling refresh — refetches the current
  // loaded window in full (correctness over the marginal savings of a
  // merge, for a background 45s poll) rather than growing it.
  const reload = useCallback(() => {
    const generation = generationRef.current
    fetchResourceCalendarRange(rangeStart, rangeEnd, includeKey).then((resp) => {
      if (generation !== generationRef.current) return
      setRowsByPerson(new Map(resp.rows.map((r) => [r.person_id, r])))
      setEvents(resp.prospective_events)
    })
  }, [rangeStart, rangeEnd, includeKey])

  const rows = useMemo(() => [...rowsByPerson.values()], [rowsByPerson])

  return { rows, events, loading, rangeStart, rangeEnd, expandStart, expandEnd, reload }
}

export function useJobRequirements(jobId: string | undefined) {
  const [data, setData] = useState<JobRequirementWithCounts[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!jobId) return Promise.resolve()
    setLoading(true)
    return api
      .get<JobRequirementWithCounts[]>(`/jobs/${jobId}/requirements`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

export function useCandidates(requirementId: string | undefined) {
  const [data, setData] = useState<CandidateGroups>({
    suitable: [],
    possible: [],
    unavailable: [],
    conflicted: [],
    already_asked: { awaiting_response: [], declined: [] },
  })
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!requirementId) return Promise.resolve()
    setLoading(true)
    return api
      .get<CandidateGroups>(`/job-requirements/${requirementId}/candidates`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [requirementId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

export function useBookingsForRequirement(requirementId: string | undefined) {
  const [data, setData] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!requirementId) return Promise.resolve()
    setLoading(true)
    return api
      .get<Booking[]>(`/job-requirements/${requirementId}/bookings`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [requirementId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

// listBookingsForRequirement — a plain (non-hook) fetch for callers that
// need bookings for several requirements at once (Jobs' per-role names, and
// job-level "Confirm everyone"), where calling a hook in a loop isn't an
// option.
export function listBookingsForRequirement(requirementId: string) {
  return api.get<Booking[]>(`/job-requirements/${requirementId}/bookings`)
}

export function cancelBooking(id: string) {
  return api.post<Booking>(`/bookings/${id}/cancel`)
}

// updateBookingDays — testing feedback item L's "edit which specific days
// this booking covers" action. UpdateBooking's request shape requires the
// booking's own current start_date/end_date/etc alongside the new `days`
// (the backend replaces the whole row, not a partial patch), so callers
// pass the booking they already have on hand rather than re-fetching it.
export function updateBookingDays(booking: Booking, days: string[]) {
  return api.put<Booking>(`/bookings/${booking.id}`, {
    start_date: booking.start_date,
    end_date: booking.end_date,
    call_time: booking.call_time ?? null,
    rate_override: booking.rate_override ?? null,
    notes: booking.notes ?? null,
    days,
  })
}

// updateBookingDateRange — a scheduler amending which dates a Booking
// itself actually covers (extending by a rig day, shortening it, or
// narrowing it to less than the full JobRequirement span in the first
// place — e.g. someone only needed for one day of a two-day role). This
// was previously impossible through the UI even though UpdateBooking
// already supported it server-side; also the fix for false conflicts
// caused by a Booking inheriting the requirement's full date range with
// no way to override it (see resolveShiftDays server-side — day coverage
// isn't passed here, so it defaults to the new range in full, same as a
// freshly pencilled booking).
export function updateBookingDateRange(booking: Booking, startDate: string, endDate: string) {
  return api.put<Booking>(`/bookings/${booking.id}`, {
    start_date: startDate,
    end_date: endDate,
    call_time: booking.call_time ?? null,
    rate_override: booking.rate_override ?? null,
    notes: booking.notes ?? null,
  })
}

export function confirmBooking(id: string) {
  return api.post<Booking>(`/bookings/${id}/confirm`)
}

// recordBookingResponse — Addendum v3 §3: a scheduler recording a
// freelancer's phone/WhatsApp/in-person response to an outstanding offer,
// as a first-class alternative to the self-service token/app flow, not a
// fallback for it. Only valid from Offered — see RecordBookingResponse's
// own comment server-side.
export function recordBookingResponse(id: string, response: 'pencil' | 'decline') {
  return api.post<Booking>(`/bookings/${id}/respond`, { response })
}

// usePerson — a single Person by id, for a call site that only has a
// personId in scope (e.g. Planner's declined-follow-up) and needs a field
// like employment_type that isn't worth threading through as a prop from
// every caller. Skips the fetch entirely when personId is undefined, same
// as useAvailability.
export function usePerson(personId: string | undefined) {
  const [data, setData] = useState<Person | undefined>(undefined)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!personId) return Promise.resolve()
    setLoading(true)
    return api
      .get<Person>(`/people/${personId}`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [personId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

export function useAvailability(personId: string | undefined) {
  const [data, setData] = useState<Availability[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!personId) return Promise.resolve()
    setLoading(true)
    return api
      .get<Availability[]>(`/people/${personId}/availability`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [personId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

// Read-only — scheduleit_history is only ever written by the one-shot
// import script, never through the API, so there's no create/delete
// wrapper to go with this the way Availability has.
export function useScheduleItHistory(personId: string | undefined) {
  const [data, setData] = useState<ScheduleItHistory[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!personId) return Promise.resolve()
    setLoading(true)
    return api
      .get<ScheduleItHistory[]>(`/people/${personId}/scheduleit-history`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [personId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

export function createAvailability(
  personId: string,
  input: { start_date: string; end_date: string; status: AvailabilityStatus; type?: AvailabilityType; day_portion?: AvailabilityDayPortion; notes?: string },
) {
  return api.post(`/people/${personId}/availability`, input)
}

export function deleteAvailability(personId: string, availabilityId: string) {
  return api.delete(`/people/${personId}/availability/${availabilityId}`)
}

export function resolveAlert(id: string) {
  return api.post(`/alerts/${id}/resolve`)
}

// PersonWriteInput matches personWriteRequest in backend/internal/handlers/people.go
// field for field — CreatePerson and UpdatePerson both take this exact shape,
// and UpdatePerson overwrites every one of these columns (no partial-patch
// semantics), so an edit must round-trip fields it doesn't expose in its own
// form (overtime_rule_id, phone_number, notification_channels) rather than
// omitting them and silently wiping them.
export interface PersonWriteInput {
  first_name: string
  last_name: string
  // email — testing feedback Y: not required on its own; the backend
  // rejects only when both email and phone are absent.
  email?: string
  phone?: string
  base_location?: string
  employment_type: EmploymentType
  status?: PersonStatus
  preferred_status?: PreferredStatus
  standard_rate?: number
  rate_currency?: string
  overtime_rule_id?: string
  notes?: string
  phone_number?: string
  notification_channels?: string
  vehicle_registration?: string
  company_name?: string
}

export function createPerson(input: PersonWriteInput) {
  return api.post<Person>('/people', input)
}

export function updatePerson(id: string, input: PersonWriteInput) {
  return api.put<Person>(`/people/${id}`, input)
}

export function deletePerson(id: string) {
  return api.delete<{ ok: boolean }>(`/people/${id}`)
}

export function usePersonRoles(personId: string | undefined) {
  const [data, setData] = useState<PersonRole[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    if (!personId) return Promise.resolve()
    setLoading(true)
    return api
      .get<PersonRole[]>(`/people/${personId}/roles`)
      .then(setData)
      .finally(() => setLoading(false))
  }, [personId])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
}

export function addPersonRole(personId: string, input: { role_id: string; is_primary: boolean }) {
  return api.post<PersonRole>(`/people/${personId}/roles`, input)
}

export function removePersonRole(personId: string, personRoleId: string) {
  return api.delete<{ ok: boolean }>(`/people/${personId}/roles/${personRoleId}`)
}

// invitePerson enables crew-app login for an existing Person — the returned
// temporary_password is one-shot, exactly like cmd/seed's password prompt:
// it comes back in this response body only and can't be retrieved again
// afterward, so callers must show it once and never log or persist it.
export function invitePerson(personId: string) {
  return api.post<{ temporary_password: string }>(`/people/${personId}/invite-to-crew-app`)
}

// offerBooking creates a booking against a requirement — 'declined' covers
// the phone-call "Not available" action in Planner (a no recorded straight
// from the call, no digital offer ever sent), alongside the original
// 'offered'/'pencilled' starting states.
// days — the specific dates (within [startDate, endDate]) this booking
// actually covers, per person, at creation time. Omitted defaults to every
// day in the range server-side (see resolveShiftDays), which is exactly
// today's existing behaviour — callers that don't pass it get no change.
// When passed, startDate/endDate should already be the min/max of days
// (CreateBooking stores them as given; only `days` drives booking_shifts).
export function offerBooking(
  requirementId: string,
  personId: string,
  startDate: string,
  endDate: string,
  callTime?: string,
  status: 'offered' | 'pencilled' | 'declined' = 'offered',
  days?: string[],
) {
  return api.post<Booking>(`/job-requirements/${requirementId}/bookings`, {
    person_id: personId,
    start_date: startDate,
    end_date: endDate,
    call_time: callTime,
    status,
    days,
  })
}

// clientById/venueById — small helpers for the many places the prototypes
// display a job's client name/colour or venue name given only the id FK.
export function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const item of items) out[item.id] = item
  return out
}

export interface JobSummary {
  job: Job
  requirements: JobRequirementWithCounts[]
  required: number
  confirmed: number
  pencilled: number
  offered: number
}

// useJobSummaries fetches every job's requirements alongside the job list —
// an N+1 pattern that's fine at Phase 1's scale (manual data entry, a
// handful of live jobs) and avoids adding a bespoke aggregate endpoint for
// what the Jobs/Today/Calendar screens all need: crewing totals per job.
export function useJobSummaries() {
  const [summaries, setSummaries] = useState<JobSummary[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    const freshJobs = await api.get<Job[]>('/jobs')
    const withRequirements = await Promise.all(
      freshJobs.map(async (job) => {
        const requirements = await api.get<JobRequirementWithCounts[]>(`/jobs/${job.id}/requirements`)
        const required = requirements.reduce((sum, r) => sum + r.quantity_required, 0)
        const confirmed = requirements.reduce((sum, r) => sum + r.quantity_confirmed, 0)
        const pencilled = requirements.reduce((sum, r) => sum + r.quantity_pencilled, 0)
        const offered = requirements.reduce((sum, r) => sum + r.quantity_offered, 0)
        return { job, requirements, required, confirmed, pencilled, offered }
      }),
    )
    setSummaries(withRequirements)
    setLoading(false)
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  return { summaries, loading, reload }
}
