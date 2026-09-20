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
  // email — testing feedback Y: not required if phone is present (backend
  // enforces "at least one of the two", not "email always").
  email?: string
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
  // The crew member's own personal vehicle registration, for site/parking
  // access — distinct from a fleet Vehicle (see Vehicle/JobVehicle below).
  vehicle_registration?: string
  // Many freelancers operate through their own limited company, which is
  // who Simplified Suite actually contracts with on paperwork. Captured
  // for future auto-generated paperwork (contracts, purchase orders) —
  // Crewing-local, not shown anywhere but the edit screen yet.
  company_name?: string
  active: boolean
  must_change_password: boolean
  created_at: string
  updated_at: string
  // Only present on ListPeople's response (the /people list). Absent (not
  // just falsy) on every other endpoint that returns a bare Person.
  primary_role_category?: string
  // Every distinct category across ALL of this person's roles, not just
  // primary_role_category — what Crew's discipline filter actually
  // matches against, so a secondary skill (e.g. Sound on someone whose
  // primary role is Camera Op) is still filterable. Same
  // ListPeople-only availability as primary_role_category.
  role_categories?: string[]
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
  core_location_id?: string
  created_at: string
  updated_at: string
}

// The subset of Core's own Location shape the Job Venue picker reads —
// fetched live (GET /core-locations, proxied), same "pickers go live"
// rule as CoreClient/CoreContract above.
export interface CoreLocation {
  id: string
  name: string
  address?: string
  timezone?: string
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

// Core's own shared Vehicle entity — identity only (name/label,
// registration). Fetched live (GET /core-vehicles) for the Job "Assign a
// vehicle" picker, same pattern as CoreClient/CoreLocation. Distinct from
// Person.vehicle_registration, a crew member's own personal car.
export interface CoreVehicle {
  id: string
  name: string
  registration: string
}

// A Job's assignment to one of Core's shared Vehicles — cached
// name/registration at the time it was assigned (re-picking is how it's
// refreshed), same shape job_core_vehicles stores server-side.
export interface JobVehicle {
  core_vehicle_id: string
  name: string
  registration: string
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
  // The Monday order number this Job was fetched with — cached locally at
  // fetch/create time, only ever set alongside shared_job_id. See
  // migrations/0012_job_order_number.sql.
  order_number?: string
  start_date: string
  end_date: string
  status: JobStatus
  commitment: JobCommitment
  color_hex?: string
  notes?: string
  created_by?: string
  created_at: string
  updated_at: string
  // deleted_at/deleted_by — testing feedback "Delete cancelled jobs into
  // an archive": a second axis alongside status, same shape as
  // commitment. deleted_by_name is a joined display label (there's no
  // frontend-reachable way to resolve a staff user id to a name
  // otherwise, since /users is admin-only).
  deleted_at?: string
  deleted_by?: string
  deleted_by_name?: string
}

export interface JobContact {
  id: string
  job_id: string
  name: string
  role_title?: string
  email?: string
  phone?: string
}

// JobDayLabel — testing feedback R: what a specific day within a Job's own
// date range means (e.g. "Rig", "Match day"), independent of who's booked.
export interface JobDayLabel {
  id: string
  job_id: string
  date: string
  label: string
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
  // shift_dates — testing feedback item L — the actual booking_shifts day
  // coverage (YYYY-MM-DD, ascending), also only present on
  // ListBookingsForRequirement's response. Empty for a booking created
  // before this feature existed and never since updated — treat that the
  // same as full coverage, not zero days (see BookingDaysBadge).
  shift_dates?: string[]
  // response_channel/confirmed_by — Addendum v3 §2. Null until an actual
  // response has been recorded (either path) — see backend's own comment
  // on ConfirmBooking/RecordBookingResponse/RespondToOffer for exactly
  // when each is set.
  response_channel?: 'self_service' | 'scheduler_manual'
  confirmed_by?: string
  // employment_type — only present on ListBookingsForRequirement's
  // response (joined from Person), same "one extra endpoint-specific
  // field" pattern as first_name/last_name above. Planner's BookedPersonRow
  // needs it to gate Confirm (freelancer: pencilled only, per Addendum v3
  // §1) and to show the "record a phone response" actions (freelancer +
  // offered only) correctly — staff are unaffected either way.
  employment_type?: 'staff' | 'freelancer'
}

export interface CrewBooking extends Booking {
  role_name: string
  job_name: string
  client_name: string
  // client_color_hex — the Client's own brand_color_hex, absent when
  // unset. Same field desktop's Planner already reads for its own
  // client-colour stripe (see clientColor in RaltoDesktopApp.tsx).
  client_color_hex?: string
  venue_name?: string
  // venue_address/city/country — the Venue's own Core-synced address
  // fields, absent whenever the Venue has no Core Location behind it (or
  // no venue is set at all, same as venue_name). Used to build the "open
  // in Maps" link — see venueMapsQuery in RaltoCrewApp.tsx.
  venue_address?: string
  venue_city?: string
  venue_country?: string
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
  // conflict_job_id/conflict_job_name — only set for the conflicted bucket
  // below: which other Job this person is already booked on.
  conflict_job_id?: string
  conflict_job_name?: string
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
  // conflicted — testing feedback Z: a double-booking (travel-day clash)
  // is a warning, not a hard block, so it's kept separate from
  // unavailable (which stays a real lockout — an explicit day off).
  conflicted: Candidate[]
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
export type AvailabilityType = 'annual_leave' | 'sick' | 'toil' | 'bank_holiday' | 'other'

// day_portion — testing feedback S: a second axis alongside status/type,
// applying to the whole entry's date range. Defaults to 'full'.
export type AvailabilityDayPortion = 'full' | 'am' | 'pm'

export interface Availability {
  id: string
  person_id: string
  start_date: string
  end_date: string
  status: AvailabilityStatus
  type?: AvailabilityType
  day_portion: AvailabilityDayPortion
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
  day_portion: AvailabilityDayPortion
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
