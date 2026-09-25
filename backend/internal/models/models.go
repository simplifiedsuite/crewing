package models

import "time"

// --- Staff (scheduler/admin persona) ---

type UserRole string

const (
	UserRoleAdmin     UserRole = "admin"
	UserRoleScheduler UserRole = "scheduler"
)

type User struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Email              string    `json:"email"`
	Role               UserRole  `json:"role"`
	Active             bool      `json:"active"`
	MustChangePassword bool      `json:"must_change_password"`
	PasswordHash       string    `json:"-"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// --- Client ---

type Client struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	ContactName   *string `json:"contact_name,omitempty"`
	ContactEmail  *string `json:"contact_email,omitempty"`
	ContactPhone  *string `json:"contact_phone,omitempty"`
	Notes         *string `json:"notes,omitempty"`
	BrandColorHex *string `json:"brand_color_hex,omitempty"`
	Website       *string `json:"website,omitempty"`
	// CoreClientID links this row to Core's own Client entity — see
	// migrations/0009 and docs/simplified_suite_core_v0_6.md §5's mirroring
	// table. Nil for clients that predate this link or have never been
	// matched/created via the Job "Fetch from Monday" flow.
	CoreClientID *string   `json:"core_client_id,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// --- Venue ---

type Venue struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Address  *string `json:"address,omitempty"`
	City     *string `json:"city,omitempty"`
	Country  *string `json:"country,omitempty"`
	Timezone string  `json:"timezone"`
	Notes    *string `json:"notes,omitempty"`
	// CoreLocationID links this Venue to Core's own Location entity — see
	// migrations/0015. Nil for the handful of legacy local-only rows that
	// predate this link and are still referenced by real Jobs.
	CoreLocationID *string   `json:"core_location_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// --- Project (Ralto-local grouping of Jobs — not the suite-core Project) ---

type Project struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	ClientID        *string   `json:"client_id,omitempty"`
	DateStart       *string   `json:"date_start,omitempty"` // date, YYYY-MM-DD
	DateEnd         *string   `json:"date_end,omitempty"`
	SharedProjectID *string   `json:"shared_project_id,omitempty"` // inert until suite-core exists
	ColorHex        *string   `json:"color_hex,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// --- Job ---

type JobStatus string

const (
	JobStatusDraft     JobStatus = "draft"
	JobStatusDefining  JobStatus = "defining"
	JobStatusCrewing   JobStatus = "crewing"
	JobStatusConfirmed JobStatus = "confirmed"
	JobStatusBriefed   JobStatus = "briefed"
	JobStatusLive      JobStatus = "live"
	JobStatusComplete  JobStatus = "complete"
	JobStatusCancelled JobStatus = "cancelled"
)

type JobCommitment string

const (
	JobCommitmentPencil JobCommitment = "pencil"
	JobCommitmentFirm   JobCommitment = "firm"
)

