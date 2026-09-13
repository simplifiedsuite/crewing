// Mirrors the Go API's JSON response shapes 1:1 (bare JSON, no envelope —
// see backend/internal/handlers/helpers.go's writeJSON).

export type StaffRole = 'admin' | 'scheduler'

export interface StaffUser {
  id: string
  name: string
  email: string
  role: StaffRole
  active: boolean
  must_change_password: boolean
  created_at: string
  updated_at: string
}

export type EmploymentType = 'staff' | 'freelancer'
export type PersonStatus = 'active' | 'inactive'
export type PreferredStatus = 'preferred' | 'approved' | 'standard' | 'restricted'

export interface Person {
  id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  base_location?: string
  employment_type: EmploymentType
  status: PersonStatus
  preferred_status: PreferredStatus
  standard_rate?: number
  rate_currency?: string
  overtime_rule_id?: string
  notes?: string
  phone_number?: string
  notification_channels?: string
  active: boolean
  must_change_password: boolean
  created_at: string
  updated_at: string
  // Only present on ListPeople's response (the /people list) — the primary
  // role's category, for Crew's discipline filter. Absent (not just falsy)
  // on every other endpoint that returns a bare Person.
  primary_role_category?: string
}

// A Role a Person can be booked into (person_roles) — is_primary marks the
// one set at creation; ListPersonRoles/AddPersonRole/RemovePersonRole allow
// any number of additional (secondary) roles beyond it.
export interface PersonRole {
  id: string
  person_id: string
  role_id: string
  is_primary: boolean
  role_name: string
}

export interface Client {
  id: string
  name: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  notes?: string
  brand_color_hex?: string
  website?: string
  // core_client_id links this row to Core's own Client entity — set once
  // this client has been matched/created via a Job "Fetch from Monday"
  // (see docs/simplified_suite_core_v0_6.md §5). Absent for clients that
  // predate that link.
  core_client_id?: string
  created_at: string
  updated_at: string
}

// The subset of Core's own Client shape Ralto's Monday-fetch flow reads —
// fetched live from Core (GET /core-clients, proxied), never from Ralto's
// local mirror, per §5a's "pickers always go live" rule.
export interface CoreClient {
  id: string
  name: string
  website?: string
  brand_color_hex?: string
}

// The subset of Core's own Contract shape the "Link to a Contract?"
// picker reads — also fetched live (GET /core-contracts?client_id=...).
export interface CoreContract {
  id: string
  client_id: string
  client_name: string
  name: string
  date_start?: string
  date_end?: string
}

// Core's own shared Job entity — one Monday order-number fetch, visible
// from every product (see Core's migrations/0008_jobs.sql). client_name/
// contract_name are joined in for display — see GetCoreJobByOrderNumber.
export interface CoreJob {
  id: string
  order_number: string
  name: string
  client_id: string
  client_name: string
  contract_id?: string
  contract_name?: string
  date_start?: string
  date_end?: string
  client_reference?: string
  delivery_address?: string
}

