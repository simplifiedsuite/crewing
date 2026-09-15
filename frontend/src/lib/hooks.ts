import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type {
  Availability,
  AvailabilityStatus,
  AvailabilityType,
  Booking,
  CandidateGroups,
  Client,
  CoreClient,
  CoreContract,
  CoreJob,
  CoreLocation,
  EmploymentType,
  Job,
  JobCommitment,
  JobRequirementWithCounts,
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
  Role,
  ScheduleItHistory,
  Skill,
  SkillType,
  Vehicle,
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

export function useVehicles() {
  return useCollection<Vehicle>('/vehicles')
}

export function createVehicle(input: { name: string; registration: string; notes?: string }) {
  return api.post<Vehicle>('/vehicles', input)
}

export function updateVehicle(id: string, input: { name: string; registration: string; notes?: string }) {
  return api.put<Vehicle>(`/vehicles/${id}`, input)
}

export function deleteVehicle(id: string) {
  return api.delete<{ ok: boolean }>(`/vehicles/${id}`)
}

export function listJobVehicles(jobId: string) {
  return api.get<Vehicle[]>(`/jobs/${jobId}/vehicles`)
}

export function assignVehicleToJob(jobId: string, vehicleId: string) {
  return api.post(`/jobs/${jobId}/vehicles`, { vehicle_id: vehicleId })
}

export function unassignVehicleFromJob(jobId: string, vehicleId: string) {
  return api.delete(`/jobs/${jobId}/vehicles/${vehicleId}`)
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

export function dropProspectiveEvent(id: string) {
  return api.post(`/prospective-events/${id}/drop`)
}

// useResourceCalendar — the "people down, dates across" read model
// (addendum v2 §1). includeIds is session state the caller owns (a
// scheduler searching in a specific freelancer to check against the
// grid) — not persisted, so it's just re-sent on every request.
export function useResourceCalendar(startDate: string, endDate: string, includeIds: string[]) {
  const [data, setData] = useState<ResourceCalendarResponse | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const includeKey = includeIds.join(',')

  const reload = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ start: startDate, end: endDate })
    if (includeKey) params.set('include', includeKey)
    return api
      .get<ResourceCalendarResponse>(`/resource-calendar?${params.toString()}`)
      .then(setData)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, includeKey])

  useEffect(() => {
    reload()
  }, [reload])

  return { data, loading, reload }
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

export function confirmBooking(id: string) {
  return api.post<Booking>(`/bookings/${id}/confirm`)
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
  input: { start_date: string; end_date: string; status: AvailabilityStatus; type?: AvailabilityType; notes?: string },
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
  email: string
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
export function offerBooking(
  requirementId: string,
  personId: string,
  startDate: string,
  endDate: string,
  callTime?: string,
  status: 'offered' | 'pencilled' | 'declined' = 'offered',
) {
  return api.post<Booking>(`/job-requirements/${requirementId}/bookings`, {
    person_id: personId,
    start_date: startDate,
    end_date: endDate,
    call_time: callTime,
    status,
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