type Job struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	ClientID         string  `json:"client_id"`
	ProjectReference *string `json:"project_reference,omitempty"`
	VenueID          *string `json:"venue_id,omitempty"`
	ProjectID        *string `json:"project_id,omitempty"`
	// SharedContractID is an optional direct link to Core's Contract entity
	// — see migrations/0009 and docs/simplified_suite_core_v0_6.md §8a. Not
	// a rename of ProjectID/projects.shared_project_id: Ralto's own
	// `projects` table is a separate, unrelated concept per that section.
	// SharedContractName is a cached label from the point this was linked
	// (or re-linked via the picker) — not live-refreshed, matching the
	// Monday integration's own "manual fetch, no reconciliation" rule (§5b).
	SharedContractID   *string `json:"shared_contract_id,omitempty"`
	SharedContractName *string `json:"shared_contract_name,omitempty"`
	// SharedJobID links this Job to Core's own shared Job entity — set
	// when this Job was created from a Monday fetch, whether that fetch
	// found an existing Core Job (created earlier, by either product) or
	// created a new one. See migrations/0010 and Core's own
	// migrations/0008_jobs.sql.
	SharedJobID *string `json:"shared_job_id,omitempty"`
	// OrderNumber is the Monday order number this Job was fetched with —
	// cached locally at fetch/create time (see migrations/0012), never
	// live-refreshed. Only set alongside SharedJobID; nil for hand-created Jobs.
	OrderNumber *string       `json:"order_number,omitempty"`
	StartDate   string        `json:"start_date"`
	EndDate     string        `json:"end_date"`
	Status      JobStatus     `json:"status"`
	Commitment  JobCommitment `json:"commitment"`
	// KickOffTime — testing feedback #45. The Job-level kick-off/on-air
	// moment itself (the match kicking off, the broadcast going live),
	// distinct from any individual booking's own call_time (which is
	// per-person, when THEY need to arrive — see bookings.call_time).
	KickOffTime *string       `json:"kick_off_time,omitempty"`
	ColorHex    *string       `json:"color_hex,omitempty"`
	Notes       *string       `json:"notes,omitempty"`
	CreatedBy   *string       `json:"created_by,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
	// DeletedAt/DeletedBy — testing feedback "Delete cancelled jobs into an
	// archive": a second axis alongside Status, same shape as Commitment
	// (see migrations/0004_pencil.sql). Only ever set via SoftDeleteJob,
	// only for a Cancelled job. DeletedByName is a joined display label
	// (see jobSelectColumns) — there's no frontend-reachable way to
	// resolve a staff user id to a name otherwise, since /users is
	// admin-only.
	DeletedAt     *time.Time `json:"deleted_at,omitempty"`
	DeletedBy     *string    `json:"deleted_by,omitempty"`
	DeletedByName *string    `json:"deleted_by_name,omitempty"`
}

type JobContact struct {
	ID        string  `json:"id"`
	JobID     string  `json:"job_id"`
	Name      string  `json:"name"`
	RoleTitle *string `json:"role_title,omitempty"`
	Email     *string `json:"email,omitempty"`
	Phone     *string `json:"phone,omitempty"`
}

// JobDayLabel — testing feedback R: what a specific day within a Job's own
// date range means (e.g. "Rig", "Match day", "Get-out"), independent of
// who's booked that day. See migrations/0020_job_day_labels.sql.
type JobDayLabel struct {
	ID    string `json:"id"`
	JobID string `json:"job_id"`
	Date  string `json:"date"`
	Label string `json:"label"`
}

// --- ProspectiveEvent ---

type ProspectiveEventStatus string

const (
	ProspectiveEventStatusOpen      ProspectiveEventStatus = "open"
	ProspectiveEventStatusConverted ProspectiveEventStatus = "converted"
	ProspectiveEventStatusDropped   ProspectiveEventStatus = "dropped"
)

type ProspectiveEvent struct {
	ID             string                 `json:"id"`
	Name           string                 `json:"name"`
	DateStart      string                 `json:"date_start"`
	DateEnd        string                 `json:"date_end"`
	ClientID       *string                `json:"client_id,omitempty"`
	Status         ProspectiveEventStatus `json:"status"`
	ConvertedJobID *string                `json:"converted_job_id,omitempty"`
	Notes          *string                `json:"notes,omitempty"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

// --- Role (master list) ---

type Role struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Category *string `json:"category,omitempty"`
}