export interface Venue {
  id: string
  name: string
  address?: string
  city?: string
  country?: string
  timezone: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface Role {
  id: string
  name: string
  category?: string
}

export interface OvertimeRule {
  id: string
  name: string
  threshold_hours: number
  multiplier: number
}

export type SkillType = 'skill' | 'certification' | 'visa' | 'credential'

export interface Skill {
  id: string
  name: string
  type: SkillType
  expiry_tracked: boolean
}

// Ralto's own Project (addendum v1 §1) — groups multiple Jobs under one
// umbrella (a multi-day tournament, a season of fixtures). Distinct from
// the future suite-core Project shared_project_id will eventually point
// at, which doesn't exist yet.
export interface Project {
  id: string
  name: string
  client_id?: string
  date_start?: string
  date_end?: string
  shared_project_id?: string
  color_hex?: string
  created_at: string
  updated_at: string
}

export type JobStatus = 'draft' | 'defining' | 'crewing' | 'confirmed' | 'briefed' | 'live' | 'complete' | 'cancelled'
export type JobCommitment = 'pencil' | 'firm'

export interface Job {
  id: string
  name: string
  client_id: string
  project_reference?: string
  venue_id?: string
  project_id?: string
  // shared_contract_id is a direct, optional link to Core's Contract —
  // separate from project_id (Ralto's own, unrelated Project concept, see
  // Project's own comment above). shared_contract_name is a cached label
  // from when it was last linked, not live-refreshed — see
  // docs/simplified_suite_core_v0_6.md §8a/§5b.
  shared_contract_id?: string
  shared_contract_name?: string
  // shared_job_id links this Job to Core's own shared Job entity — set
  // when created from a Monday fetch, whether that fetch found an
  // existing Core Job or created a new one. See Core's
  // migrations/0008_jobs.sql.
  shared_job_id?: string
  start_date: string
  end_date: string
  status: JobStatus
  commitment: JobCommitment
  color_hex?: string
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
}

export interface JobContact {
  id: string
  job_id: string
  name: string
  role_title?: string
  email?: string
  phone?: string
}

export interface JobRequirementWithCounts {
  id: string
  job_id: string
  role_id: string
  role_name: string
  quantity_required: number
  quantity_confirmed: number
  quantity_pencilled: number
  quantity_offered: number
  start_date: string
  end_date: string
  call_time?: string
  notes?: string
}

export type BookingStatus = 'pencilled' | 'offered' | 'confirmed' | 'declined' | 'cancelled' | 'unavailable' | 'conflict' | 'complete'

export interface Booking {
  id: string
  job_requirement_id: string
  person_id: string
  status: BookingStatus
  start_date: string
  end_date: string
  call_time?: string
  rate_override?: number
  offered_at: string
  responded_at?: string
  confirmed_at?: string
  notes?: string
  // Only present on ListBookingsForRequirement's response — the booked
  // person's name, for Jobs' JobRoleRow. Absent on every other endpoint
  // that returns a bare Booking.
  first_name?: string
  last_name?: string
}

export interface CrewBooking extends Booking {
  role_name: string
  job_name: string
  client_name: string
  venue_name?: string
  job_start_date: string
  job_end_date: string
}

export interface Candidate {
  person_id: string
  name: string
  base_location?: string
  preferred_status: PreferredStatus
  standard_rate?: number
  rate_currency?: string
  reason?: string
}

export interface AlreadyAskedEntry {
  person_id: string
  name: string
  role_name?: string
  asked_at: string
  responded_at?: string
}

export interface AlreadyAskedGroup {
  awaiting_response: AlreadyAskedEntry[]
  declined: AlreadyAskedEntry[]
}

export interface CandidateGroups {
  suitable: Candidate[]
  possible: Candidate[]
  unavailable: Candidate[]
  already_asked: AlreadyAskedGroup
}

export type AlertType =
  | 'missing_crew'
  | 'late_confirmation'
  | 'call_time_change'
  | 'conflict'
  | 'unacknowledged_update'
  | 'no_show'
  | 'auto_suggested_booking'

export interface OperationalAlert {
  id: string
  job_id: string
  job_name: string
  type: AlertType
  related_entity_id?: string
  status: 'open' | 'resolved'
  created_at: string
  resolved_at?: string
}

export type AvailabilityRequestStatus = 'pending' | 'responded'
export type AvailabilityResponseValue = 'yes' | 'partially' | 'no'

export interface AvailabilityRequest {
  id: string
  person_id: string
  job_id?: string
  start_date: string
  end_date: string
  message?: string
  status: AvailabilityRequestStatus
  response?: AvailabilityResponseValue
  responded_at?: string
  suggested_booking_id?: string
  created_at: string
}

export type ProspectiveEventStatus = 'open' | 'converted' | 'dropped'

export interface ProspectiveEvent {
  id: string
  name: string
  date_start: string
  date_end: string
  client_id?: string
  status: ProspectiveEventStatus
  converted_job_id?: string
  notes?: string
  created_at: string
  updated_at: string
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'tentative' | 'booked'
export type AvailabilityType = 'annual_leave' | 'sick' | 'toil' | 'other'

export interface Availability {
  id: string
  person_id: string
  start_date: string
  end_date: string
  status: AvailabilityStatus
  type?: AvailabilityType
  notes?: string
}

// Read-only — every row comes from the one-shot ScheduleIt import script,
// never created or edited through the app itself.
export interface ScheduleItHistory {
  id: string
  person_id?: string
  scheduleit_person_name: string
  scheduleit_event_id: string
  title: string
  client_name?: string
  date_start: string
  date_end?: string
  notes?: string
  created_at: string
}

export interface PersonDocument {
  id: string
  person_id: string
  type: 'certification' | 'visa' | 'production_credential'
  file_ref: string
  expiry_date?: string
  uploaded_at: string
}

// --- Resource calendar (addendum v2 §1) — "people down, dates across" ---

export interface ResourceCalendarBooking {
  id: string
  job_id: string
  job_name: string
  role_name: string
  job_status: JobStatus
  job_commitment: JobCommitment
  effective_color_hex?: string
  status: BookingStatus
  start_date: string
  end_date: string
  call_time?: string
}

export interface ResourceCalendarAvailabilityEntry {
  id: string
  status: AvailabilityStatus
  type?: AvailabilityType
  start_date: string
  end_date: string
  notes?: string
}

export interface ResourceCalendarRow {
  person_id: string
  name: string
  employment_type: EmploymentType
  bookings: ResourceCalendarBooking[]
  availability: ResourceCalendarAvailabilityEntry[]
}

export interface ResourceCalendarResponse {
  start_date: string
  end_date: string
  rows: ResourceCalendarRow[]
  prospective_events: ProspectiveEvent[]
}