// ContractRoleDefault is a starting-point crew role/quantity template for
// a Core Contract, applied to a new Job's requirements when it's created
// under that Contract. See migrations/0031_contract_role_defaults.sql.
type ContractRoleDefault struct {
	ID                 string    `json:"id"`
	SharedContractID   string    `json:"shared_contract_id"`
	SharedContractName string    `json:"shared_contract_name"`
	RoleID             string    `json:"role_id"`
	Quantity           int       `json:"quantity"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	// Populated on joined list reads only.
	RoleName     *string `json:"role_name,omitempty"`
	RoleCategory *string `json:"role_category,omitempty"`
}

// ContractWithRoleDefaults is one row of the "browse Contracts that
// already have defaults set" list — lets a scheduler find one without
// already knowing its name.
type ContractWithRoleDefaults struct {
	SharedContractID   string `json:"shared_contract_id"`
	SharedContractName string `json:"shared_contract_name"`
	DefaultCount       int    `json:"default_count"`
}

// JobVehicle is a Job's assignment to one of Core's shared Vehicles (see
// Core's migrations/0009_vehicles.sql) — distinct from
// Person.VehicleRegistration, which is a crew member's own personal car.
// No local mirror row: CoreVehicleID is a bare UUID (Core is a separate
// database), Name/Registration are a point-in-time cached label, same
// "cached, not live-refreshed" convention as Job.SharedContractName — see
// migrations/0029_job_core_vehicles.sql.
type JobVehicle struct {
	CoreVehicleID string `json:"core_vehicle_id"`
	Name          string `json:"name"`
	Registration  string `json:"registration"`
	// DriverPersonID/DriverName — testing feedback #47. Unlike
	// CoreVehicleID, `people` is Ralto's own local table, so this is a
	// real FK (job_core_vehicles.driver_person_id) joined at read time,
	// not a cached label.
	DriverPersonID *string `json:"driver_person_id,omitempty"`
	DriverName     *string `json:"driver_name,omitempty"`
}

// --- JobRequirement ---

type JobRequirement struct {
	ID               string  `json:"id"`
	JobID            string  `json:"job_id"`
	RoleID           string  `json:"role_id"`
	QuantityRequired int     `json:"quantity_required"`
	StartDate        string  `json:"start_date"`
	EndDate          string  `json:"end_date"`
	CallTime         *string `json:"call_time,omitempty"`
	Notes            *string `json:"notes,omitempty"`
}

// --- Person (crew persona) ---

type EmploymentType string

const (
	EmploymentTypeStaff      EmploymentType = "staff"
	EmploymentTypeFreelancer EmploymentType = "freelancer"
)

type PersonStatus string

const (
	PersonStatusActive   PersonStatus = "active"
	PersonStatusInactive PersonStatus = "inactive"
)

type PreferredStatus string

const (
	PreferredStatusPreferred  PreferredStatus = "preferred"
	PreferredStatusApproved   PreferredStatus = "approved"
	PreferredStatusStandard   PreferredStatus = "standard"
	PreferredStatusRestricted PreferredStatus = "restricted"
)

type Person struct {
	ID        string `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	// Email — testing feedback Y: not required if Phone is present (see
	// CreatePerson/UpdatePerson's own validation). people.email dropped its
	// NOT NULL for this; the UNIQUE(lower(email)) index is unaffected,
	// since Postgres never treats two NULLs as a duplicate.
	Email                *string         `json:"email,omitempty"`
	Phone                *string         `json:"phone,omitempty"`
	BaseLocation         *string         `json:"base_location,omitempty"`
	EmploymentType       EmploymentType  `json:"employment_type"`
	Status               PersonStatus    `json:"status"`
	PreferredStatus      PreferredStatus `json:"preferred_status"`
	StandardRate         *float64        `json:"standard_rate,omitempty"`
	RateCurrency         *string         `json:"rate_currency,omitempty"`
	OvertimeRuleID       *string         `json:"overtime_rule_id,omitempty"`
	Notes                *string         `json:"notes,omitempty"`
	CalendarFeedToken    *string         `json:"-"` // never serialized; exposed only via its own endpoint
	PhoneNumber          *string         `json:"phone_number,omitempty"`
	NotificationChannels *string         `json:"notification_channels,omitempty"` // JSON, e.g. {"email":true,"whatsapp":false}
	// VehicleRegistration is the crew member's own personal vehicle — for
	// site/parking access, not a fleet vehicle (see the separate Vehicle
	// entity, migrations/0014_fleet_vehicles.sql). Editable by both the
	// scheduler and the crew member themselves.
	VehicleRegistration *string `json:"vehicle_registration,omitempty"`
	// CompanyName — many freelancers operate through their own limited
	// company, which is who Simplified Suite actually contracts with on
	// paperwork. Crewing-local (not a Core Person field): captured now for
	// future auto-generated paperwork (contracts, purchase orders), not
	// used or displayed anywhere yet.
	CompanyName        *string   `json:"company_name,omitempty"`
	Active             bool      `json:"active"`
	MustChangePassword bool      `json:"must_change_password"`
	PasswordHash       *string   `json:"-"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type PersonRole struct {
	ID        string `json:"id"`
	PersonID  string `json:"person_id"`
	RoleID    string `json:"role_id"`
	IsPrimary bool   `json:"is_primary"`
	// Rate — Addendum v3 §4. Standing per-role rate override (e.g. a higher
	// rate when someone's booked into a secondary role). The resolution
	// chain this feeds (Booking.RateOverride -> PersonRole.Rate ->
	// Person.StandardRate) is later, buyout-generation-stage work — this is
	// just the field.
	Rate *float64 `json:"rate,omitempty"`
}

// --- Skill / Certification ---

type SkillType string

const (
	SkillTypeSkill         SkillType = "skill"
	SkillTypeCertification SkillType = "certification"
	SkillTypeVisa          SkillType = "visa"
	SkillTypeCredential    SkillType = "credential"
)

type Skill struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Type          SkillType `json:"type"`
	ExpiryTracked bool      `json:"expiry_tracked"`
}

type PersonSkillStatus string

const (
	PersonSkillStatusValid    PersonSkillStatus = "valid"
	PersonSkillStatusExpiring PersonSkillStatus = "expiring"
	PersonSkillStatusExpired  PersonSkillStatus = "expired"
)

type PersonSkill struct {
	ID         string            `json:"id"`
	PersonID   string            `json:"person_id"`
	SkillID    string            `json:"skill_id"`
	IssuedDate *string           `json:"issued_date,omitempty"`
	ExpiryDate *string           `json:"expiry_date,omitempty"`
	DocumentID *string           `json:"document_id,omitempty"`
	Status     PersonSkillStatus `json:"status"`
}

type PersonDocumentType string

const (
	PersonDocumentTypeCertification        PersonDocumentType = "certification"
	PersonDocumentTypeVisa                 PersonDocumentType = "visa"
	PersonDocumentTypeProductionCredential PersonDocumentType = "production_credential"
)

type PersonDocument struct {
	ID         string             `json:"id"`
	PersonID   string             `json:"person_id"`
	Type       PersonDocumentType `json:"type"`
	FileRef    string             `json:"file_ref"`
	ExpiryDate *string            `json:"expiry_date,omitempty"`
	UploadedAt time.Time          `json:"uploaded_at"`
}

type OvertimeRule struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	ThresholdHours float64 `json:"threshold_hours"`
	Multiplier     float64 `json:"multiplier"`
}

// --- Booking ---

type BookingStatus string

const (
	BookingStatusPencilled   BookingStatus = "pencilled"
	BookingStatusOffered     BookingStatus = "offered"
	BookingStatusConfirmed   BookingStatus = "confirmed"
	BookingStatusDeclined    BookingStatus = "declined"
	BookingStatusCancelled   BookingStatus = "cancelled"
	BookingStatusUnavailable BookingStatus = "unavailable"
	BookingStatusConflict    BookingStatus = "conflict"
	BookingStatusComplete    BookingStatus = "complete"
)

// BookingResponseChannel — Addendum v3 §2. Distinguishes a freelancer's own
// self-service response (once that flow exists) from a scheduler recording
// a response on someone's behalf. Null until a response is actually
// recorded; the write path that sets it is later work, not this stage.
type BookingResponseChannel string

const (
	BookingResponseChannelSelfService     BookingResponseChannel = "self_service"
	BookingResponseChannelSchedulerManual BookingResponseChannel = "scheduler_manual"
)

type Booking struct {
	ID               string                  `json:"id"`
	JobRequirementID string                  `json:"job_requirement_id"`
	PersonID         string                  `json:"person_id"`
	Status           BookingStatus           `json:"status"`
	StartDate        string                  `json:"start_date"`
	EndDate          string                  `json:"end_date"`
	CallTime         *string                 `json:"call_time,omitempty"`
	RateOverride     *float64                `json:"rate_override,omitempty"`
	OfferedAt        time.Time               `json:"offered_at"`
	RespondedAt      *time.Time              `json:"responded_at,omitempty"`
	ConfirmedAt      *time.Time              `json:"confirmed_at,omitempty"`
	Notes            *string                 `json:"notes,omitempty"`
	ResponseChannel  *BookingResponseChannel `json:"response_channel,omitempty"`
	// ConfirmedBy — populated when a scheduler presses Confirm (Addendum v3
	// §2). The write path is later work; this is just the field.
	ConfirmedBy *string `json:"confirmed_by,omitempty"`
}

type BookingShift struct {
	ID        string  `json:"id"`
	BookingID string  `json:"booking_id"`
	Date      string  `json:"date"`
	CallTime  string  `json:"call_time"`
	EndTime   string  `json:"end_time"`
	Notes     *string `json:"notes,omitempty"`
}

// --- Timesheet ---

type TimesheetStatus string

const (
	TimesheetStatusSubmitted TimesheetStatus = "submitted"
	TimesheetStatusApproved  TimesheetStatus = "approved"
	TimesheetStatusRejected  TimesheetStatus = "rejected"
)

type Timesheet struct {
	ID             string          `json:"id"`
	BookingID      string          `json:"booking_id"`
	ScheduledStart time.Time       `json:"scheduled_start"`
	ScheduledEnd   time.Time       `json:"scheduled_end"`
	ActualStart    *time.Time      `json:"actual_start,omitempty"`
	ActualEnd      *time.Time      `json:"actual_end,omitempty"`
	BreakMinutes   int             `json:"break_minutes"`
	Status         TimesheetStatus `json:"status"`
	SubmittedAt    *time.Time      `json:"submitted_at,omitempty"`
	ApprovedBy     *string         `json:"approved_by,omitempty"`
	ApprovedAt     *time.Time      `json:"approved_at,omitempty"`
	CalculatedCost *float64        `json:"calculated_cost,omitempty"`
}

// --- Availability ---

type AvailabilityStatus string

const (
	AvailabilityStatusAvailable   AvailabilityStatus = "available"
	AvailabilityStatusUnavailable AvailabilityStatus = "unavailable"
	AvailabilityStatusTentative   AvailabilityStatus = "tentative"
	AvailabilityStatusBooked      AvailabilityStatus = "booked"
)

type AvailabilityType string

const (
	AvailabilityTypeAnnualLeave AvailabilityType = "annual_leave"
	AvailabilityTypeSick        AvailabilityType = "sick"
	AvailabilityTypeToil        AvailabilityType = "toil"
	AvailabilityTypeBankHoliday AvailabilityType = "bank_holiday"
	AvailabilityTypeOther       AvailabilityType = "other"
)

type AvailabilityDayPortion string

const (
	AvailabilityDayPortionFull AvailabilityDayPortion = "full"
	AvailabilityDayPortionAM   AvailabilityDayPortion = "am"
	AvailabilityDayPortionPM   AvailabilityDayPortion = "pm"
)

type Availability struct {
	ID        string             `json:"id"`
	PersonID  string             `json:"person_id"`
	StartDate string             `json:"start_date"`
	EndDate   string             `json:"end_date"`
	Status    AvailabilityStatus `json:"status"`
	Type      *AvailabilityType  `json:"type,omitempty"`
	// DayPortion — testing feedback S: a second axis, same pattern as
	// Commitment (see migrations/0004_pencil.sql) — applies to the whole
	// entry's date range. Defaults to 'full' (see migrations/0019).
	DayPortion AvailabilityDayPortion `json:"day_portion"`
	Notes      *string                `json:"notes,omitempty"`
}

type AvailabilityRequestStatus string

const (
	AvailabilityRequestStatusPending   AvailabilityRequestStatus = "pending"
	AvailabilityRequestStatusResponded AvailabilityRequestStatus = "responded"
)

type AvailabilityResponse string

const (
	AvailabilityResponseYes       AvailabilityResponse = "yes"
	AvailabilityResponsePartially AvailabilityResponse = "partially"
	AvailabilityResponseNo        AvailabilityResponse = "no"
)

type AvailabilityRequest struct {
	ID                 string                    `json:"id"`
	PersonID           string                    `json:"person_id"`
	JobID              *string                   `json:"job_id,omitempty"`
	StartDate          string                    `json:"start_date"`
	EndDate            string                    `json:"end_date"`
	Message            *string                   `json:"message,omitempty"`
	Status             AvailabilityRequestStatus `json:"status"`
	Response           *AvailabilityResponse     `json:"response,omitempty"`
	RespondedAt        *time.Time                `json:"responded_at,omitempty"`
	SuggestedBookingID *string                   `json:"suggested_booking_id,omitempty"`
	CreatedAt          time.Time                 `json:"created_at"`
}

// --- Notifications (outbound, crew-facing; channel-agnostic per the addendum) ---

type NotificationType string

const (
	NotificationTypeBookingOffered      NotificationType = "booking_offered"
	NotificationTypeBookingConfirmed    NotificationType = "booking_confirmed"
	NotificationTypeBookingUpdated      NotificationType = "booking_updated"
	NotificationTypeBookingCancelled    NotificationType = "booking_cancelled"
	NotificationTypeShiftReminder       NotificationType = "shift_reminder"
	NotificationTypeAvailabilityRequest NotificationType = "availability_request"
	// NotificationTypeBookingPencilled — Addendum v3's freelancer
	// offer/pencil/confirm flow. The trigger that actually creates
	// Notification rows of this type is later work (not this stage) — this
	// is the value, matching the DB enum (migrations/0024_addendum_v3_schema.sql).
	NotificationTypeBookingPencilled NotificationType = "booking_pencilled"
)

type Notification struct {
	ID        string           `json:"id"`
	PersonID  string           `json:"person_id"`
	Type      NotificationType `json:"type"`
	Payload   string           `json:"payload"` // JSON blob: job name, times, venue, etc.
	CreatedAt time.Time        `json:"created_at"`
}

type NotificationChannel string

const (
	NotificationChannelInApp    NotificationChannel = "in_app"
	NotificationChannelEmail    NotificationChannel = "email"
	NotificationChannelWhatsApp NotificationChannel = "whatsapp"
)

type NotificationDeliveryStatus string

const (
	NotificationDeliveryStatusPending   NotificationDeliveryStatus = "pending"
	NotificationDeliveryStatusSent      NotificationDeliveryStatus = "sent"
	NotificationDeliveryStatusDelivered NotificationDeliveryStatus = "delivered"
	NotificationDeliveryStatusFailed    NotificationDeliveryStatus = "failed"
)

type NotificationDelivery struct {
	ID             string                     `json:"id"`
	NotificationID string                     `json:"notification_id"`
	Channel        NotificationChannel        `json:"channel"`
	Status         NotificationDeliveryStatus `json:"status"`
	SentAt         *time.Time                 `json:"sent_at,omitempty"`
}

// --- OrgBuyoutSettings (Addendum v3 §5) ---
//
// One row per organisation, mirroring org_settings' shape
// (migrations/0011_calendar_feeds.sql) rather than a new org-scoped-
// settings pattern. Every field but OrganisationID is nullable/omitempty:
// most orgs won't have a populated row at all yet (today, every org
// except LDM.tv — see migrations/0025_ldm_buyout_settings_seed.sql), and
// callers must treat "no row" and "row with nulls" as equally normal, not
// exceptional. The buyout-PDF generation this feeds is later work — this
// stage is the schema and struct only. PaymentTermsDays/InvoiceWindowDays/
// CancellationNoticeHours are the one exception to "blank until
// configured": the DB column carries a real default (30/180/48 — addendum
// v3 §5), so a freshly-inserted row without those three set still gets
// sane values rather than null.
type OrgBuyoutSettings struct {
	ID                      string    `json:"id"`
	OrganisationID          string    `json:"organisation_id"`
	CompanyLegalName        *string   `json:"company_legal_name,omitempty"`
	BillingAddress          *string   `json:"billing_address,omitempty"`
	InvoiceEmail            *string   `json:"invoice_email,omitempty"`
	AccountsEmail           *string   `json:"accounts_email,omitempty"`
	OperationsEmail         *string   `json:"operations_email,omitempty"`
	RateQueryContactName    *string   `json:"rate_query_contact_name,omitempty"`
	RateQueryContactEmail   *string   `json:"rate_query_contact_email,omitempty"`
	AccidentReportURL       *string   `json:"accident_report_url,omitempty"`
	PaymentTermsDays        *int      `json:"payment_terms_days,omitempty"`
	InvoiceWindowDays       *int      `json:"invoice_window_days,omitempty"`
	CancellationNoticeHours *int      `json:"cancellation_notice_hours,omitempty"`
	CreatedAt               time.Time `json:"created_at"`
	UpdatedAt               time.Time `json:"updated_at"`
}

// --- OperationalAlert (Today screen's "Needs attention") ---

type AlertType string

const (
	AlertTypeMissingCrew          AlertType = "missing_crew"
	AlertTypeLateConfirmation     AlertType = "late_confirmation"
	AlertTypeCallTimeChange       AlertType = "call_time_change"
	AlertTypeConflict             AlertType = "conflict"
	AlertTypeUnacknowledgedUpdate AlertType = "unacknowledged_update"
	AlertTypeNoShow               AlertType = "no_show"
	AlertTypeAutoSuggestedBooking AlertType = "auto_suggested_booking"
	// AlertTypeFreelancerAccepted — testing feedback #63. Raised at both
	// self-service accept paths (crew app, public email-token link), not
	// the scheduler-manual phone-response record (the scheduler doing
	// that already knows).
	AlertTypeFreelancerAccepted AlertType = "freelancer_accepted"
)

type AlertStatus string

const (
	AlertStatusOpen     AlertStatus = "open"
	AlertStatusResolved AlertStatus = "resolved"
)

type OperationalAlert struct {
	ID              string      `json:"id"`
	JobID           string      `json:"job_id"`
	Type            AlertType   `json:"type"`
	RelatedEntityID *string     `json:"related_entity_id,omitempty"`
	Status          AlertStatus `json:"status"`
	CreatedAt       time.Time   `json:"created_at"`
	ResolvedAt      *time.Time  `json:"resolved_at,omitempty"`
}

// --- ScheduleItHistory ("was this person on site that day" archive) ---
//
// Read-only from the API's side — every row comes from the one-shot import
// script (files/scheduleit_import.py), never created or edited through the
// app itself.

type ScheduleItHistory struct {
	ID                   string    `json:"id"`
	PersonID             *string   `json:"person_id,omitempty"`
	ScheduleItPersonName string    `json:"scheduleit_person_name"`
	ScheduleItEventID    string    `json:"scheduleit_event_id"`
	Title                string    `json:"title"`
	ClientName           *string   `json:"client_name,omitempty"`
	DateStart            string    `json:"date_start"`
	DateEnd              *string   `json:"date_end,omitempty"`
	Notes                *string   `json:"notes,omitempty"`
	CreatedAt            time.Time `json:"created_at"`
}
