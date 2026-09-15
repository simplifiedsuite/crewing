import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  LayoutDashboard,
  Calendar,
  Briefcase,
  CalendarRange,
  Users,
  Bell,
  RefreshCw,
  UserPlus,
  Check,
  ChevronRight,
  ChevronLeft,
  Search,
  Settings,
  MapPin,
  Phone,
  CalendarDays,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Minus,
  Star,
  LogOut,
  Plus,
  Trash2,
  Rows3,
  X,
  AlertOctagon,
  Pencil,
  UserX,
  KeyRound,
  Link as LinkIcon,
  Copy,
  Archive as ArchiveIcon,
  CalendarCheck2,
} from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { useStaffAuth } from '../../context/StaffAuthContext'
import {
  useAlerts,
  useClients,
  useVenues,
  useJobSummaries,
  usePeople,
  useCandidates,
  useAvailability,
  createAvailability,
  deleteAvailability,
  useScheduleItHistory,
  useProspectiveEvents,
  createProspectiveEvent,
  dropProspectiveEvent,
  convertProspectiveEvent,
  useResourceCalendar,
  useProjects,
  useRoles,
  createJob,
  updateJob,
  updateJobStatus,
  useCompletedJobsForPerson,
  createJobRequirement,
  updateJobRequirement,
  deleteJobRequirement,
  createVenue,
  createJobContact,
  fetchMondayProjectLookup,
  listCoreClients,
  createCoreClient,
  linkCoreClient,
  listCoreLocations,
  createCoreLocation,
  linkCoreVenue,
  listCoreContracts,
  getCoreJobByOrderNumber,
  createCoreJob,
  refreshCoreJob,
  indexById,
  resolveAlert,
  offerBooking,
  cancelBooking,
  confirmBooking,
  updateBookingDays,
  useBookingsForRequirement,
  listBookingsForRequirement,
  createPerson,
  updatePerson,
  deletePerson,
  usePersonRoles,
  addPersonRole,
  removePersonRole,
  invitePerson,
  useOvertimeRules,
  createOvertimeRule,
  updateOvertimeRule,
  deleteOvertimeRule,
  useSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  createRole,
  updateRole,
  deleteRole,
  useVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  listJobVehicles,
  assignVehicleToJob,
  unassignVehicleFromJob,
  type JobSummary,
  type PersonWriteInput,
  type MondayProjectLookup,
} from '../../lib/hooks'
import type {
  AlreadyAskedEntry,
  Availability,
  AvailabilityStatus,
  AvailabilityType,
  Booking,
  BookingStatus,
  Client,
  CoreClient,
  CoreContract,
  CoreJob,
  CoreLocation,
  EmploymentType,
  Job,
  JobCommitment,
  JobStatus,
  JobContact,
  JobRequirementWithCounts,
  OperationalAlert,
  OvertimeRule,
  Person,
  PersonRole,
  PreferredStatus,
  Project,
  ProspectiveEvent,
  ResourceCalendarBooking,
  ResourceCalendarRow,
  Role,
  ScheduleItHistory,
  Skill,
  SkillType,
  Vehicle,
  Venue,
} from '../../types'

// ---------------------------------------------------------------------------
// Combined desktop app — merges what were ralto-today-desktop.jsx,
// ralto-jobs-desktop.jsx, ralto-planner-desktop.jsx and
// ralto-crew-desktop.jsx into one shell with a single Sidebar and real
// navigation. Design tokens and layout are unchanged from the prototype;
// every hardcoded mock constant has been replaced with live data from the
// Ralto API via src/lib/hooks.ts.
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { key: 'today', label: 'Today', icon: LayoutDashboard },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'team', label: 'Team', icon: Rows3 },
  { key: 'jobs', label: 'Jobs', icon: Briefcase },
  { key: 'planner', label: 'Planner', icon: CalendarRange },
  { key: 'crew', label: 'Crew', icon: Users },
  // Testing feedback item E: Complete jobs live here, separate from the
  // active Jobs list — its own nav item, not tucked under Settings, since
  // it's a real working view (with its own crew filter), not reference data.
  { key: 'archive', label: 'Archive', icon: ArchiveIcon },
] as const

type NavKey = (typeof NAV_ITEMS)[number]['key'] | 'settings'

const FALLBACK_CLIENT_COLORS = ['#453E96', '#F4511E', '#1B3A8C', '#006C35', '#E10600', '#005C30']

function clientColor(client: Client | undefined, fallbackIndex: number): string {
  if (client?.brand_color_hex) return client.brand_color_hex
  return FALLBACK_CLIENT_COLORS[fallbackIndex % FALLBACK_CLIENT_COLORS.length]
}

// Every date field from the API comes back as a plain "YYYY-MM-DD" string —
// this is the one place that gets turned into the requested DD/MM/YY
// display format, so every call site stays consistent by construction
// rather than by remembering to match the others.
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

// The four-tag vocabulary from addendum v2 §4, expanded per testing
// feedback item E: Complete now gets its own tag (it already existed as a
// real Job.status value but was never surfaced — every non-cancelled job
// used to fall through to Pencil/Booked regardless). Derived, never
// stored: Cancelled beats Complete beats commitment. The lifecycle enum
// underneath (Draft..Live, the "internal progress" states) still never
// renders here directly — draft/defining/crewing/confirmed/briefed/live
// all still collapse into Pencilled/Booked exactly as before; only
// Complete/Cancelled get their own tag, because those are the two states
// with new dedicated actions and (Complete) a whole separate Archive view.
function jobStatusTag(job: Job): { label: string; color: string; bg: string } {
  if (job.status === 'cancelled') return { label: 'Cancelled', color: 'var(--danger)', bg: 'var(--danger-bg)' }
  if (job.status === 'complete') return { label: 'Complete', color: 'var(--ink-muted)', bg: 'var(--track)' }
  if (job.commitment === 'pencil') return { label: 'Pencilled', color: 'var(--primary-soft)', bg: 'var(--primary-tint)' }
  return { label: 'Booked', color: 'var(--success)', bg: 'var(--success-bg)' }
}

function CommitmentBadge({ job }: { job: Job }) {
  const tag = jobStatusTag(job)
  return (
    <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 10.5, padding: '2px 8px', borderRadius: 999, color: tag.color, background: tag.bg, whiteSpace: 'nowrap' }}>
      {tag.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Shared Sidebar
// ---------------------------------------------------------------------------

// Clicking the wordmark now takes you to the real Simplified Suite
// (simplifiedsuite.io), not the old dark mockup screen (SuiteContent) that
// used to live in this file — that screen's correct visual design has been
// carried over to Core's own real Landing/admin screens instead, wired to
// real data there, so this component has nothing left to open locally.
function Sidebar({ active, onSelect }: { active: NavKey; onSelect: (k: NavKey) => void }) {
  const { logout } = useStaffAuth()
  return (
    <div style={{ width: 232, flexShrink: 0, background: '#fff', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', padding: '24px 16px' }}>
      <button
        onClick={() => { window.location.href = 'https://simplifiedsuite.io' }}
        title="Open Simplified Suite"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px', marginBottom: 4, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div style={{ width: 20, height: 4, borderRadius: 2, background: 'var(--primary)' }} />
          <div style={{ width: 15, height: 4, borderRadius: 2, background: 'var(--primary)' }} />
          <div style={{ width: 10, height: 4, borderRadius: 2, background: 'var(--primary)' }} />
        </div>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', letterSpacing: 0.2 }}>Crewing</span>
      </button>
      <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', padding: '4px 8px 24px', lineHeight: 1.4 }}>Crewing, simplified.</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.key === active
          return (
            <button
              key={item.key}
              onClick={() => onSelect(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 8,
                border: 'none',
                background: isActive ? 'var(--primary-tint)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--ink-muted)',
                fontFamily: 'var(--font)',
                fontWeight: isActive ? 600 : 500,
                fontSize: 13.5,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon size={16} />
              {item.label}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />

      <button
        onClick={logout}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 8, color: 'var(--ink-muted)', fontFamily: 'var(--font)', fontWeight: 500, fontSize: 13.5, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <LogOut size={16} />
        Sign out
      </button>
      <button
        onClick={() => onSelect('settings')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '9px 10px',
          borderRadius: 8,
          border: 'none',
          background: active === 'settings' ? 'var(--primary-tint)' : 'transparent',
          color: active === 'settings' ? 'var(--primary)' : 'var(--ink-muted)',
          fontFamily: 'var(--font)',
          fontWeight: active === 'settings' ? 600 : 500,
          fontSize: 13.5,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Settings size={16} />
        Settings
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function isLiveToday(job: Job): boolean {
  const today = todayISO()
  return job.start_date <= today && job.end_date >= today && job.status !== 'cancelled' && job.status !== 'complete'
}

const ALERT_COPY: Record<OperationalAlert['type'], { title: string; icon: typeof Bell; tone: 'attention' | 'danger'; actionLabel: string }> = {
  missing_crew: { title: 'Position unfilled', icon: UserPlus, tone: 'danger', actionLabel: 'Find crew' },
  late_confirmation: { title: 'Late confirmation', icon: Clock, tone: 'attention', actionLabel: 'Follow up' },
  call_time_change: { title: 'Call time changed', icon: RefreshCw, tone: 'attention', actionLabel: 'Mark reviewed' },
  conflict: { title: 'Booking conflict', icon: AlertTriangle, tone: 'danger', actionLabel: 'Resolve' },
  unacknowledged_update: { title: 'Call-time change unacknowledged', icon: RefreshCw, tone: 'attention', actionLabel: 'Mark acknowledged' },
  no_show: { title: 'No-show reported', icon: AlertTriangle, tone: 'danger', actionLabel: 'Review' },
  auto_suggested_booking: { title: 'Auto-suggested booking to review', icon: Bell, tone: 'attention', actionLabel: 'Review' },
}

const toneColor = {
  attention: { fg: 'var(--attention)', bg: 'var(--attention-bg)' },
  danger: { fg: 'var(--danger)', bg: 'var(--danger-bg)' },
}

function StatCard({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '18px 20px' }}>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 30, fontVariantNumeric: 'tabular-nums', color: tone || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 6 }}>{label}</div>
    </div>
  )
}

function AttentionCard({ alert, onResolve }: { alert: OperationalAlert; onResolve: (id: string) => void }) {
  const copy = ALERT_COPY[alert.type]
  const Icon = copy.icon
  const tone = toneColor[copy.tone]
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: '#fff', display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 34, height: 34, borderRadius: 999, background: tone.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={16} color={tone.fg} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{copy.title}</div>
        <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>{alert.job_name}</div>
      </div>
      <button
        onClick={() => onResolve(alert.id)}
        style={{ flexShrink: 0, background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '7px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
      >
        {copy.actionLabel} <Check size={12} />
      </button>
    </div>
  )
}

function TodayContent({
  summaries,
  clients,
  alerts,
  reloadAlerts,
  onOpenJob,
}: {
  summaries: JobSummary[]
  clients: Record<string, Client>
  alerts: OperationalAlert[]
  reloadAlerts: () => void
  onOpenJob: (id: string) => void
}) {
  const liveSummaries = useMemo(() => summaries.filter((s) => isLiveToday(s.job)), [summaries])
  const totalRequired = liveSummaries.reduce((sum, s) => sum + s.required, 0)
  const totalConfirmed = liveSummaries.reduce((sum, s) => sum + s.confirmed, 0)

  async function resolve(id: string) {
    await resolveAlert(id)
    reloadAlerts()
  }

  const today = new Date()
  const dateLabel = today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 32px 0' }}>
        <div>
          <div style={{ fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink-muted)' }}>{dateLabel}</div>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 26, color: 'var(--ink)' }}>Today</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, padding: '24px 32px 0' }}>
        <StatCard value={liveSummaries.length} label="Jobs live" />
        <StatCard value={totalRequired} label="Crew needed" />
        <StatCard value={totalConfirmed} label="Confirmed & ready" tone={totalConfirmed === totalRequired && totalRequired > 0 ? 'var(--success)' : 'var(--attention)'} />
      </div>

      <div style={{ display: 'flex', gap: 20, padding: '28px 32px 32px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1.4 }}>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)', marginBottom: 12 }}>Needs attention</div>
          {alerts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {alerts.map((alert) => (
                <AttentionCard key={alert.id} alert={alert} onResolve={resolve} />
              ))}
            </div>
          ) : (
            <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '26px 20px', textAlign: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: 999, background: 'var(--success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                <Check size={17} color="var(--success)" />
              </div>
              <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>All crew covered</div>
              <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>No action required.</div>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)', marginBottom: 12 }}>Today's jobs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {liveSummaries.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No jobs running today.</div>}
            {liveSummaries.map((s, i) => {
              const complete = s.confirmed === s.required && s.required > 0
              const client = clients[s.job.client_id]
              return (
                <div
                  key={s.job.id}
                  onClick={() => onOpenJob(s.job.id)}
                  style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '12px 14px 12px 18px', overflow: 'hidden', cursor: 'pointer' }}
                >
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: clientColor(client, i) }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.job.name}</div>
                      <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>{client?.name ?? 'Unknown client'}</div>
                    </div>
                    <div style={{ flexShrink: 0, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: complete ? 'var(--success)' : 'var(--attention)' }}>
                      {s.confirmed}/{s.required}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = (d.getDay() + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - day)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function sameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString()
}

// monthSpan defaults to 1 (existing single-month behaviour, untouched) —
// the 2-month view passes 2 to get one continuous run of weeks covering
// both months. Deliberately one continuous cursor walk rather than two
// separate getMonthWeeks(refDate) / getMonthWeeks(nextMonth) calls: two
// independent calls would each pad out to a full week at the seam,
// duplicating that shared week (and its job bars, each with its own
// independently-packed lane assignment) once as "next month" filler in
// month 1's grid and again as "prev month" filler in month 2's — a single
// walk across the full range produces that seam week exactly once.
function getMonthWeeks(refDate: Date, monthSpan = 1): Date[][] {
  const year = refDate.getFullYear()
  const month = refDate.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const lastOfRange = new Date(year, month + monthSpan, 0)
  const gridStart = startOfWeek(firstOfMonth)
  const gridEnd = startOfWeek(lastOfRange)
  const weeks: Date[][] = []
  let cursor = gridStart
  while (cursor <= gridEnd) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)))
    cursor = addDays(cursor, 7)
  }
  return weeks
}

interface CalendarJob {
  id: string
  name: string
  clientColor: string
  start: string
  end: string
  confirmed: number
  required: number
}

// packRanges is the shared lane-packing algorithm behind both the job bars
// and the ProspectiveEvent bands below — same "clip to this week, stack
// overlaps into lanes" problem for any dated item.
function packRanges<T>(weekDates: Date[], items: T[], getRange: (item: T) => { start: string; end: string }) {
  const weekStart = weekDates[0]
  const weekEnd = addDays(weekDates[6], 1)

  const overlapping = items
    .map((item) => {
      const { start, end } = getRange(item)
      const itemStart = new Date(start + 'T00:00:00')
      const itemEnd = addDays(new Date(end + 'T00:00:00'), 1)
      if (itemEnd <= weekStart || itemStart >= weekEnd) return null
      const clippedStart = itemStart < weekStart ? weekStart : itemStart
      const clippedEndExclusive = itemEnd > weekEnd ? weekEnd : itemEnd
      const startCol = Math.round((clippedStart.getTime() - weekStart.getTime()) / DAY_MS)
      const endCol = Math.round((clippedEndExclusive.getTime() - weekStart.getTime()) / DAY_MS) - 1
      return { item, startCol, endCol, itemStart }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.itemStart.getTime() - b.itemStart.getTime() || a.startCol - b.startCol)

  const laneEnds: number[] = []
  const placed: Array<{ item: T; startCol: number; endCol: number; lane: number }> = []
  for (const entry of overlapping) {
    let lane = laneEnds.findIndex((end) => end < entry.startCol)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(entry.endCol)
    } else {
      laneEnds[lane] = entry.endCol
    }
    placed.push({ item: entry.item, startCol: entry.startCol, endCol: entry.endCol, lane })
  }
  return { placed, laneCount: laneEnds.length }
}

function packWeek(weekDates: Date[], jobs: CalendarJob[]) {
  const { placed, laneCount } = packRanges(weekDates, jobs, (job) => ({ start: job.start, end: job.end }))
  return { placed: placed.map((p) => ({ job: p.item, startCol: p.startCol, endCol: p.endCol, lane: p.lane })), laneCount }
}

function packProspectiveBands(weekDates: Date[], events: ProspectiveEvent[]) {
  const { placed, laneCount } = packRanges(weekDates, events, (e) => ({ start: e.date_start, end: e.date_end }))
  return { placed: placed.map((p) => ({ event: p.item, startCol: p.startCol, endCol: p.endCol, lane: p.lane })), laneCount }
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// ProspectiveEvent bands render in their own thin strip above the job
// lanes, never mixed into the same lane-packing as real jobs — addendum v2
// §3's "visible behind the schedule, never presenting itself as a job"
// means distinct space and distinct texture (dashed outline, no fill),
// not competing with job bars for the same row.
function ProspectiveBandRow({ weekDates, events, onSelect }: { weekDates: Date[]; events: ProspectiveEvent[]; onSelect: (event: ProspectiveEvent) => void }) {
  const { placed, laneCount } = packProspectiveBands(weekDates, events)
  if (laneCount === 0) return null
  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 16, padding: '2px 4px 0' }}>
      {placed.map(({ event, startCol, endCol, lane }) => (
        <div
          key={event.id}
          onClick={() => onSelect(event)}
          title={`${event.name} (prospective) — ${formatDate(event.date_start)} – ${formatDate(event.date_end)}`}
          style={{
            gridColumn: `${startCol + 1} / ${endCol + 2}`,
            gridRow: lane + 1,
            margin: '1px 4px',
            border: '1px dashed var(--primary-soft)',
            borderRadius: 4,
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            cursor: 'pointer',
            background: 'repeating-linear-gradient(135deg, var(--primary-tint), var(--primary-tint) 4px, transparent 4px, transparent 8px)',
          }}
        >
          <span style={{ fontFamily: 'var(--font)', fontStyle: 'italic', fontWeight: 500, fontSize: 10.5, color: 'var(--primary-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{event.name}</span>
        </div>
      ))}
    </div>
  )
}

function WeekRow({
  weekDates,
  referenceMonths,
  tall,
  jobs,
  events,
  onOpenJob,
  onSelectEvent,
}: {
  weekDates: Date[]
  // Plural: the 2-month view has two "current" months, and any day
  // belonging to either should render normally (not greyed) — only the
  // genuine leading/trailing overflow into the month *before* or *after*
  // the visible range is greyed, same convention as single-month view.
  referenceMonths: number[]
  tall: boolean
  jobs: CalendarJob[]
  events: ProspectiveEvent[]
  onOpenJob: (id: string) => void
  onSelectEvent: (event: ProspectiveEvent) => void
}) {
  const { placed, laneCount } = packWeek(weekDates, jobs)
  const barHeight = tall ? 30 : 22
  const today = new Date()

  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {weekDates.map((date) => {
          const inMonth = referenceMonths.includes(date.getMonth())
          const isToday = sameDay(date, today)
          return (
            <div key={date.toISOString()} style={{ padding: '8px 10px 4px', fontFamily: 'var(--font)', fontSize: 12.5, fontWeight: isToday ? 700 : 500, color: isToday ? 'var(--primary)' : inMonth ? 'var(--ink)' : 'var(--ink-muted)', opacity: inMonth ? 1 : 0.5 }}>
              {isToday ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: '50%', background: 'var(--primary)', color: '#fff' }}>{date.getDate()}</span>
              ) : (
                date.getDate()
              )}
            </div>
          )
        })}
      </div>
      <ProspectiveBandRow weekDates={weekDates} events={events} onSelect={onSelectEvent} />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: barHeight + 4, padding: '0 4px 8px', minHeight: laneCount === 0 ? 10 : undefined }}>
        {placed.map(({ job, startCol, endCol, lane }) => (
          <div
            key={job.id}
            onClick={() => onOpenJob(job.id)}
            title={`${job.name} — ${job.confirmed}/${job.required} confirmed. Click to open in Planner.`}
            style={{ gridColumn: `${startCol + 1} / ${endCol + 2}`, gridRow: lane + 1, margin: '2px 4px', background: job.clientColor, borderRadius: 6, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden', cursor: 'pointer' }}
          >
            <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.name}</span>
            <span style={{ fontFamily: 'var(--font)', fontSize: 11, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 'auto' }}>
              {job.confirmed}/{job.required}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AddProspectiveEventForm({ clients, onSaved, onCancel }: { clients: Client[]; onSaved: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [dateStart, setDateStart] = useState(todayISO())
  const [dateEnd, setDateEnd] = useState(todayISO())
  const [clientId, setClientId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const inputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff' }

  async function submit() {
    setSaving(true)
    setError(undefined)
    try {
      await createProspectiveEvent({ name, date_start: dateStart, date_end: dateEnd, client_id: clientId || undefined, notes: notes || undefined })
      onSaved()
    } catch {
      setError('Could not save that event.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--primary-soft)', background: 'var(--primary-surface)', borderRadius: 10, padding: 14, marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2 }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. FA Cup Final" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>Start date</span>
          <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>End date</span>
          <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>Client</span>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={inputStyle}>
            <option value="">Unknown / TBC</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" style={inputStyle} />
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-muted)' }}>
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || !name || !dateStart || !dateEnd}
          style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Saving…' : 'Add event'}
        </button>
      </div>
    </div>
  )
}

function ProspectiveEventDetailCard({
  event,
  client,
  onDropped,
  onClose,
  onConvert,
}: {
  event: ProspectiveEvent
  client: Client | undefined
  onDropped: () => void
  onClose: () => void
  onConvert: (event: ProspectiveEvent) => void
}) {
  const [dropping, setDropping] = useState(false)

  async function drop() {
    setDropping(true)
    try {
      await dropProspectiveEvent(event.id)
      onDropped()
    } finally {
      setDropping(false)
    }
  }

  return (
    <div style={{ border: '1px dashed var(--primary-soft)', background: 'var(--primary-surface)', borderRadius: 10, padding: 14, marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>
          {event.name} <span style={{ fontWeight: 500, fontSize: 11.5, color: 'var(--primary-soft)', fontStyle: 'italic' }}>· Prospective</span>
        </div>
        <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
          {formatDate(event.date_start)} – {formatDate(event.date_end)}
          {client ? ` · ${client.name}` : ''}
        </div>
        {event.notes && <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 4 }}>{event.notes}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={onClose} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-muted)' }}>
          Close
        </button>
        <button
          onClick={() => onConvert(event)}
          style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
        >
          Convert to job
        </button>
        <button
          onClick={drop}
          disabled={dropping}
          title="Mark as never happening — kept for history, not deleted"
          style={{ border: '1px solid var(--danger)', background: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', color: 'var(--danger)', opacity: dropping ? 0.7 : 1 }}
        >
          {dropping ? 'Dropping…' : 'Drop'}
        </button>
      </div>
    </div>
  )
}

type CalendarMode = 'month' | 'week' | '2months'
const CALENDAR_MODE_LABELS: Record<CalendarMode, string> = { month: 'Month', week: 'Week', '2months': '2 months' }

function CalendarContent({
  summaries,
  clients,
  onOpenJob,
  onConvertEvent,
}: {
  summaries: JobSummary[]
  clients: Record<string, Client>
  onOpenJob: (id: string) => void
  onConvertEvent: (event: ProspectiveEvent) => void
}) {
  const [mode, setMode] = useState<CalendarMode>('month')
  const [refDate, setRefDate] = useState(new Date())
  const [addingEvent, setAddingEvent] = useState(false)
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>(undefined)
  const { data: prospectiveEvents, reload: reloadEvents } = useProspectiveEvents()

  const openEvents = useMemo(() => prospectiveEvents.filter((e) => e.status === 'open'), [prospectiveEvents])
  const selectedEvent = openEvents.find((e) => e.id === selectedEventId)

  const calendarJobs: CalendarJob[] = useMemo(
    () =>
      summaries.map((s, i) => ({
        id: s.job.id,
        name: s.job.name,
        clientColor: clientColor(clients[s.job.client_id], i),
        start: s.job.start_date,
        end: s.job.end_date,
        confirmed: s.confirmed,
        required: s.required,
      })),
    [summaries, clients],
  )

  // '2months' walks getMonthWeeks as one continuous run (monthSpan: 2) —
  // see that function's own comment for why this must not be two separate
  // getMonthWeeks(refDate) calls (it would duplicate the seam week).
  const weeks =
    mode === 'month'
      ? getMonthWeeks(refDate)
      : mode === '2months'
        ? getMonthWeeks(refDate, 2)
        : [Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(refDate), i))]

  // Both months in a 2-month view are "current" — only genuine overflow
  // into the month before/after the visible range should grey out, same
  // convention as single-month view's leading/trailing filler days.
  const secondMonthRef = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 1)
  const referenceMonths = mode === '2months' ? [refDate.getMonth(), secondMonthRef.getMonth()] : [refDate.getMonth()]

  const goPrev = () =>
    setRefDate((d) => {
      if (mode === 'month') return new Date(d.getFullYear(), d.getMonth() - 1, 1)
      if (mode === '2months') return new Date(d.getFullYear(), d.getMonth() - 2, 1)
      return addDays(d, -7)
    })
  const goNext = () =>
    setRefDate((d) => {
      if (mode === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1)
      if (mode === '2months') return new Date(d.getFullYear(), d.getMonth() + 2, 1)
      return addDays(d, 7)
    })
  const goToday = () => setRefDate(new Date())

  const headerLabel =
    mode === 'month'
      ? `${MONTH_LABELS[refDate.getMonth()]} ${refDate.getFullYear()}`
      : mode === '2months'
        ? refDate.getFullYear() === secondMonthRef.getFullYear()
          ? `${MONTH_LABELS[refDate.getMonth()]} – ${MONTH_LABELS[secondMonthRef.getMonth()]} ${refDate.getFullYear()}`
          : `${MONTH_LABELS[refDate.getMonth()]} ${refDate.getFullYear()} – ${MONTH_LABELS[secondMonthRef.getMonth()]} ${secondMonthRef.getFullYear()}`
        : (() => {
            const s = startOfWeek(refDate)
            const e = addDays(s, 6)
            return `${s.getDate()} – ${e.getDate()} ${MONTH_LABELS[e.getMonth()]} ${e.getFullYear()}`
          })()

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 24, color: 'var(--ink)' }}>Calendar</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setAddingEvent(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px dashed var(--primary-soft)', background: '#fff', color: 'var(--primary-soft)', borderRadius: 8, padding: '7px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
          >
            <Plus size={13} /> Prospective event
          </button>
          <div style={{ display: 'flex', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 3 }}>
            {(['month', 'week', '2months'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{ background: mode === m ? 'var(--primary-tint)' : 'none', color: mode === m ? 'var(--primary)' : 'var(--ink-muted)', border: 'none', borderRadius: 7, padding: '6px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
              >
                {CALENDAR_MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {addingEvent && (
        <AddProspectiveEventForm
          clients={Object.values(clients)}
          onCancel={() => setAddingEvent(false)}
          onSaved={() => {
            setAddingEvent(false)
            reloadEvents()
          }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={goPrev} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronLeft size={15} color="var(--ink-muted)" />
          </button>
          <button onClick={goNext} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <ChevronRight size={15} color="var(--ink-muted)" />
          </button>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 15, color: 'var(--ink)', marginLeft: 4 }}>{headerLabel}</div>
        </div>
        <button onClick={goToday} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer' }}>
          Today
        </button>
      </div>

      <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
          {WEEKDAY_LABELS.map((d) => (
            <div key={d} style={{ padding: '8px 10px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              {d}
            </div>
          ))}
        </div>
        {weeks.map((weekDates, i) => (
          <Fragment key={i}>
            {/* One continuous week-grid, not two separate month blocks (see
                getMonthWeeks's comment) — this divider is purely a visual
                orientation cue marking where the second month starts,
                rendered exactly once right before the week that contains
                its 1st, never duplicating a week or its job bars. */}
            {mode === '2months' && weekDates.some((d) => sameDay(d, secondMonthRef)) && (
              <div style={{ padding: '6px 10px', fontFamily: 'var(--font)', fontWeight: 700, fontSize: 11.5, color: 'var(--ink)', background: 'var(--surface)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
                {MONTH_LABELS[secondMonthRef.getMonth()]} {secondMonthRef.getFullYear()}
              </div>
            )}
            <WeekRow
              weekDates={weekDates}
              referenceMonths={referenceMonths}
              tall={mode === 'week'}
              jobs={calendarJobs}
              events={openEvents}
              onOpenJob={onOpenJob}
              onSelectEvent={(event) => setSelectedEventId(event.id)}
            />
          </Fragment>
        ))}
      </div>

      {selectedEvent && (
        <ProspectiveEventDetailCard
          event={selectedEvent}
          client={selectedEvent.client_id ? clients[selectedEvent.client_id] : undefined}
          onClose={() => setSelectedEventId(undefined)}
          onConvert={onConvertEvent}
          onDropped={() => {
            setSelectedEventId(undefined)
            reloadEvents()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

// jobComplete means every requirement is actually confirmed, not just
// "spoken for" — checked per-requirement rather than off the aggregate
// confirmed/required sums, since an over-crewed role and an under-crewed
// role could otherwise cancel out in the totals and still look complete.
function urgencyFor(summary: JobSummary) {
  const jobComplete = summary.required > 0 && summary.requirements.every((r) => r.quantity_confirmed >= r.quantity_required)
  if (jobComplete) return { tier: 'complete', color: 'var(--success)', bg: 'var(--success-bg)', Icon: CheckCircle2, title: 'Fully crewed — every role confirmed' }
  const daysUntilStart = Math.ceil((new Date(summary.job.start_date).getTime() - Date.now()) / DAY_MS)
  if (daysUntilStart <= 5) return { tier: 'critical', color: 'var(--danger)', bg: 'var(--danger-bg)', Icon: AlertTriangle, title: 'Starts within 5 days and still not fully crewed' }
  if (daysUntilStart <= 30) return { tier: 'attention', color: 'var(--attention)', bg: 'var(--attention-bg)', Icon: Clock, title: 'Starts within 30 days and still not fully crewed' }
  return { tier: 'quiet', color: 'var(--ink-muted)', bg: 'var(--track)', Icon: Minus, title: 'Starts more than 30 days out — not urgent yet' }
}

function JobListRow({ summary, client, selected, fallbackIndex, onOpen }: { summary: JobSummary; client: Client | undefined; selected: boolean; fallbackIndex: number; onOpen: (id: string) => void }) {
  const u = urgencyFor(summary)
  const quiet = u.tier === 'complete' || u.tier === 'quiet'
  const pct = summary.required > 0 ? (summary.confirmed / summary.required) * 100 : 0
  const StatusIcon = u.Icon

  return (
    <button
      onClick={() => onOpen(summary.job.id)}
      // Testing feedback item K: flex items default to flex-shrink: 1, and
      // a row here has overflow:hidden — once the list's natural total
      // height (26+ rows) exceeds the scroll container's visible height,
      // flexbox was shrinking every row below its own content's height
      // instead of letting the container actually scroll past them,
      // collapsing the name/tag line and the date line into each other.
      // flexShrink: 0 makes each row keep its natural content height, so
      // the container scrolls instead of squeezing rows.
      style={{ position: 'relative', width: '100%', textAlign: 'left', background: selected ? 'var(--primary-tint)' : '#fff', border: selected ? '1px solid var(--primary-soft)' : '1px solid var(--line)', borderRadius: 12, padding: '12px 14px 12px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden', flexShrink: 0 }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: clientColor(client, fallbackIndex), opacity: quiet ? 0.6 : 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: quiet ? 'var(--ink-muted)' : 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary.job.name}</span>
            <CommitmentBadge job={summary.job} />
          </div>
          <span style={{ fontFamily: 'var(--font)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 12.5, color: u.color, flexShrink: 0 }}>
            {summary.confirmed}/{summary.required}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>
          {formatDate(summary.job.start_date)} – {formatDate(summary.job.end_date)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 999, background: 'var(--track)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: u.tier === 'quiet' ? 'var(--ink-muted)' : u.color, opacity: quiet ? 0.5 : 1 }} />
          </div>
        </div>
      </div>
      {/* Testing feedback item G: this badge had no tooltip anywhere, so
          the triangle/clock/check/minus distinction (crewing-complete vs.
          days-until-start urgency, per urgencyFor above) wasn't
          discoverable — hover text now states it in plain language. */}
      <div title={u.title} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: u.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <StatusIcon size={12} color={u.color} strokeWidth={2.5} />
      </div>
    </button>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0' }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--primary-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={14} color="var(--primary)" />
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>{label}</div>
        <div style={{ fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)', marginTop: 1 }}>{value}</div>
      </div>
    </div>
  )
}

// Compact role row for the Jobs detail pane — deliberately not the same
// progress-bar component Planner's RequirementRow renders (that duplication
// was the actual complaint from office testing): just role name, the tick,
// and the count. An unfilled role is a link straight into Planner,
// pre-targeted at this exact requirement — there's nothing to click through
// to on an already-confirmed role, so those stay plain, non-interactive rows.
// BOOKING_STATUS_ICON — one row per person now, each with its own
// confirmed/pencilled/offered state, so the tick/clock/warning logic
// JobRoleRow used to compute once for the whole role is needed per booking
// instead. Pencil reuses the icon literally named for it, matching the
// same colour the pencil-hatch progress-bar segment already uses elsewhere
// in this file (RequirementRow).
const BOOKING_STATUS_ICON: Partial<Record<BookingStatus, { Icon: typeof CheckCircle2; color: string }>> = {
  confirmed: { Icon: CheckCircle2, color: 'var(--success)' },
  offered: { Icon: Clock, color: 'var(--attention)' },
  pencilled: { Icon: Pencil, color: 'var(--primary-soft)' },
}

// Every date from start_date to end_date inclusive, "YYYY-MM-DD" — the
// frontend twin of the backend's own expandDateRange (booking_shifts.go),
// used to know a booking's full day count and to build the day-picker.
function expandDateRangeClient(start: string, end: string): string[] {
  const days: string[] = []
  let d = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (d <= last) {
    days.push(d.toISOString().slice(0, 10))
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
  }
  return days
}

// BookingDaysBadge — testing feedback item L: which specific day(s) within
// a multi-day Job someone is booked for. A click-to-edit badge, shared
// between Jobs' BookedPersonRow and Planner's booked-people list. An empty
// shift_dates (a booking created before this feature shipped, never since
// updated) is treated the same as full coverage rather than a false "0 of
// N days" warning — see bookingWithPersonResponse's own comment server-side.
function BookingDaysBadge({ booking, onUpdated }: { booking: Booking; onUpdated: () => void }) {
  const fullDays = useMemo(() => expandDateRangeClient(booking.start_date, booking.end_date), [booking.start_date, booking.end_date])
  const covered = booking.shift_dates && booking.shift_dates.length > 0 ? booking.shift_dates : fullDays
  const isPartial = covered.length < fullDays.length

  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(covered))
  const [saving, setSaving] = useState(false)

  if (fullDays.length <= 1) return null

  function startEditing() {
    setSelected(new Set(covered))
    setEditing(true)
  }

  async function save() {
    if (selected.size === 0) return
    setSaving(true)
    try {
      await updateBookingDays(booking, Array.from(selected).sort())
      setEditing(false)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEditing}
        title={isPartial ? `Covers ${covered.length} of ${fullDays.length} days — click to change` : 'Covers every day of this booking — click to change'}
        style={{ display: 'flex', alignItems: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontFamily: 'var(--font)', fontSize: 11, fontWeight: 600, color: isPartial ? 'var(--attention)' : 'var(--ink-muted)' }}
      >
        <CalendarCheck2 size={11} />
        {isPartial ? `${covered.length}/${fullDays.length} days` : 'All days'}
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        zIndex: 5,
        right: 0,
        top: '100%',
        marginTop: 4,
        border: '1px solid var(--line)',
        background: '#fff',
        borderRadius: 8,
        padding: 10,
        boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 150,
      }}
    >
      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, color: 'var(--ink)' }}>Days covered</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
        {fullDays.map((day) => (
          <label key={day} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={selected.has(day)}
              onChange={(e) =>
                setSelected((prev) => {
                  const next = new Set(prev)
                  if (e.target.checked) next.add(day)
                  else next.delete(day)
                  return next
                })
              }
            />
            {formatDate(day)}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button
          type="button"
          onClick={() => setEditing(false)}
          style={{ flex: 1, border: '1px solid var(--line)', background: '#fff', borderRadius: 6, padding: '4px 0', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11, cursor: 'pointer', color: 'var(--ink-muted)' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || selected.size === 0}
          style={{ flex: 1, border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 6, padding: '4px 0', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11, cursor: 'pointer', opacity: saving || selected.size === 0 ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function BookedPersonRow({
  booking,
  onConfirm,
  onCancel,
  onDaysUpdated,
}: {
  booking: Booking
  onConfirm: () => void
  onCancel: () => void
  onDaysUpdated: () => void
}) {
  const meta = BOOKING_STATUS_ICON[booking.status] ?? BOOKING_STATUS_ICON.offered!
  const Icon = meta.Icon
  // Confirm is only a legal transition from pencilled/offered — same guard
  // "Confirm everyone" already applies via pendingBookings, since the
  // backend's ConfirmBooking has no status check of its own (unlike
  // DeleteBooking) and would happily re-confirm and re-email an already-
  // confirmed or declined booking if asked to.
  const canConfirm = booking.status === 'pencilled' || booking.status === 'offered'
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <Icon size={13} color={meta.color} strokeWidth={2.5} />
        <span style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {booking.first_name} {booking.last_name}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <BookingDaysBadge booking={booking} onUpdated={onDaysUpdated} />
        {canConfirm && (
          <button
            onClick={onConfirm}
            title="Confirm this booking"
            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, color: 'var(--ink-muted)', display: 'flex' }}
          >
            <Check size={13} />
          </button>
        )}
        <button
          onClick={onCancel}
          title="Cancel this booking"
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, color: 'var(--ink-muted)', display: 'flex' }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

// JobRoleRow — used to be either a plain (complete) row or a button
// wrapping the whole thing linking into Planner (incomplete). A role can
// now be partially filled, so it shows the real names actually booked
// (whatever their status) plus, only if the role is still short of people
// (not just short of confirmations — offered/pencilled people aren't
// "still needed" even though the role isn't confirmed-complete yet), the
// same "find more in Planner" link as before.
function JobRoleRow({
  req,
  bookings,
  onOpenInPlanner,
  onConfirmBooking,
  onCancelBooking,
  onDaysUpdated,
  onDeleteRequirement,
}: {
  req: JobRequirementWithCounts
  bookings: Booking[]
  onOpenInPlanner: (req: JobRequirementWithCounts) => void
  onConfirmBooking: (bookingId: string) => void
  onCancelBooking: (bookingId: string) => void
  onDaysUpdated: () => void
  // Testing feedback item F: there was previously no way to remove a
  // whole role requirement, only individual people booked against it.
  onDeleteRequirement: (req: JobRequirementWithCounts) => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const roleComplete = req.quantity_confirmed >= req.quantity_required
  const stillNeeded = req.quantity_required - req.quantity_confirmed - req.quantity_pencilled - req.quantity_offered
  const StatusIcon = roleComplete ? CheckCircle2 : req.quantity_offered > 0 ? Clock : AlertTriangle
  const statusColor = roleComplete ? 'var(--success)' : 'var(--attention)'
  const statusBg = roleComplete ? 'var(--success-bg)' : 'var(--attention-bg)'
  // Testing feedback item G — same "no tooltip anywhere" gap as the Jobs
  // list badge, one level down: this is per-role, not per-job (offered vs.
  // nobody-asked-yet), a genuinely different thing from urgencyFor's
  // days-until-start reading even though it reuses the same two icons.
  const statusTitle = roleComplete ? 'Role fully confirmed' : req.quantity_offered > 0 ? 'Someone has been offered this role, not yet confirmed' : 'Nobody has been offered this role yet'

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{req.role_name}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font)', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, fontWeight: 600, color: roleComplete ? 'var(--ink-muted)' : 'var(--attention)' }}>
            {req.quantity_confirmed}/{req.quantity_required}
          </span>
          <div title={statusTitle} style={{ width: 22, height: 22, borderRadius: '50%', background: statusBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StatusIcon size={12} color={statusColor} strokeWidth={2.5} />
          </div>
          <button
            onClick={() => setConfirmingDelete(true)}
            title="Delete this role requirement"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 2, display: 'flex' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {bookings.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', flexDirection: 'column' }}>
          {bookings.map((b) => (
            <BookedPersonRow key={b.id} booking={b} onConfirm={() => onConfirmBooking(b.id)} onCancel={() => onCancelBooking(b.id)} onDaysUpdated={onDaysUpdated} />
          ))}
        </div>
      )}

      {stillNeeded > 0 && !confirmingDelete && (
        <button
          onClick={() => onOpenInPlanner(req)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, textAlign: 'left' }}
        >
          Find {stillNeeded} more in Planner <ChevronRight size={12} />
        </button>
      )}

      {confirmingDelete && (
        <div style={{ border: '1px solid var(--danger)', background: 'var(--danger-bg)', borderRadius: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink)' }}>
            Delete this {req.role_name} requirement?
            {bookings.length > 0
              ? ` This removes ${bookings.length} ${bookings.length === 1 ? 'person' : 'people'} booked against it (confirmed, pencilled, or offered) — not just the empty slots.`
              : ' No one is booked against it yet.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmingDelete(false)} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}>
              Never mind
            </button>
            <button
              onClick={() => onDeleteRequirement(req)}
              style={{ border: 'none', background: 'var(--danger)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
            >
              Yes, delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Job creation ---
//
// Scheduler-side, desktop-only. Field list is the data model doc's Job
// entity (§2.3) plus addendum v1 §1 (project_id) and addendum v2 §4
// (commitment) — not inferred from what the rest of the UI happens to
// show. Colour is deliberately absent: it's inherited (Job → Project →
// Client), never picked, so there's no colour control here at all.
//
// Requirements are folded into this form rather than left for Planner,
// because Planner has no way to add a requirement to a job either — a
// pre-existing gap, not something addendum v2 introduced. A job created
// here without at least the option to add roles would come out
// permanently uncrewable from the UI.

export interface JobCreatePrefill {
  name?: string
  start_date?: string
  end_date?: string
  client_id?: string
  fromProspectiveEventId?: string
}

interface DraftRequirement {
  key: number
  role_id: string
  quantity_required: string
  start_date: string
  end_date: string
}

interface DraftContact {
  key: number
  name: string
  role_title: string
  email: string
  phone: string
}

const matchInputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff', width: '100%', boxSizing: 'border-box' as const }
const matchButtonStyle = { border: '1px solid var(--primary-soft)', background: '#fff', color: 'var(--primary-soft)', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }
const matchPrimaryButtonStyle = { border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }

// Job "Fetch from Monday", Stage A (Crewing) — client matching is manual,
// never automatic (see the task's own decision): this panel always shows
// its result and waits for an explicit confirm/create/pick before ever
// calling onResolved. Client matching (and everything else here) reads
// live from Core every time it mounts — see
// docs/simplified_suite_core_v0_6.md §5a's "pickers always go live" rule —
// keyed by fetchedName at the call site so a different Monday fetch
// remounts this with a clean slate rather than reusing stale match state.
function ClientMatchPanel({ fetchedName, onResolved }: { fetchedName: string; onResolved: (local: Client, core: CoreClient) => void }) {
  const [status, setStatus] = useState<'loading' | 'matched' | 'no-match' | 'picking' | 'creating' | 'resolved' | 'error'>('loading')
  const [coreClients, setCoreClients] = useState<CoreClient[]>([])
  const [matched, setMatched] = useState<CoreClient | undefined>(undefined)
  const [pickId, setPickId] = useState('')
  const [newName, setNewName] = useState(fetchedName)
  const [resolved, setResolved] = useState<Client | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    listCoreClients()
      .then((list) => {
        if (cancelled) return
        setCoreClients(list)
        const norm = (s: string) => s.trim().toLowerCase()
        const found = list.find((c) => norm(c.name) === norm(fetchedName))
        setMatched(found)
        setStatus(found ? 'matched' : 'no-match')
      })
      .catch(() => {
        if (cancelled) return
        setError('Could not reach Simplified Suite Core to check for a matching client — pick or create one manually below, or leave the Client field blank and set it later.')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [fetchedName])

  async function confirm(core: CoreClient) {
    setBusy(true)
    setError(undefined)
    try {
      const local = await linkCoreClient({ core_client_id: core.id, name: core.name, brand_color_hex: core.brand_color_hex, website: core.website })
      setResolved(local)
      setStatus('resolved')
      onResolved(local, core)
    } catch {
      setError('Could not link that client — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function createAndConfirm() {
    if (!newName.trim()) return
    setBusy(true)
    setError(undefined)
    try {
      const core = await createCoreClient({ name: newName.trim() })
      await confirm(core)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Only an organisation admin can add a new client in Simplified Suite Core — pick an existing one below, or ask your admin to add it.'
          : 'Could not create that client.',
      )
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>Client from Monday: "{fetchedName}"</div>

      {status === 'loading' && <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>Checking Simplified Suite for a matching client…</div>}

      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      {status === 'matched' && matched && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>
            Matched <strong>{matched.name}</strong> in Simplified Suite.
          </span>
          <button onClick={() => confirm(matched)} disabled={busy} style={matchPrimaryButtonStyle}>
            {busy ? 'Linking…' : 'Use this client'}
          </button>
          <button onClick={() => setStatus('picking')} style={matchButtonStyle}>
            Choose a different client
          </button>
        </div>
      )}

      {status === 'no-match' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>No client named "{fetchedName}" found in Simplified Suite.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setStatus('creating')} style={matchPrimaryButtonStyle}>
              Create new client
            </button>
            <button onClick={() => setStatus('picking')} style={matchButtonStyle}>
              Choose an existing client
            </button>
          </div>
        </div>
      )}

      {status === 'creating' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...matchInputStyle, flex: 1 }} />
          <button onClick={createAndConfirm} disabled={busy || !newName.trim()} style={matchPrimaryButtonStyle}>
            {busy ? 'Creating…' : 'Create & link'}
          </button>
          <button onClick={() => setStatus(matched ? 'matched' : 'no-match')} style={matchButtonStyle}>
            Cancel
          </button>
        </div>
      )}

      {status === 'picking' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={pickId} onChange={(e) => setPickId(e.target.value)} style={{ ...matchInputStyle, flex: 1 }}>
            <option value="">Select a client…</option>
            {coreClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const c = coreClients.find((c) => c.id === pickId)
              if (c) confirm(c)
            }}
            disabled={busy || !pickId}
            style={matchPrimaryButtonStyle}
          >
            {busy ? 'Linking…' : 'Use selected'}
          </button>
          <button onClick={() => setStatus(matched ? 'matched' : 'no-match')} style={matchButtonStyle}>
            Cancel
          </button>
        </div>
      )}

      {status === 'resolved' && resolved && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={14} color="var(--success)" />
          <span style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>
            Client confirmed: <strong>{resolved.name}</strong>
          </span>
          <button onClick={() => setStatus(matched ? 'matched' : 'no-match')} style={matchButtonStyle}>
            Change
          </button>
        </div>
      )}
    </div>
  )
}

// The optional "Link to a Contract?" step (Job Fetch-from-Monday, Stage A
// §4) — always skippable, scoped to whichever Client the Job resolves to.
// Live from Core every time coreClientId changes, per §5a.
function ContractPicker({
  coreClientId,
  value,
  onChange,
}: {
  coreClientId: string
  value?: { id: string; name: string }
  onChange: (contract: { id: string; name: string } | undefined) => void
}) {
  const [contracts, setContracts] = useState<CoreContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(undefined)
    listCoreContracts(coreClientId)
      .then((list) => {
        if (!cancelled) {
          setContracts(list)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Could not load contracts from Simplified Suite Core.')
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [coreClientId])

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>
      Link to a Contract? (optional)
      {loading ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>Loading this client's contracts…</div>
      ) : error ? (
        <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>
      ) : (
        <select
          value={value?.id ?? ''}
          onChange={(e) => {
            const c = contracts.find((c) => c.id === e.target.value)
            onChange(c ? { id: c.id, name: c.name } : undefined)
          }}
          style={matchInputStyle}
        >
          <option value="">No contract — standalone job</option>
          {contracts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </label>
  )
}

// Shared Core Job entity — one Monday order-number fetch, visible from
// every product (see Core's own migrations/0008_jobs.sql). Shown instead
// of ClientMatchPanel when Core already has this order number: the
// person still gets one explicit confirm step ("Use this job") before
// anything is applied — order_number matching itself needs no fuzzy
// logic, but silently adopting a found record without showing it first
// would break the same "never auto-apply" rule Stage A's Client match
// already established. "Re-check Monday for updates" is the one
// deliberately separate action that actually re-pulls Monday — the
// default path here never calls Monday at all.
function FoundJobPanel({ job, onUse }: { job: CoreJob; onUse: (job: CoreJob) => void }) {
  const [current, setCurrent] = useState(job)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | undefined>(undefined)
  const [used, setUsed] = useState(false)

  async function refresh() {
    setRefreshing(true)
    setRefreshError(undefined)
    try {
      const updated = await refreshCoreJob(current.id)
      setCurrent(updated)
    } catch {
      setRefreshError('Could not reach Monday to re-check this job.')
    } finally {
      setRefreshing(false)
    }
  }

  const dateRange = current.date_start ? `${current.date_start}${current.date_end && current.date_end !== current.date_start ? ` – ${current.date_end}` : ''}` : undefined

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>Already in Simplified Suite</div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>
        <strong>{current.name}</strong> — {current.client_name}
        {current.contract_name ? ` · ${current.contract_name}` : ''}
        {dateRange ? ` · ${dateRange}` : ''}
      </div>
      {refreshError && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{refreshError}</div>}
      {used ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>
          <Check size={14} color="var(--success)" /> Applied
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              setUsed(true)
              onUse(current)
            }}
            style={matchPrimaryButtonStyle}
          >
            Use this job
          </button>
          <button onClick={refresh} disabled={refreshing} style={matchButtonStyle}>
            {refreshing ? 'Checking…' : 'Re-check Monday for updates'}
          </button>
        </div>
      )}
    </div>
  )
}

function JobCreateForm({
  clients,
  projects,
  venues,
  reloadVenues,
  roles,
  prefill,
  editingJob,
  embedded,
  onCancel,
  onCreated,
}: {
  clients: Client[]
  projects: Project[]
  venues: Venue[]
  // Testing feedback item C: a scheduler could only add a new venue via
  // Core's own admin, not from Job creation/editing. reload lets a venue
  // created inline here (see VenueOptionOrCreate below) show up for the
  // next Job form too, not just be merged into this one's own options.
  reloadVenues: () => void
  roles: Role[]
  prefill?: JobCreatePrefill
  // When set, the form edits this Job instead of creating a new one — see
  // Job Fetch-from-Monday Stage A's requirement 5 ("reusable... not just at
  // creation"). Deliberately scoped to the Job's own core fields
  // (name/client/dates/reference/contract link): requirements and
  // production contacts stay create-only here, unrelated to this task and
  // already manageable from Planner/the job detail view.
  editingJob?: Job
  // embedded — testing feedback: "Edit" used to swap the whole Jobs detail
  // panel for this form, hiding Crewing-by-role/Add role/Assign a vehicle,
  // which confused people into thinking those lived somewhere else. When
  // true, this renders just the field/button content (no outer page
  // padding, no "Edit job" title) so JobsContent can drop it inline into
  // the same panel instead of replacing it. Only ever used with
  // editingJob set — the "New job" creation flow is unaffected and still
  // gets the full standalone page.
  embedded?: boolean
  onCancel: () => void
  onCreated: (jobId: string) => void
}) {
  const [name, setName] = useState(editingJob?.name ?? prefill?.name ?? '')
  const [clientId, setClientId] = useState(editingJob?.client_id ?? prefill?.client_id ?? '')
  const [projectId, setProjectId] = useState(editingJob?.project_id ?? '')
  const [venueId, setVenueId] = useState(editingJob?.venue_id ?? '')
  const [venueSelectValue, setVenueSelectValue] = useState(editingJob?.venue_id ?? '')
  // Testing feedback item J — live Core Locations, same "pickers always go
  // live" pattern as ClientMatchPanel/ContractPicker. Selecting one calls
  // linkCoreVenue to resolve/create the local mirror row venue_id needs.
  const [coreLocations, setCoreLocations] = useState<CoreLocation[]>([])
  const [coreLocationsError, setCoreLocationsError] = useState<string | undefined>(undefined)
  const [venueLinking, setVenueLinking] = useState(false)
  // Testing feedback item C — inline "create a new venue" state, same
  // create-then-select shape as the Monday-fetch Client flow's
  // matchedLocalClient (see clientOptions below). Item J upgraded this to
  // create in Core first (so it's visible to other products too), falling
  // back to the local-only path if Core's owner-gated /locations rejects
  // a non-owner scheduler (see saveNewVenue).
  const [addingVenue, setAddingVenue] = useState(false)
  const [newVenueName, setNewVenueName] = useState('')
  const [newVenueCity, setNewVenueCity] = useState('')
  const [createdVenue, setCreatedVenue] = useState<Venue | undefined>(undefined)
  const [venueSaving, setVenueSaving] = useState(false)
  const [venueError, setVenueError] = useState<string | undefined>(undefined)
  const [projectReference, setProjectReference] = useState(editingJob?.project_reference ?? '')
  const [startDate, setStartDate] = useState(editingJob?.start_date ?? prefill?.start_date ?? todayISO())
  const [endDate, setEndDate] = useState(editingJob?.end_date ?? prefill?.end_date ?? prefill?.start_date ?? todayISO())
  // Converting a ProspectiveEvent defaults to Pencil — addendum v2 §4's
  // one exception to Job.commitment's usual Firm default.
  const [commitment, setCommitment] = useState<JobCommitment>(editingJob?.commitment ?? (prefill?.fromProspectiveEventId ? 'pencil' : 'firm'))
  const [notes, setNotes] = useState(editingJob?.notes ?? '')
  const [requirements, setRequirements] = useState<DraftRequirement[]>([])
  const [contacts, setContacts] = useState<DraftContact[]>([])
  const [nextKey, setNextKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // --- Job "Fetch from Monday", Stage A + shared Core Job entity ---
  const [orderNumber, setOrderNumber] = useState(editingJob?.order_number ?? '')
  const [mondayFetching, setMondayFetching] = useState(false)
  const [mondayError, setMondayError] = useState<string | undefined>(undefined)
  const [mondayResult, setMondayResult] = useState<MondayProjectLookup | undefined>(undefined)
  const [matchedLocalClient, setMatchedLocalClient] = useState<Client | undefined>(undefined)
  const [matchedCoreClientId, setMatchedCoreClientId] = useState<string | undefined>(undefined)
  const [sharedContractId, setSharedContractId] = useState(editingJob?.shared_contract_id)
  const [sharedContractName, setSharedContractName] = useState(editingJob?.shared_contract_name)
  // sharedJobId links to Core's shared Job entity — set either by finding
  // an existing one (FoundJobPanel's "Use this job") or, on submit, by
  // creating a new one after a fresh Monday fetch + Client confirm. See
  // Core's own migrations/0008_jobs.sql.
  const [sharedJobId, setSharedJobId] = useState(editingJob?.shared_job_id)
  const [foundCoreJob, setFoundCoreJob] = useState<CoreJob | undefined>(undefined)

  // Checks Core first — order_number is a real, exact, unique identifier
  // (Monday's own item name), unlike Client name matching, so this needs
  // no fuzzy logic or confirmation to match. Found: show what was found
  // and wait for an explicit "Use this job" (FoundJobPanel) before
  // touching any field — never silently adopt it. Not found: fall through
  // to the existing Monday-fetch + Client match/Contract-picker flow,
  // unchanged from Stage A.
  async function fetchFromMonday() {
    const trimmed = orderNumber.trim()
    if (!trimmed) {
      setMondayError('Enter an order number first.')
      return
    }
    setMondayFetching(true)
    setMondayError(undefined)
    setMondayResult(undefined)
    setFoundCoreJob(undefined)
    // A fresh fetch always needs a fresh match — clear whatever a
    // previous fetch (or the existing Job, in edit mode) had resolved,
    // never silently keep an old Client/Contract/Job link against new data.
    setMatchedLocalClient(undefined)
    setMatchedCoreClientId(undefined)
    setSharedContractId(undefined)
    setSharedContractName(undefined)
    setSharedJobId(undefined)
    try {
      const existing = await getCoreJobByOrderNumber(trimmed)
      setFoundCoreJob(existing)
    } catch {
      // 404 (no shared Job yet) or Core's lookup itself failing
      // (unreachable, etc.) both fall through to Monday directly the
      // same way — don't block on Core being reachable, same graceful-
      // degradation rule as everywhere else this flow reads from Core
      // (docs/simplified_suite_core_v0_6.md §5a).
      try {
        const result = await fetchMondayProjectLookup(trimmed)
        setMondayResult(result)
        setName(result.name)
        if (result.start_date) setStartDate(result.start_date)
        if (result.end_date) setEndDate(result.end_date)
        if (result.client_reference) setProjectReference(result.client_reference)
      } catch (mondayErr) {
        setMondayError(mondayErr instanceof ApiError ? mondayErr.message : 'Could not reach Monday — enter project details manually.')
      }
    } finally {
      setMondayFetching(false)
    }
  }

  // "Use this job" — the one explicit confirm step for an already-found
  // shared Job. Resolves the local Ralto client mirror the same way
  // Stage A already does (idempotent find-or-create), but skips the
  // match/confirm UI entirely: the order-number match itself already
  // pinned an exact Job, and its Client was already confirmed by
  // whichever product fetched it first.
  async function useFoundJob(job: CoreJob) {
    setName(job.name)
    if (job.date_start) setStartDate(job.date_start)
    if (job.date_end) setEndDate(job.date_end)
    if (job.client_reference) setProjectReference(job.client_reference)
    setSharedJobId(job.id)
    setSharedContractId(job.contract_id)
    setSharedContractName(job.contract_name)
    try {
      const local = await linkCoreClient({ core_client_id: job.client_id, name: job.client_name })
      setMatchedLocalClient(local)
      setClientId(local.id)
      setMatchedCoreClientId(job.client_id)
    } catch {
      setMondayError('Found the job but could not resolve its client locally — pick the client manually below.')
    }
  }

  // Client options for the plain dropdown below always include whichever
  // client the Monday-match flow just resolved, even if it was only just
  // created and isn't in the parent's (possibly stale) `clients` list yet.
  const clientOptions = useMemo(() => {
    if (!matchedLocalClient || clients.some((c) => c.id === matchedLocalClient.id)) return clients
    return [...clients, matchedLocalClient]
  }, [clients, matchedLocalClient])

  // Testing feedback item J: live per §5a's picker rule, same pattern as
  // ClientMatchPanel/ContractPicker. Core's /api/locations group is
  // entirely RequireOwner-gated (unlike /api/clients), so a non-owner
  // scheduler's session gets a 403 here — that's surfaced as a message,
  // and the picker falls back to whatever local venues are already known
  // (the 3 legacy rows plus any already Core-linked from a prior session).
  useEffect(() => {
    let cancelled = false
    listCoreLocations()
      .then((list) => {
        if (!cancelled) setCoreLocations(list)
      })
      .catch((err) => {
        if (cancelled) return
        setCoreLocationsError(
          err instanceof ApiError && err.status === 403
            ? 'Only a Simplified Suite Core organisation owner can browse Locations live — showing previously used venues only.'
            : 'Could not reach Simplified Suite Core — showing previously used venues only.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Same shape as clientOptions, for a venue just created/linked inline.
  // Core locations already mirrored locally (core_location_id set on an
  // existing venue) are excluded from the live list so each Location
  // appears exactly once, under its local (linkable) id.
  const venueOptions = useMemo(() => {
    const local = !createdVenue || venues.some((v) => v.id === createdVenue.id) ? venues : [...venues, createdVenue]
    const linkedCoreIds = new Set(local.map((v) => v.core_location_id).filter((id): id is string => Boolean(id)))
    const liveCore = coreLocations.filter((c) => !linkedCoreIds.has(c.id))
    return { local, liveCore }
  }, [venues, createdVenue, coreLocations])

  // Selecting an already-mirrored local venue just picks its id directly.
  // Selecting a live Core location (value `core:<id>`) resolves/creates
  // the local mirror row via linkCoreVenue first — venue_id (the FK Jobs
  // actually store) has to point at a local row either way.
  async function handleVenueSelect(value: string) {
    setVenueSelectValue(value)
    if (!value) {
      setVenueId('')
      return
    }
    if (!value.startsWith('core:')) {
      setVenueId(value)
      return
    }
    const core = coreLocations.find((c) => c.id === value.slice('core:'.length))
    if (!core) return
    setVenueLinking(true)
    setVenueError(undefined)
    try {
      const local = await linkCoreVenue({ core_location_id: core.id, name: core.name, address: core.address, timezone: core.timezone })
      setCreatedVenue(local)
      setVenueId(local.id)
      setVenueSelectValue(local.id)
    } catch {
      setVenueError('Could not link that location — try again.')
      setVenueSelectValue(venueId)
    } finally {
      setVenueLinking(false)
    }
  }

  async function saveNewVenue() {
    if (!newVenueName.trim()) {
      setVenueError('Name is required.')
      return
    }
    setVenueSaving(true)
    setVenueError(undefined)
    try {
      // Create in Core first so the new Location is visible to every
      // product going forward, then link the local mirror row — same
      // create-then-link shape as ClientMatchPanel's createAndConfirm.
      const core = await createCoreLocation({ name: newVenueName.trim() })
      const venue = await linkCoreVenue({ core_location_id: core.id, name: core.name, address: core.address, timezone: core.timezone })
      setCreatedVenue(venue)
      setVenueId(venue.id)
      setVenueSelectValue(venue.id)
      reloadVenues()
      setAddingVenue(false)
      setNewVenueName('')
      setNewVenueCity('')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        // Non-owner scheduler — Core's /locations group rejects the
        // create. Fall back to the pre-J local-only venue, same as before
        // this task, rather than blocking Job creation entirely.
        try {
          const venue = await createVenue({ name: newVenueName.trim(), city: newVenueCity.trim() || undefined, timezone: 'Europe/London' })
          setCreatedVenue(venue)
          setVenueId(venue.id)
          setVenueSelectValue(venue.id)
          reloadVenues()
          setAddingVenue(false)
          setNewVenueName('')
          setNewVenueCity('')
        } catch {
          setVenueError('Could not create that venue.')
        }
      } else {
        setVenueError('Could not create that venue.')
      }
    } finally {
      setVenueSaving(false)
    }
  }

  // The Contract picker is scoped to whichever Core Client the Job
  // actually resolves to — a fresh Monday match, or (editing an existing
  // Job, or picking manually) whichever client is already selected, if
  // that client itself has a Core link from a previous match.
  const selectedClient = clientOptions.find((c) => c.id === clientId)
  const coreClientIdForContracts = matchedCoreClientId ?? selectedClient?.core_client_id

  const inputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff', width: '100%', boxSizing: 'border-box' as const }
  const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }

  function addRequirement() {
    setRequirements((rows) => [...rows, { key: nextKey, role_id: '', quantity_required: '1', start_date: startDate, end_date: endDate }])
    setNextKey((k) => k + 1)
  }

  function updateRequirement(key: number, patch: Partial<DraftRequirement>) {
    setRequirements((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRequirement(key: number) {
    setRequirements((rows) => rows.filter((r) => r.key !== key))
  }

  function addContact() {
    setContacts((rows) => [...rows, { key: nextKey, name: '', role_title: '', email: '', phone: '' }])
    setNextKey((k) => k + 1)
  }

  function updateContact(key: number, patch: Partial<DraftContact>) {
    setContacts((rows) => rows.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  }

  function removeContact(key: number) {
    setContacts((rows) => rows.filter((c) => c.key !== key))
  }

  async function submit() {
    setError(undefined)
    if (!name || !clientId || !startDate || !endDate) {
      setError('Name, client, and dates are required.')
      return
    }
    for (const r of requirements) {
      if (!r.role_id || Number(r.quantity_required) < 1) {
        setError('Every role added needs a role and a quantity of at least 1.')
        return
      }
    }
    for (const c of contacts) {
      if (!c.name) {
        setError('Every contact added needs at least a name.')
        return
      }
    }

    setSaving(true)
    try {
      // If this came from a fresh Monday fetch that found no existing
      // shared Job (matchedCoreClientId set via ClientMatchPanel, not via
      // "Use this job"), create the shared Core Job now, right before
      // saving locally — so the next fetch of this order number, from
      // either product, finds it immediately. Non-fatal if it fails
      // (Core unreachable, or a rare race with another fetch of the exact
      // same brand-new order number): still save the local Job either way,
      // never block local creation on Core's shared entity succeeding.
      let finalSharedJobId = sharedJobId
      const trimmedOrderNumber = orderNumber.trim()
      if (!finalSharedJobId && matchedCoreClientId && trimmedOrderNumber) {
        try {
          const created = await createCoreJob({
            order_number: trimmedOrderNumber,
            name,
            client_id: matchedCoreClientId,
            contract_id: sharedContractId,
            date_start: startDate,
            date_end: endDate,
            client_reference: projectReference || undefined,
            delivery_address: mondayResult?.delivery_address,
          })
          finalSharedJobId = created.id
        } catch {
          // See comment above — proceed without a shared Job link.
        }
      }

      const payload = {
        name,
        client_id: clientId,
        project_id: projectId || undefined,
        venue_id: venueId || undefined,
        project_reference: projectReference || undefined,
        shared_contract_id: sharedContractId,
        shared_contract_name: sharedContractId ? sharedContractName : undefined,
        shared_job_id: finalSharedJobId,
        order_number: finalSharedJobId ? trimmedOrderNumber || undefined : undefined,
        start_date: startDate,
        end_date: endDate,
        status: editingJob?.status ?? ('draft' as const),
        commitment,
        notes: notes || undefined,
      }

      if (editingJob) {
        const job = await updateJob(editingJob.id, payload)
        onCreated(job.id)
        return
      }

      const job = await createJob(payload)
      await Promise.all(
        requirements.map((r) =>
          createJobRequirement(job.id, {
            role_id: r.role_id,
            quantity_required: Number(r.quantity_required),
            start_date: r.start_date,
            end_date: r.end_date,
          }),
        ),
      )
      await Promise.all(
        contacts.map((c) =>
          createJobContact(job.id, {
            name: c.name,
            role_title: c.role_title || undefined,
            email: c.email || undefined,
            phone: c.phone || undefined,
          }),
        ),
      )
      if (prefill?.fromProspectiveEventId) {
        await convertProspectiveEvent(prefill.fromProspectiveEventId, job.id)
      }
      onCreated(job.id)
    } catch {
      setError(`Could not ${editingJob ? 'save' : 'create'} that job — check the fields and try again.`)
      setSaving(false)
    }
  }

  const content = (
    <>
      {prefill?.fromProspectiveEventId && (
        <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--primary-soft)', fontStyle: 'italic', marginBottom: 16 }}>
          Converting from a prospective event — commitment defaults to Pencil.
        </div>
      )}

      <div style={{ maxWidth: embedded ? undefined : 640, display: 'flex', flexDirection: 'column', gap: 14, marginTop: embedded ? 0 : prefill?.fromProspectiveEventId ? 0 : 16 }}>
        <div style={{ border: '1px dashed var(--primary-soft)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)' }}>Fetch from Monday</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="Order number, e.g. 5376-06"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={fetchFromMonday} disabled={mondayFetching} style={{ ...matchPrimaryButtonStyle, whiteSpace: 'nowrap', opacity: mondayFetching ? 0.7 : 1 }}>
              <RefreshCw size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
              {mondayFetching ? 'Fetching…' : 'Fetch from Monday'}
            </button>
          </div>
          {mondayError && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{mondayError}</div>}
          {mondayResult && (
            <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)' }}>
              Applied name{mondayResult.start_date ? ', dates' : ''}{mondayResult.client_reference ? ', reference' : ''} from Monday.
              {mondayResult.delivery_address && (
                <div style={{ marginTop: 4 }}>Delivery address (from Monday, not saved on this job): {mondayResult.delivery_address}</div>
              )}
            </div>
          )}
        </div>

        {foundCoreJob && <FoundJobPanel key={foundCoreJob.id} job={foundCoreJob} onUse={useFoundJob} />}

        {mondayResult?.client && (
          <ClientMatchPanel
            key={mondayResult.client}
            fetchedName={mondayResult.client}
            onResolved={(local, core) => {
              setMatchedLocalClient(local)
              setClientId(local.id)
              setMatchedCoreClientId(core.id)
            }}
          />
        )}

        <label style={labelStyle}>
          Job name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. UFC 327 — Las Vegas" style={inputStyle} />
        </label>

        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Client
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value)
                // Manually picking a different client invalidates whatever
                // Monday match/shared Job this was resolved from — never
                // keep a stale Contract/Job link pointed at the old client.
                setMatchedCoreClientId(undefined)
                setSharedContractId(undefined)
                setSharedContractName(undefined)
                setSharedJobId(undefined)
              }}
              style={inputStyle}
            >
              <option value="">Select a client…</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Project (optional)
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inputStyle}>
              <option value="">No project — standalone job</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Start date
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            End date
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Venue (optional)
            {!addingVenue ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    value={venueSelectValue}
                    onChange={(e) => handleVenueSelect(e.target.value)}
                    disabled={venueLinking}
                    style={{ ...inputStyle, flex: 1, opacity: venueLinking ? 0.7 : 1 }}
                  >
                    <option value="">Not set</option>
                    {venueOptions.liveCore.length > 0 && (
                      <optgroup label="Locations (Simplified Suite)">
                        {venueOptions.liveCore.map((c) => (
                          <option key={`core:${c.id}`} value={`core:${c.id}`}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {venueOptions.local.length > 0 && (
                      <optgroup label="Previously used">
                        {venueOptions.local.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {/* Testing feedback item J: the venue picker now reads
                      Core's own Locations live (same "pickers always go
                      live" rule Client already followed) — selecting one
                      resolves/creates the local mirror row venue_id
                      actually points at. This "+" still exists for the
                      no-match case, now creating in Core first too (see
                      saveNewVenue). */}
                  <button
                    type="button"
                    onClick={() => setAddingVenue(true)}
                    title="Add a new venue"
                    style={{ flexShrink: 0, border: '1px dashed var(--primary-soft)', background: '#fff', color: 'var(--primary-soft)', borderRadius: 8, padding: '0 10px', cursor: 'pointer' }}
                  >
                  <Plus size={13} />
                  </button>
                </div>
                {venueLinking && <div style={{ fontFamily: 'var(--font)', fontSize: 11, color: 'var(--ink-muted)' }}>Linking…</div>}
                {venueError && <div style={{ fontFamily: 'var(--font)', fontSize: 11, color: 'var(--danger)' }}>{venueError}</div>}
                {coreLocationsError && <div style={{ fontFamily: 'var(--font)', fontSize: 11, color: 'var(--ink-muted)' }}>{coreLocationsError}</div>}
              </div>
            ) : (
              <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input value={newVenueName} onChange={(e) => setNewVenueName(e.target.value)} placeholder="Venue name" style={inputStyle} />
                <input value={newVenueCity} onChange={(e) => setNewVenueCity(e.target.value)} placeholder="City (optional)" style={inputStyle} />
                {venueError && <div style={{ fontFamily: 'var(--font)', fontSize: 11, color: 'var(--danger)' }}>{venueError}</div>}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddingVenue(false)
                      setVenueError(undefined)
                    }}
                    style={{ flex: 1, border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 0', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={saveNewVenue}
                    disabled={venueSaving}
                    style={{ flex: 1, border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '6px 0', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: venueSaving ? 0.7 : 1 }}
                  >
                    {venueSaving ? 'Adding…' : 'Add venue'}
                  </button>
                </div>
              </div>
            )}
          </label>
        </div>

        <label style={labelStyle}>
          Reference (optional)
          <input value={projectReference} onChange={(e) => setProjectReference(e.target.value)} placeholder="e.g. their PO / job number" style={inputStyle} />
        </label>

        {coreClientIdForContracts && (
          <ContractPicker
            key={coreClientIdForContracts}
            coreClientId={coreClientIdForContracts}
            value={sharedContractId ? { id: sharedContractId, name: sharedContractName ?? '' } : undefined}
            onChange={(c) => {
              setSharedContractId(c?.id)
              setSharedContractName(c?.name)
            }}
          />
        )}

        <label style={labelStyle}>
          Commitment
          <div style={{ display: 'flex', gap: 8 }}>
            {/* Testing feedback item D: this used to render the raw
                JobCommitment enum value ("firm"/"pencil") — same class of
                bug as the job tag once leaking raw Job.status. Labels now
                match the 4-tag vocabulary (jobStatusTag) exactly:
                Booked/Pencilled, not Firm/Pencil. */}
            {(
              [
                { value: 'firm' as const, label: 'Booked' },
                { value: 'pencil' as const, label: 'Pencilled' },
              ]
            ).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setCommitment(value)}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '8px 0',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'var(--font)',
                  fontWeight: 600,
                  fontSize: 13,
                  border: commitment === value ? '1px solid var(--primary-soft)' : '1px solid var(--line)',
                  background: commitment === value ? 'var(--primary-tint)' : '#fff',
                  color: commitment === value ? 'var(--primary-soft)' : 'var(--ink-muted)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </label>

        <label style={labelStyle}>
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font)' }} />
        </label>

        {editingJob && (
          <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', fontStyle: 'italic' }}>
            Roles and production contacts aren't editable here — manage them from Planner or the job detail view.
          </div>
        )}

        {!editingJob && (
        <>
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Roles</span>
            <button
              onClick={addRequirement}
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px dashed var(--primary-soft)', background: '#fff', color: 'var(--primary-soft)', borderRadius: 8, padding: '5px 10px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
            >
              <Plus size={12} /> Add role
            </button>
          </div>
          {requirements.length === 0 && (
            <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>
              No roles yet — the job can be saved without any, but nothing will be crewable in Planner until at least one is added (here, since Planner can't add roles to a job itself).
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {requirements.map((r) => (
              <div key={r.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <label style={{ ...labelStyle, flex: 1.4 }}>
                  Role
                  <select value={r.role_id} onChange={(e) => updateRequirement(r.key, { role_id: e.target.value })} style={inputStyle}>
                    <option value="">Select…</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ ...labelStyle, flex: 0.7 }}>
                  Qty
                  <input type="number" min={1} value={r.quantity_required} onChange={(e) => updateRequirement(r.key, { quantity_required: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, flex: 1 }}>
                  Start
                  <input type="date" value={r.start_date} onChange={(e) => updateRequirement(r.key, { start_date: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, flex: 1 }}>
                  End
                  <input type="date" value={r.end_date} onChange={(e) => updateRequirement(r.key, { end_date: e.target.value })} style={inputStyle} />
                </label>
                <button onClick={() => removeRequirement(r.key)} title="Remove role" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '8px 2px' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, color: 'var(--ink)' }}>Production contacts</span>
            <button
              onClick={addContact}
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px dashed var(--primary-soft)', background: '#fff', color: 'var(--primary-soft)', borderRadius: 8, padding: '5px 10px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
            >
              <Plus size={12} /> Add contact
            </button>
          </div>
          {contacts.length === 0 && (
            <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>
              Optional — on-site production contacts, distinct from the client's own contact on file.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.map((c) => (
              <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
                <label style={{ ...labelStyle, flex: 1.2 }}>
                  Name
                  <input value={c.name} onChange={(e) => updateContact(c.key, { name: e.target.value })} placeholder="e.g. Jordan Blake" style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, flex: 1 }}>
                  Role
                  <input value={c.role_title} onChange={(e) => updateContact(c.key, { role_title: e.target.value })} placeholder="e.g. Production Manager" style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, flex: 1.2 }}>
                  Email
                  <input value={c.email} onChange={(e) => updateContact(c.key, { email: e.target.value })} style={inputStyle} />
                </label>
                <label style={{ ...labelStyle, flex: 1 }}>
                  Phone
                  <input value={c.phone} onChange={(e) => updateContact(c.key, { phone: e.target.value })} style={inputStyle} />
                </label>
                <button onClick={() => removeContact(c.key)} title="Remove contact" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: '8px 2px' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
        </>
        )}

        {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onCancel} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '9px 16px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '9px 18px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? (editingJob ? 'Saving…' : 'Creating…') : editingJob ? 'Save changes' : 'Create job'}
          </button>
        </div>
      </div>
    </>
  )

  if (embedded) {
    return content
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 22, color: 'var(--ink)' }}>{editingJob ? 'Edit job' : 'New job'}</div>
      </div>
      {content}
    </div>
  )
}

// AddRoleRequirementRow — the "add a role requirement" action JobCreateForm
// itself points at ("...manage them from Planner or the job detail view")
// but never actually built here. Deliberately lives on the Job detail
// panel (JobsContent), not inside JobCreateForm's edit mode — same backend
// endpoint (createJobRequirement) and the same fields as the create-time
// version, just scoped to one job already on screen instead of a batch of
// draft rows.
function AddRoleRequirementRow({
  jobId,
  jobStartDate,
  jobEndDate,
  roles,
  existingRequirements,
  onAdded,
}: {
  jobId: string
  jobStartDate: string
  jobEndDate: string
  roles: Role[]
  // Testing feedback item F: adding a role that already had a requirement
  // on this job used to always POST a brand-new job_requirements row
  // instead of bumping the existing one's quantity — MCFC v Sunderland
  // ended up with two separate "Camera Op" rows. Needed to detect that.
  existingRequirements: JobRequirementWithCounts[]
  onAdded: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [roleId, setRoleId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [startDate, setStartDate] = useState(jobStartDate)
  const [endDate, setEndDate] = useState(jobEndDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const inputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)', background: '#fff' }
  const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontFamily: 'var(--font)', fontSize: 11, color: 'var(--ink-muted)' }

  async function submit() {
    if (!roleId) {
      setError('Select a role.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const existing = existingRequirements.find((r) => r.role_id === roleId)
      if (existing) {
        // Same role already has a requirement on this job — increase its
        // quantity_required rather than creating a second, separate row.
        // Deliberately keeps the EXISTING requirement's own dates/call
        // time/notes untouched (only quantity changes) rather than
        // silently overwriting them with whatever was just typed into
        // this "add" form's own date fields.
        await updateJobRequirement(existing.id, {
          role_id: existing.role_id,
          quantity_required: existing.quantity_required + (Number(quantity) || 1),
          start_date: existing.start_date,
          end_date: existing.end_date,
          call_time: existing.call_time,
          notes: existing.notes,
        })
      } else {
        await createJobRequirement(jobId, { role_id: roleId, quantity_required: Number(quantity) || 1, start_date: startDate, end_date: endDate })
      }
      setAdding(false)
      setRoleId('')
      setQuantity('1')
      setStartDate(jobStartDate)
      setEndDate(jobEndDate)
      onAdded()
    } catch {
      setError('Could not add that role.')
    } finally {
      setSaving(false)
    }
  }

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, border: '1px dashed var(--primary-soft)', background: '#fff', color: 'var(--primary-soft)', borderRadius: 8, padding: '8px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
      >
        <Plus size={12} /> Add role
      </button>
    )
  }

  const matchingExisting = existingRequirements.find((r) => r.role_id === roleId)

  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <label style={{ ...labelStyle, flex: 1.4 }}>
          Role
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={inputStyle}>
            <option value="">Select…</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...labelStyle, flex: 0.6 }}>
          Qty
          <input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Start
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={!!matchingExisting} style={{ ...inputStyle, opacity: matchingExisting ? 0.5 : 1 }} />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          End
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={!!matchingExisting} style={{ ...inputStyle, opacity: matchingExisting ? 0.5 : 1 }} />
        </label>
        <button onClick={submit} disabled={saving} style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Adding…' : matchingExisting ? `Add ${quantity || 1} more` : 'Add'}
        </button>
        <button onClick={() => setAdding(false)} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '7px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}>
          Cancel
        </button>
      </div>
      {matchingExisting && (
        <div style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>
          {matchingExisting.role_name} already has {matchingExisting.quantity_required} on this job — this adds to that instead of creating a second entry.
        </div>
      )}
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}

// JobVehiclesSection — testing feedback item G: assigning one or more
// fleet Vehicles to a Job, shown small/unobtrusive on the Job detail
// panel per the ask ("doesn't need to be prominent"). Deliberately shown
// here rather than on every row of the compact left-hand Jobs list, which
// would need an extra fetch per row just to render a small icon; this is
// still "the Jobs tab" the feedback asked for.
function JobVehiclesSection({ jobId, vehiclesList }: { jobId: string; vehiclesList: Vehicle[] }) {
  const [assigned, setAssigned] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [pickId, setPickId] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    listJobVehicles(jobId)
      .then(setAssigned)
      .finally(() => setLoading(false))
  }, [jobId])

  useEffect(() => {
    reload()
  }, [reload])

  const assignedIds = new Set(assigned.map((v) => v.id))
  const available = vehiclesList.filter((v) => !assignedIds.has(v.id))

  async function assign() {
    if (!pickId) return
    setBusy(true)
    try {
      await assignVehicleToJob(jobId, pickId)
      setPickId('')
      setAdding(false)
      reload()
    } finally {
      setBusy(false)
    }
  }

  async function unassign(vehicleId: string) {
    setBusy(true)
    try {
      await unassignVehicleFromJob(jobId, vehicleId)
      reload()
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null
  // No assigned vehicles and nothing being added: stay fully out of the
  // way rather than showing an empty-state block for the common case of a
  // job with no vehicle — the ask was "no broken empty state", and the
  // quietest correct answer is simply not rendering anything extra.
  if (!adding && assigned.length === 0) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => setAdding(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--ink-muted)', padding: 0, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
        >
          <Plus size={12} /> Assign a vehicle
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink-muted)' }}>Vehicles</span>
        {!adding && available.length > 0 && (
          <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: 'var(--primary-soft)', padding: 0, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            <Plus size={12} /> Assign
          </button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {assigned.map((v) => (
          <span key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', borderRadius: 999, padding: '4px 6px 4px 10px', fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink)' }}>
            {v.name} · {v.registration}
            <button onClick={() => unassign(v.id)} disabled={busy} title="Unassign" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-muted)', padding: 2, display: 'flex' }}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      {adding && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px', fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)', background: '#fff' }}
          >
            <option value="">Select a vehicle…</option>
            {available.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {v.registration}
              </option>
            ))}
          </select>
          <button onClick={assign} disabled={busy || !pickId} style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: busy || !pickId ? 0.7 : 1 }}>
            Add
          </button>
          <button onClick={() => { setAdding(false); setPickId('') }} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

function JobsContent({
  summaries,
  clients,
  venues,
  venuesList,
  reloadVenues,
  projects,
  roles,
  vehiclesList,
  selectedId,
  onSelect,
  reloadSummaries,
  reloadClients,
  prefill,
  onConsumedPrefill,
  onOpenRoleInPlanner,
}: {
  summaries: JobSummary[]
  clients: Record<string, Client>
  venues: Record<string, unknown>
  venuesList: Venue[]
  reloadVenues: () => void
  projects: Project[]
  roles: Role[]
  vehiclesList: Vehicle[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  reloadSummaries: () => void
  // Fetch-from-Monday's "create new client" path adds a local client mid-
  // flow that the app's own top-level client list (fetched once) wouldn't
  // otherwise know about until a full reload — refresh it whenever a Job
  // create/edit completes, cheap and always safe to call.
  reloadClients: () => void
  prefill?: JobCreatePrefill
  onConsumedPrefill: () => void
  onOpenRoleInPlanner: (jobId: string, reqId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [contacts, setContacts] = useState<JobContact[]>([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [bookingsByReq, setBookingsByReq] = useState<Record<string, Booking[]>>({})
  const [confirmEveryoneState, setConfirmEveryoneState] = useState<'idle' | 'confirming' | 'busy'>('idle')
  // Testing feedback item E — the two new terminal-status actions. One
  // shared piece of state (not two booleans) so confirming one can't
  // somehow overlap with confirming the other.
  const [statusAction, setStatusAction] = useState<'idle' | 'confirming-cancel' | 'confirming-complete' | 'busy'>('idle')

  useEffect(() => {
    if (prefill) setCreating(true)
  }, [prefill])

  // Testing feedback item E: Complete jobs move to the Archive tab and
  // drop out of the active Jobs list — filtered here (not in
  // useJobSummaries itself) since Planner needs the same exclusion and
  // Archive needs the opposite, and all three already share this one
  // summaries fetch.
  const activeSummaries = useMemo(() => summaries.filter((s) => s.job.status !== 'complete'), [summaries])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return activeSummaries.filter((s) => s.job.name.toLowerCase().includes(q) || (clients[s.job.client_id]?.name ?? '').toLowerCase().includes(q))
  }, [activeSummaries, clients, query])

  // Deliberately from activeSummaries, not filtered — selection stays put
  // while someone types a search that would otherwise hide the open job
  // from the list (unchanged existing behaviour); only completing a job
  // actually clears it out from under them.
  const selected = activeSummaries.find((s) => s.job.id === selectedId) ?? activeSummaries[0]

  useEffect(() => {
    if (!selected) return
    api.get<JobContact[]>(`/jobs/${selected.job.id}/contacts`).then(setContacts).catch(() => setContacts([]))
  }, [selected?.job.id])

  // Switching to a different Job in the sidebar while mid-edit exits edit
  // mode rather than leaving a form open against a Job that's no longer
  // the one on screen — Edit is now inline within this same panel (see
  // testing feedback: it used to replace the whole panel, hiding Crewing
  // by role/Add role/Assign a vehicle), so the sidebar stays clickable
  // during an edit in a way it previously couldn't be.
  useEffect(() => {
    setEditing(false)
  }, [selected?.job.id])

  // Bookings-with-names for every role on the selected job, fetched once
  // per role (bounded by role count, not headcount — not the per-person
  // N+1 CrewContent was built to avoid) so JobRoleRow can show real names
  // and "Confirm everyone" can act on all of them at once. Re-runs
  // whenever summaries reload (selected.requirements gets a fresh array
  // reference), so a cancel/confirm/pencil/offer anywhere keeps this in
  // sync without a separate explicit refetch at each call site.
  const reloadBookings = useCallback(async (reqs: JobRequirementWithCounts[]) => {
    const entries = await Promise.all(reqs.map(async (r) => [r.id, await listBookingsForRequirement(r.id)] as const))
    setBookingsByReq(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    if (!selected) return
    reloadBookings(selected.requirements)
  }, [selected?.job.id, selected?.requirements, reloadBookings])

  async function handleConfirmBooking(bookingId: string) {
    await confirmBooking(bookingId)
    reloadSummaries()
  }

  async function handleCancelBooking(bookingId: string) {
    await cancelBooking(bookingId)
    reloadSummaries()
  }

  // Testing feedback item F — see JobRoleRow's own confirm step for the
  // cascade-delete warning; this just performs the delete once confirmed.
  async function handleDeleteRequirement(req: JobRequirementWithCounts) {
    await deleteJobRequirement(req.id)
    reloadSummaries()
  }

  const pendingBookings = useMemo(
    () => (selected ? selected.requirements.flatMap((r) => (bookingsByReq[r.id] ?? []).filter((b) => b.status === 'pencilled' || b.status === 'offered')) : []),
    [selected, bookingsByReq],
  )

  async function confirmEveryoneNow() {
    setConfirmEveryoneState('busy')
    await Promise.all(pendingBookings.map((b) => confirmBooking(b.id)))
    reloadSummaries()
    setConfirmEveryoneState('idle')
  }

  // Testing feedback item E — Cancel/Complete both go through the same
  // dedicated status endpoint (see updateJobStatus), never the full
  // JobCreateForm edit path, so a status change here can't accidentally
  // touch any other field on the Job.
  async function setJobStatus(jobId: string, status: JobStatus) {
    setStatusAction('busy')
    try {
      await updateJobStatus(jobId, status)
      reloadSummaries()
    } finally {
      setStatusAction('idle')
    }
  }

  function finishCreating(jobId: string) {
    setCreating(false)
    if (prefill) onConsumedPrefill()
    reloadSummaries()
    reloadClients()
    onSelect(jobId)
  }

  function cancelCreating() {
    setCreating(false)
    if (prefill) onConsumedPrefill()
  }

  function finishEditing(jobId: string) {
    setEditing(false)
    reloadSummaries()
    reloadClients()
    onSelect(jobId)
  }

  if (creating) {
    return <JobCreateForm clients={Object.values(clients)} projects={projects} venues={venuesList} reloadVenues={reloadVenues} roles={roles} prefill={prefill} onCancel={cancelCreating} onCreated={finishCreating} />
  }

  if (!selected) {
    return (
      <div style={{ flex: 1, padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ fontFamily: 'var(--font)', color: 'var(--ink-muted)', fontSize: 13.5 }}>No jobs yet — create one to get started.</div>
        <button
          onClick={() => setCreating(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          <Plus size={13} /> New job
        </button>
      </div>
    )
  }

  const client = clients[selected.job.client_id]
  const venueName = selected.job.venue_id ? (venues[selected.job.venue_id] as { name: string } | undefined)?.name : undefined
  const primaryContact = contacts[0]

  return (
    <>
      <div style={{ width: 380, flexShrink: 0, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '24px 20px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 22, color: 'var(--ink)' }}>Jobs</div>
            <button
              onClick={() => setCreating(true)}
              title="New job"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              <Plus size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', background: '#fff' }}>
            <Search size={15} color="var(--ink-muted)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs or clients" style={{ border: 'none', outline: 'none', background: 'none', fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)', flex: 1 }} />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((s, i) => (
            <JobListRow key={s.job.id} summary={s} client={clients[s.job.client_id]} fallbackIndex={i} selected={s.job.id === selected.job.id} onOpen={onSelect} />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 36px' }}>
        <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>{client?.name ?? 'Unknown client'}</div>

        {!editing ? (
          <>
            <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 24, color: 'var(--ink)', marginTop: 2 }}>{selected.job.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              {/* Job-level tag is the derived 4-value vocabulary only
                  (Cancelled/Complete/Pencilled/Booked, see jobStatusTag) — the
                  raw Job.status lifecycle enum (draft..live, the "internal
                  progress" states) is a separate axis and must never render
                  here as a second, differently-coloured tag (it was leaking
                  "confirmed"/"crewing"/etc. verbatim via urgencyFor's tier color,
                  which is why testers saw "Confirmed" in several colours). */}
              <CommitmentBadge job={selected.job} />
              <button
                onClick={() => setEditing(true)}
                title="Edit job"
                style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-muted)', borderRadius: 999, padding: '5px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, cursor: 'pointer' }}
              >
                <Pencil size={11} /> Edit
              </button>
              {pendingBookings.length > 0 && confirmEveryoneState === 'idle' && (
                <button
                  onClick={() => setConfirmEveryoneState('confirming')}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 999, padding: '5px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, cursor: 'pointer' }}
                >
                  <Check size={11} /> Confirm everyone ({pendingBookings.length})
                </button>
              )}
              {/* Terminal-status actions — both statuses are dead ends once
                  set: a cancelled job can't be re-cancelled or marked
                  complete, and vice versa. No transition graph beyond that,
                  since nobody asked for one — just gate each button on
                  "neither terminal state is already set". */}
              {statusAction === 'idle' && selected.job.status !== 'cancelled' && (
                <button
                  onClick={() => setStatusAction('confirming-cancel')}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--danger)', background: '#fff', color: 'var(--danger)', borderRadius: 999, padding: '5px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, cursor: 'pointer' }}
                >
                  <X size={11} /> Cancel job
                </button>
              )}
              {statusAction === 'idle' && selected.job.status !== 'complete' && selected.job.status !== 'cancelled' && (
                <button
                  onClick={() => setStatusAction('confirming-complete')}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-muted)', borderRadius: 999, padding: '5px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, cursor: 'pointer' }}
                >
                  <CheckCircle2 size={11} /> Mark complete
                </button>
              )}
            </div>

            {confirmEveryoneState === 'confirming' && (
              <div style={{ border: '1px solid var(--danger)', background: 'var(--danger-bg)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>
                  Confirm all {pendingBookings.length} pencilled/offered {pendingBookings.length === 1 ? 'booking' : 'bookings'} on this job? Each person will get a real confirmation email.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setConfirmEveryoneState('idle')} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                    Cancel
                  </button>
                  <button
                    onClick={confirmEveryoneNow}
                    style={{ border: 'none', background: 'var(--danger)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    Yes, confirm all
                  </button>
                </div>
              </div>
            )}

            {statusAction === 'confirming-cancel' && (
              <div style={{ border: '1px solid var(--danger)', background: 'var(--danger-bg)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>Cancel this job? It'll stay visible on the Jobs list, tagged Cancelled.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStatusAction('idle')} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                    Never mind
                  </button>
                  <button
                    onClick={() => setJobStatus(selected.job.id, 'cancelled')}
                    style={{ border: 'none', background: 'var(--danger)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    Yes, cancel job
                  </button>
                </div>
              </div>
            )}

            {statusAction === 'confirming-complete' && (
              <div style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>Mark this job Complete? It'll move to Archive and drop off the active Jobs list.</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStatusAction('idle')} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}>
                    Never mind
                  </button>
                  <button
                    onClick={() => setJobStatus(selected.job.id, 'complete')}
                    style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                  >
                    Yes, mark complete
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 32, marginTop: 8, borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
              <InfoRow icon={CalendarDays} label="Dates" value={`${formatDate(selected.job.start_date)} – ${formatDate(selected.job.end_date)}`} />
              <InfoRow icon={MapPin} label="Venue" value={venueName ?? 'Not set'} />
              <InfoRow icon={Phone} label="Production contact" value={primaryContact ? `${primaryContact.name}${primaryContact.phone ? ' · ' + primaryContact.phone : ''}` : 'Not yet assigned'} />
              {/* Only shown for Jobs actually linked to a shared Core Job (i.e.
                  fetched from Monday) — hand-created Jobs have no order_number
                  to show, per testing feedback item C. */}
              {selected.job.shared_job_id && selected.job.order_number && <InfoRow icon={LinkIcon} label="Monday ref" value={selected.job.order_number} />}
            </div>
          </>
        ) : (
          // Testing feedback: "Edit" used to open a completely separate
          // form, hiding Crewing by role/Add role/Assign a vehicle below
          // it and confusing people into thinking those lived elsewhere.
          // Same JobCreateForm, same fields, same save/cancel behaviour —
          // just rendered inline (embedded) in this panel instead of
          // replacing it, so the rest of the panel stays exactly where it
          // was the whole time this is open.
          <div style={{ marginTop: 10, marginBottom: 20, maxWidth: 640 }}>
            <JobCreateForm
              key={selected.job.id}
              clients={Object.values(clients)}
              projects={projects}
              venues={venuesList}
              reloadVenues={reloadVenues}
              roles={roles}
              editingJob={selected.job}
              embedded
              onCancel={() => setEditing(false)}
              onCreated={finishEditing}
            />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '24px 0 12px' }}>
          <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)' }}>Crewing by role</span>
          <span style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>
            {selected.confirmed} confirmed{selected.pencilled > 0 ? ` · ${selected.pencilled} pencilled` : ''} · {selected.required} total
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {selected.requirements.map((r) => (
            <JobRoleRow
              key={r.id}
              req={r}
              bookings={bookingsByReq[r.id] ?? []}
              onOpenInPlanner={(req) => onOpenRoleInPlanner(req.job_id, req.id)}
              onConfirmBooking={handleConfirmBooking}
              onCancelBooking={handleCancelBooking}
              onDaysUpdated={() => reloadBookings(selected.requirements)}
              onDeleteRequirement={handleDeleteRequirement}
            />
          ))}
          {selected.requirements.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', gridColumn: '1 / -1' }}>No role requirements added yet.</div>}
          <AddRoleRequirementRow
            jobId={selected.job.id}
            jobStartDate={selected.job.start_date}
            jobEndDate={selected.job.end_date}
            roles={roles}
            existingRequirements={selected.requirements}
            onAdded={reloadSummaries}
          />
        </div>

        <JobVehiclesSection key={selected.job.id} jobId={selected.job.id} vehiclesList={vehiclesList} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

function completeness(reqs: JobRequirementWithCounts[]) {
  const required = reqs.reduce((s, r) => s + r.quantity_required, 0)
  const confirmed = reqs.reduce((s, r) => s + r.quantity_confirmed, 0)
  return { required, confirmed }
}

function JobChip({ summary, client, fallbackIndex, active, onClick }: { summary: JobSummary; client: Client | undefined; fallbackIndex: number; active: boolean; onClick: () => void }) {
  const { required, confirmed } = completeness(summary.requirements)
  const complete = confirmed === required && required > 0
  return (
    <button
      onClick={onClick}
      style={{ position: 'relative', background: active ? 'var(--primary-tint)' : '#fff', border: active ? '1px solid var(--primary-soft)' : '1px solid var(--line)', borderRadius: 12, padding: '10px 16px 10px 20px', textAlign: 'left', cursor: 'pointer', minWidth: 168, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: clientColor(client, fallbackIndex) }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{summary.job.name}</div>
        <CommitmentBadge job={summary.job} />
      </div>
      <div style={{ fontFamily: 'var(--font)', fontVariantNumeric: 'tabular-nums', fontSize: 12, marginTop: 3, color: complete ? 'var(--success)' : 'var(--attention)', fontWeight: 600 }}>
        {confirmed}/{required} confirmed
      </div>
    </button>
  )
}

function RequirementRow({ req, active, onOpen }: { req: JobRequirementWithCounts; active: boolean; onOpen: (req: JobRequirementWithCounts) => void }) {
  // stillNeeded (how many more to find) and roleComplete (does the tick
  // show) are deliberately separate: offered/pencilled people are spoken
  // for and correctly stop counting as "still needed," but a tick means
  // confirmed, not asked — offering the last open slot shouldn't turn it
  // green before they've replied.
  const stillNeeded = req.quantity_required - req.quantity_confirmed - req.quantity_pencilled - req.quantity_offered
  const roleComplete = req.quantity_confirmed >= req.quantity_required
  const pctConfirmed = req.quantity_required > 0 ? (req.quantity_confirmed / req.quantity_required) * 100 : 0
  const pctPencilled = req.quantity_required > 0 ? (req.quantity_pencilled / req.quantity_required) * 100 : 0
  const pctOffered = req.quantity_required > 0 ? (req.quantity_offered / req.quantity_required) * 100 : 0
  const StatusIcon = roleComplete ? CheckCircle2 : req.quantity_offered > 0 ? Clock : AlertTriangle
  const statusColor = roleComplete ? 'var(--success)' : 'var(--attention)'
  const statusBg = roleComplete ? 'var(--success-bg)' : 'var(--attention-bg)'
  const statusTitle = roleComplete ? 'Role fully confirmed' : req.quantity_offered > 0 ? 'Someone has been offered this role, not yet confirmed' : 'Nobody has been offered this role yet'

  return (
    <button
      onClick={() => onOpen(req)}
      style={{ width: '100%', textAlign: 'left', background: active ? 'var(--primary-tint)' : '#fff', border: active ? '1px solid var(--primary-soft)' : '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>{req.role_name}</span>
          <span style={{ fontFamily: 'var(--font)', fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: stillNeeded > 0 ? 'var(--attention)' : 'var(--ink-muted)', fontWeight: 600 }}>
            {req.quantity_confirmed}/{req.quantity_required}
          </span>
        </div>
        {/* Pencils never count as filled (addendum v2 §4) — a distinct
            hatched segment, not folded into the confirmed (solid) or
            offered (flat attention-colour) segments. */}
        <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'var(--track)', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${pctConfirmed}%`, background: 'var(--success)' }} />
          <div
            style={{
              width: `${pctPencilled}%`,
              background: `repeating-linear-gradient(135deg, var(--primary-soft), var(--primary-soft) 2px, transparent 2px, transparent 4px)`,
            }}
          />
          <div style={{ width: `${pctOffered}%`, background: 'var(--attention)' }} />
        </div>
        {(stillNeeded > 0 || req.quantity_pencilled > 0) && (
          <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--attention)', marginTop: 6 }}>
            {stillNeeded > 0 ? `${stillNeeded} unfilled` : 'Fully held'}
            {req.quantity_pencilled > 0 ? ` · ${req.quantity_pencilled} pencilled` : ''}
            {req.quantity_offered > 0 ? ` · ${req.quantity_offered} offered` : ''}
          </div>
        )}
      </div>
      <div title={statusTitle} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: statusBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <StatusIcon size={12} color={statusColor} strokeWidth={2.5} />
      </div>
    </button>
  )
}

// "Already asked" — addendum v2 §5. Scoped to the whole Job (a decline on
// Camera still surfaces while crewing Utilities on the same job), so this
// carries whichever role the ask was against rather than assuming it's
// always the role currently being crewed.
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function AlreadyAskedRow({ entry, declined }: { entry: AlreadyAskedEntry; declined: boolean }) {
  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{entry.name}</div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>
        {entry.role_name ? `${entry.role_name} · ` : ''}
        {declined ? `Declined ${shortDate(entry.responded_at ?? entry.asked_at)}` : `Asked ${shortDate(entry.asked_at)} · awaiting response`}
      </div>
    </div>
  )
}

function CandidateGroup({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tone }} />
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink-muted)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function PlannerContent({
  summaries,
  clients,
  selectedJobId,
  onSelectJob,
  reloadSummaries,
  targetReqId,
  onConsumedTarget,
}: {
  summaries: JobSummary[]
  clients: Record<string, Client>
  selectedJobId: string | undefined
  onSelectJob: (id: string) => void
  reloadSummaries: () => void
  targetReqId?: string
  onConsumedTarget?: () => void
}) {
  // Testing feedback item E: Complete jobs move to Archive and are no
  // longer schedulable here — same exclusion as JobsContent's own
  // activeSummaries, applied independently since Planner gets its own
  // summaries prop rather than sharing JobsContent's derived value.
  const activeSummaries = useMemo(() => summaries.filter((s) => s.job.status !== 'complete'), [summaries])
  const summary = activeSummaries.find((s) => s.job.id === selectedJobId) ?? activeSummaries[0]
  const [activeReq, setActiveReq] = useState<JobRequirementWithCounts | undefined>(undefined)

  // Picks the default (first unfulfilled requirement) whenever the
  // selected job changes. Deliberately keyed only on the job, not on
  // targetReqId — see the second effect below for why that separation
  // matters.
  useEffect(() => {
    if (!summary) return
    setActiveReq(summary.requirements.find((r) => r.quantity_required - r.quantity_confirmed - r.quantity_pencilled - r.quantity_offered > 0) ?? summary.requirements[0])
  }, [summary?.job.id, summary?.requirements])

  // targetReqId is a one-shot override for the initial selection only —
  // same pattern as jobPrefill/onConsumedPrefill elsewhere in this file.
  // Consuming it (clearing plannerTargetReqId in the parent) causes
  // *another* render of this component with targetReqId now undefined —
  // if that render re-ran the same "pick a default" logic, it would
  // immediately stomp the target it had just applied. Keeping this as its
  // own effect with an early return when there's no target means that
  // follow-up render is a no-op here instead, and the effect above (keyed
  // only on the job) is what handles picking a default when the job
  // actually changes afterward.
  useEffect(() => {
    if (!targetReqId || !summary) return
    const target = summary.requirements.find((r) => r.id === targetReqId)
    if (target) setActiveReq(target)
    onConsumedTarget?.()
  }, [targetReqId, summary])

  const { data: pool, reload: reloadCandidates } = useCandidates(activeReq?.id)
  // Testing feedback item L — currently pencilled/offered/confirmed people
  // for the active requirement, with their day coverage. Planner already
  // has "Already asked" for awaiting-response/declined; this is the
  // "who's actually holding a slot right now" counterpart it was missing.
  const { data: currentBookings, reload: reloadCurrentBookings } = useBookingsForRequirement(activeReq?.id)

  // The optional second half of "Not available" — offered right after the
  // decline is recorded, since that's the moment the call's context (did
  // they say they're out all week?) is still fresh. Skippable: not every
  // decline comes with "and I'm out all week" attached, so this is just an
  // inline prompt, not a second required step.
  const [declinedFollowUp, setDeclinedFollowUp] = useState<{ personId: string; name: string; startDate: string; endDate: string } | undefined>(undefined)

  async function handleOffer(personId: string, status: 'offered' | 'pencilled' = 'offered') {
    if (!activeReq) return
    await offerBooking(activeReq.id, personId, activeReq.start_date, activeReq.end_date, activeReq.call_time, status)
    await Promise.all([reloadCandidates(), reloadSummaries(), reloadCurrentBookings()])
  }

  // "Not available" — a decline recorded straight from the phone call,
  // never a digital offer/respond round trip. Reuses CreateBooking with
  // status: 'declined' (no email, same as Pencil) so it lands in the same
  // Already Asked → Declined list a real digital decline would.
  async function handleNotAvailable(personId: string, name: string) {
    if (!activeReq) return
    const { start_date: startDate, end_date: endDate } = activeReq
    await offerBooking(activeReq.id, personId, startDate, endDate, activeReq.call_time, 'declined')
    await Promise.all([reloadCandidates(), reloadSummaries(), reloadCurrentBookings()])
    setDeclinedFollowUp({ personId, name, startDate, endDate })
  }

  async function handleConfirmCurrentBooking(bookingId: string) {
    await confirmBooking(bookingId)
    await Promise.all([reloadSummaries(), reloadCurrentBookings()])
  }

  async function handleCancelCurrentBooking(bookingId: string) {
    await cancelBooking(bookingId)
    await Promise.all([reloadCandidates(), reloadSummaries(), reloadCurrentBookings()])
  }

  if (!summary) {
    return <div style={{ flex: 1, padding: 32, fontFamily: 'var(--font)', color: 'var(--ink-muted)' }}>No jobs yet — create one to get started.</div>
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 24, color: 'var(--ink)', marginBottom: 16 }}>Planner</div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 24, overflowX: 'auto' }}>
        {activeSummaries.map((s, i) => (
          <JobChip key={s.job.id} summary={s} client={clients[s.job.client_id]} fallbackIndex={i} active={s.job.id === summary.job.id} onClick={() => onSelectJob(s.job.id)} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)', marginBottom: 12 }}>Roles — {summary.job.name}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {summary.requirements.map((r) => (
              <RequirementRow key={r.id} req={r} active={r.id === activeReq?.id} onOpen={setActiveReq} />
            ))}
            {summary.requirements.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No role requirements added yet.</div>}
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)', marginBottom: 12 }}>Crew matching — {activeReq?.role_name}</div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '16px 18px' }}>
            {currentBookings.length > 0 && (
              <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10, marginBottom: 14 }}>
                <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, color: 'var(--ink-muted)', marginBottom: 4 }}>Currently booked</div>
                {currentBookings.map((b) => (
                  <BookedPersonRow
                    key={b.id}
                    booking={b}
                    onConfirm={() => handleConfirmCurrentBooking(b.id)}
                    onCancel={() => handleCancelCurrentBooking(b.id)}
                    onDaysUpdated={reloadCurrentBookings}
                  />
                ))}
              </div>
            )}
            {declinedFollowUp && (
              <div style={{ border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', marginBottom: 8 }}>
                  Recorded — {declinedFollowUp.name} declined. Mark them unavailable for a wider range too?
                </div>
                <AddAvailabilityForm
                  personId={declinedFollowUp.personId}
                  initialStartDate={declinedFollowUp.startDate}
                  initialEndDate={declinedFollowUp.endDate}
                  onCancel={() => setDeclinedFollowUp(undefined)}
                  onSaved={() => {
                    setDeclinedFollowUp(undefined)
                    reloadCandidates()
                  }}
                />
              </div>
            )}
            <CandidateGroup title="AVAILABLE & SUITABLE" tone="var(--success)">
              {pool.suitable.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>No one in this group right now.</div>}
              {pool.suitable.map((c) => (
                <div key={c.person_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{c.name}</span>
                      {c.preferred_status === 'preferred' && <Star size={11} color="var(--primary)" fill="var(--primary)" />}
                    </div>
                    <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>
                      {c.base_location ?? 'Location unknown'}
                      {c.standard_rate ? ` · ${c.rate_currency ?? ''}${c.standard_rate}/day` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => handleOffer(c.person_id, 'pencilled')}
                      title="Hold this person without formally asking yet"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', color: 'var(--primary-soft)', border: '1px dashed var(--primary-soft)', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                    >
                      Pencil
                    </button>
                    <button
                      onClick={() => handleOffer(c.person_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                    >
                      <Check size={12} /> Offer
                    </button>
                    <button
                      onClick={() => handleNotAvailable(c.person_id, c.name)}
                      title="Record a decline from this call — no email sent"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', color: 'var(--ink-muted)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </CandidateGroup>

            <CandidateGroup title="POSSIBLE" tone="var(--attention)">
              {pool.possible.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>No one in this group right now.</div>}
              {pool.possible.map((c) => (
                <div key={c.person_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{c.name}</div>
                    <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>{c.base_location ?? 'Location unknown'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => handleOffer(c.person_id, 'pencilled')}
                      title="Hold this person without formally asking yet"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', color: 'var(--primary-soft)', border: '1px dashed var(--primary-soft)', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                    >
                      Pencil
                    </button>
                    <button
                      onClick={() => handleOffer(c.person_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                    >
                      <Check size={12} /> Offer
                    </button>
                    <button
                      onClick={() => handleNotAvailable(c.person_id, c.name)}
                      title="Record a decline from this call — no email sent"
                      style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', color: 'var(--ink-muted)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </CandidateGroup>

            <CandidateGroup title="UNAVAILABLE" tone="var(--ink-muted)">
              {pool.unavailable.map((c) => (
                <div key={c.person_id} style={{ padding: '8px 0', opacity: 0.6 }}>
                  <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{c.name}</div>
                  <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 1 }}>{c.reason}</div>
                </div>
              ))}
            </CandidateGroup>

            {(pool.already_asked.awaiting_response.length > 0 || pool.already_asked.declined.length > 0) && (
              <CandidateGroup title="ALREADY ASKED" tone="var(--attention)">
                {pool.already_asked.awaiting_response.map((entry, i) => (
                  <AlreadyAskedRow key={`awaiting-${entry.person_id}-${i}`} entry={entry} declined={false} />
                ))}
                {pool.already_asked.declined.map((entry, i) => (
                  <AlreadyAskedRow key={`declined-${entry.person_id}-${i}`} entry={entry} declined={true} />
                ))}
              </CandidateGroup>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team — the resource calendar (addendum v2 §1): "people down, dates
// across." Distinct from Calendar (jobs-over-time) — this is the axis
// Ralto had no view on at all, built to answer "is Kate double-booked in
// November" / "who's actually free that week."
// ---------------------------------------------------------------------------

function dateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getMonthDates(refDate: Date): Date[] {
  const year = refDate.getFullYear()
  const month = refDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1))
}

type TeamMode = 'month' | 'week' | 'fortnight' | '2months'

const TEAM_MODE_LABELS: Record<TeamMode, string> = { month: 'Month', week: 'Week', fortnight: 'Fortnight', '2months': '2 months' }

// Week/Fortnight reuse the same startOfWeek/addDays helpers CalendarContent
// already uses for its own month/week switcher — fortnight is just that
// idea extended to 14 days instead of 7. 2months is two calendar months'
// worth of getMonthDates back to back — the backend endpoint takes an
// arbitrary start/end window already (confirmed against
// GetResourceCalendar directly, no LIMIT or day-count assumption anywhere
// in it), so this is purely a wider `dates` array; nothing else about the
// grid needs to know it's looking at two months instead of one.
function getTeamDates(mode: TeamMode, refDate: Date): Date[] {
  if (mode === 'month') return getMonthDates(refDate)
  if (mode === '2months') {
    const nextMonthRef = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 1)
    return [...getMonthDates(refDate), ...getMonthDates(nextMonthRef)]
  }
  const start = startOfWeek(refDate)
  const days = mode === 'week' ? 7 : 14
  return Array.from({ length: days }, (_, i) => addDays(start, i))
}

// Month's whole purpose is the wide overview — 30px columns, hover-only
// detail is the correct trade-off there and stays untouched. Week/Fortnight
// trade overview width for enough room to show a short job name or leave
// reason inline, without truncating to nothing. 2months is the same
// overview trade-off as Month, just longer, so it shares Month's narrow
// column width rather than Week/Fortnight's wide one.
const DAY_COL_WIDTH = 30
const WIDE_DAY_COL_WIDTH = 100
const NAME_COL_WIDTH = 168

// Terminal Booking statuses (Declined/Cancelled) don't occupy a day on the
// grid — addendum v2 §5's own warning about ghosts applies here too.
const ACTIVE_BOOKING_STATUSES = new Set(['pencilled', 'offered', 'confirmed', 'complete', 'conflict'])

// A solid fill can never safely mean "conflict" — a client's own brand
// colour can be red (Man Utd), and a solid confirmed block in that colour
// is then pixel-identical to a solid "conflict" block. Addendum v1 §3's
// rule (status is never colour-only) applies here exactly as it does to
// the client-stripe/status-dot problem it was written for, so conflict
// gets its own fixed hazard-stripe texture — red/white, never the client's
// colour — rather than a flat fill in a colour the palette can collide
// with.
function bookingCellStyle(booking: ResourceCalendarBooking): { background: string; opacity: number } {
  const color = booking.effective_color_hex || '#7A7A78'
  if (booking.status === 'conflict') {
    return { background: `repeating-linear-gradient(135deg, var(--danger), var(--danger) 3px, #fff 3px, #fff 6px)`, opacity: 1 }
  }
  if (booking.status === 'pencilled') {
    return { background: `repeating-linear-gradient(135deg, ${color}, ${color} 3px, transparent 3px, transparent 6px)`, opacity: 1 }
  }
  if (booking.status === 'offered') return { background: color, opacity: 0.5 }
  return { background: color, opacity: 1 } // confirmed, complete
}

// Cell precedence (addendum v2 §1): a Booking overlapping an Unavailable
// Availability row is rendered as BOTH, flagged — never one picked over
// the other, since that overlap is exactly the exception this view exists
// to catch.
function ResourceCalendarCell({ row, date, mode, onOpenJob }: { row: ResourceCalendarRow; date: Date; mode: TeamMode; onOpenJob: (id: string) => void }) {
  const iso = dateISO(date)
  const bookings = row.bookings.filter((b) => ACTIVE_BOOKING_STATUSES.has(b.status) && b.start_date <= iso && b.end_date >= iso)
  const booking = bookings[0]
  const unavailable = row.availability.find((a) => a.status === 'unavailable' && a.start_date <= iso && a.end_date >= iso)
  const tentative = !unavailable && row.availability.find((a) => a.status === 'tentative' && a.start_date <= iso && a.end_date >= iso)
  // Two independent sources of "conflict": a booking directly marked
  // Conflict, or a live booking overlapping an Unavailable row. Either one
  // gets the same badge — the texture in bookingCellStyle only covers the
  // first case, so the badge is what carries the second.
  const conflict = booking?.status === 'conflict' || (!!booking && !!unavailable)

  const style = booking ? bookingCellStyle(booking) : undefined
  const title = booking
    ? `${booking.job_name} — ${booking.role_name} (${booking.status})${unavailable ? ' · also marked unavailable this day' : ''}`
    : unavailable
      ? `Unavailable${unavailable.type ? ` — ${unavailable.type.replace('_', ' ')}` : ''}`
      : tentative
        ? 'Tentative'
        : undefined

  // Additive, not a replacement: the tooltip above already carries more
  // detail (role name, status) than fits inline even in Fortnight mode, so
  // it stays in all three modes regardless of what's shown inline. Month
  // keeps zero inline text — its 30px columns are the wide-overview trade-off,
  // unchanged from today.
  const showInline = mode === 'week' || mode === 'fortnight'
  const inlineText = !showInline ? undefined : booking ? booking.job_name : unavailable ? (unavailable.type ? AVAILABILITY_TYPE_LABEL[unavailable.type] : 'Unavailable') : undefined
  const inlineColor = booking ? '#fff' : 'var(--danger)'
  // Testing feedback item E: pencilled (and conflict) cells use a hatched
  // background (bookingCellStyle above) whose stripes alternate between a
  // solid colour and `transparent` — white text sat directly on that was
  // unreadable wherever the cell's own light background showed through
  // the transparent gaps. A text-shadow (rather than a different text
  // colour, or changing the hatch itself) keeps the same white reading
  // fine against the solid stripes while punching enough contrast against
  // the gaps too, without needing to know the hatch's own colour in advance.
  const hatchedText = booking?.status === 'pencilled' || booking?.status === 'conflict'

  return (
    <div
      title={title}
      onClick={() => booking && onOpenJob(booking.job_id)}
      style={{
        position: 'relative',
        height: 26,
        margin: '2px 1px',
        borderRadius: 4,
        cursor: booking ? 'pointer' : 'default',
        background: style ? style.background : unavailable ? 'var(--danger-bg)' : tentative ? 'var(--attention-bg)' : 'transparent',
        opacity: style?.opacity,
        border: !booking && unavailable ? '1px solid var(--danger)' : !booking && tentative ? '1px solid var(--attention)' : undefined,
        boxSizing: 'border-box',
        display: inlineText ? 'flex' : undefined,
        alignItems: inlineText ? 'center' : undefined,
        padding: inlineText ? '0 6px' : undefined,
      }}
    >
      {inlineText && (
        <span
          style={{
            fontFamily: 'var(--font)',
            fontWeight: 600,
            fontSize: 10,
            color: inlineColor,
            textShadow: hatchedText ? '0 0 2px rgba(0,0,0,0.85), 0 0 4px rgba(0,0,0,0.6)' : undefined,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flex: '1 1 auto',
          }}
        >
          {inlineText}
        </span>
      )}
      {conflict && (
        <span style={{ position: 'absolute', top: -4, right: -4, width: 13, height: 13, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 1px var(--line)' }}>
          <AlertOctagon size={9} color="var(--danger)" />
        </span>
      )}
    </div>
  )
}

function LegendItem({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>
      {swatch}
      {label}
    </div>
  )
}

function ResourceCalendarContent({
  people,
  onOpenJob,
  onConvertEvent,
}: {
  people: Person[]
  onOpenJob: (id: string) => void
  onConvertEvent: (event: ProspectiveEvent) => void
}) {
  const [mode, setMode] = useState<TeamMode>('month')
  const [refDate, setRefDate] = useState(new Date())
  const [includeIds, setIncludeIds] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const dates = useMemo(() => getTeamDates(mode, refDate), [mode, refDate])
  const colWidth = mode === 'week' || mode === 'fortnight' ? WIDE_DAY_COL_WIDTH : DAY_COL_WIDTH
  const startDate = dateISO(dates[0])
  const endDate = dateISO(dates[dates.length - 1])

  const { data, loading, reload } = useResourceCalendar(startDate, endDate, includeIds)
  const today = new Date()

  // Testing feedback item D: a second scheduler's changes (a new booking,
  // a newly-crewed Job) weren't visible here until a manual page refresh —
  // a real double-booking risk with more than one scheduler working at
  // once. Polling, not push (websockets are a bigger undertaking than
  // asked for here); this component only exists while the Team tab is
  // actually the active one (see RaltoDesktopApp's conditional render), so
  // mount/unmount alone gates the interval to "only when visible" with no
  // extra active==='team' check needed here.
  useEffect(() => {
    const id = setInterval(reload, 45000)
    return () => clearInterval(id)
  }, [reload])

  const goPrev = () => {
    if (mode === 'month') return setRefDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    if (mode === '2months') return setRefDate((d) => new Date(d.getFullYear(), d.getMonth() - 2, 1))
    setRefDate((d) => addDays(d, mode === 'week' ? -7 : -14))
  }
  const goNext = () => {
    if (mode === 'month') return setRefDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    if (mode === '2months') return setRefDate((d) => new Date(d.getFullYear(), d.getMonth() + 2, 1))
    setRefDate((d) => addDays(d, mode === 'week' ? 7 : 14))
  }
  const goToday = () => setRefDate(new Date())

  const headerLabel =
    mode === 'month'
      ? `${MONTH_LABELS[refDate.getMonth()]} ${refDate.getFullYear()}`
      : mode === '2months'
        ? (() => {
            const endRef = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 1)
            return refDate.getFullYear() === endRef.getFullYear()
              ? `${MONTH_LABELS[refDate.getMonth()]} – ${MONTH_LABELS[endRef.getMonth()]} ${refDate.getFullYear()}`
              : `${MONTH_LABELS[refDate.getMonth()]} ${refDate.getFullYear()} – ${MONTH_LABELS[endRef.getMonth()]} ${endRef.getFullYear()}`
          })()
        : (() => {
            const s = dates[0]
            const e = dates[dates.length - 1]
            return `${s.getDate()} – ${e.getDate()} ${MONTH_LABELS[e.getMonth()]} ${e.getFullYear()}`
          })()

  // Explicitly-added rows are session state only, never persisted — see
  // addendum v2 §1's "no pinning is persisted in v1."
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2) return []
    return people
      .filter((p) => p.employment_type === 'freelancer' && !includeIds.includes(p.id))
      .filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(q))
      .slice(0, 6)
  }, [search, people, includeIds])

  const rows = data?.rows ?? []
  const events = data?.prospective_events ?? []

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 24, color: 'var(--ink)' }}>Team</div>
          <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>Who's booked, pencilled, or away — by day.</div>
        </div>
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', background: '#fff', width: 220 }}>
            <Search size={14} color="var(--ink-muted)" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Add a freelancer…"
              style={{ border: 'none', outline: 'none', background: 'none', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', flex: 1 }}
            />
          </div>
          {searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '110%', right: 0, width: 220, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 20px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden' }}>
              {searchResults.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setIncludeIds((ids) => [...ids, p.id])
                    setSearch('')
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)' }}
                >
                  {p.first_name} {p.last_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={goPrev} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <ChevronLeft size={15} color="var(--ink-muted)" />
        </button>
        <button onClick={goNext} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <ChevronRight size={15} color="var(--ink-muted)" />
        </button>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{headerLabel}</div>
        <button onClick={goToday} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer' }}>
          Today
        </button>
        <div style={{ display: 'flex', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: 3, marginLeft: 4 }}>
          {(['month', 'week', 'fortnight', '2months'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{ background: mode === m ? 'var(--primary-tint)' : 'none', color: mode === m ? 'var(--primary)' : 'var(--ink-muted)', border: 'none', borderRadius: 7, padding: '6px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
            >
              {TEAM_MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {loading && <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>Loading…</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `${NAME_COL_WIDTH}px repeat(${dates.length}, ${colWidth}px)`, width: 'max-content' }}>
          <div style={{ position: 'sticky', top: 0, left: 0, zIndex: 4, background: 'var(--surface)', borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)' }} />
          {dates.map((date) => {
            const iso = dateISO(date)
            const inEvent = events.find((e) => e.date_start <= iso && e.date_end >= iso)
            const isToday = sameDay(date, today)
            return (
              <div
                key={iso}
                title={inEvent ? `${inEvent.name} (prospective) — click to convert to a job` : undefined}
                onClick={inEvent ? () => onConvertEvent(inEvent) : undefined}
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 3,
                  background: inEvent ? 'var(--primary-tint)' : 'var(--surface)',
                  borderBottom: '1px solid var(--line)',
                  textAlign: 'center',
                  padding: '6px 0',
                  fontFamily: 'var(--font)',
                  fontSize: 10,
                  fontWeight: isToday ? 700 : 500,
                  color: isToday ? 'var(--primary)' : 'var(--ink-muted)',
                  lineHeight: 1.4,
                  cursor: inEvent ? 'pointer' : 'default',
                }}
              >
                <div>{WEEKDAY_LABELS[(date.getDay() + 6) % 7][0]}</div>
                <div>{date.getDate()}</div>
              </div>
            )
          })}

          {rows.map((row) => (
            <Fragment key={row.person_id}>
              <div
                style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 2,
                  background: '#fff',
                  borderRight: '1px solid var(--line)',
                  borderBottom: '1px solid var(--line)',
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</span>
                {row.employment_type === 'freelancer' && includeIds.includes(row.person_id) && (
                  <button
                    onClick={() => setIncludeIds((ids) => ids.filter((id) => id !== row.person_id))}
                    title="Remove from this session's grid"
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--ink-muted)', marginLeft: 'auto', padding: 2, flexShrink: 0 }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              {dates.map((date) => {
                const iso = dateISO(date)
                // Full-height, not header-only — see check 1 write-up: a
                // header tint only works if the scheduler happens to look
                // up while scanning rows, which defeats the point of a
                // background band.
                const inEvent = events.find((e) => e.date_start <= iso && e.date_end >= iso)
                return (
                  <div key={iso} style={{ borderBottom: '1px solid var(--line)', borderRight: '1px solid #F0EFEA', background: inEvent ? 'var(--primary-tint)' : undefined }}>
                    <ResourceCalendarCell row={row} date={date} mode={mode} onOpenJob={onOpenJob} />
                  </div>
                )
              })}
            </Fragment>
          ))}

          {!loading && rows.length === 0 && (
            <div style={{ gridColumn: '1 / -1', padding: '32px 0', textAlign: 'center', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>
              No one to show for this month — staff appear here always; freelancers show up once they have a booking or availability entry.
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
        <LegendItem swatch={<span style={{ width: 12, height: 8, borderRadius: 3, background: '#7A7A78', display: 'inline-block' }} />} label="Confirmed" />
        <LegendItem
          swatch={<span style={{ width: 12, height: 8, borderRadius: 3, background: 'repeating-linear-gradient(135deg, #7A7A78, #7A7A78 3px, transparent 3px, transparent 6px)', display: 'inline-block' }} />}
          label="Pencilled"
        />
        <LegendItem swatch={<span style={{ width: 12, height: 8, borderRadius: 3, background: '#7A7A78', opacity: 0.5, display: 'inline-block' }} />} label="Offered" />
        <LegendItem swatch={<span style={{ width: 12, height: 8, borderRadius: 3, border: '1px solid var(--danger)', display: 'inline-block' }} />} label="Unavailable" />
        <LegendItem swatch={<AlertOctagon size={12} color="var(--danger)" />} label="Conflict" />
        <LegendItem swatch={<span style={{ width: 12, height: 8, borderRadius: 3, background: 'var(--primary-tint)', display: 'inline-block' }} />} label="Prospective event" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Archive — testing feedback item E. Complete jobs, separate from the
// active Jobs list. Unfiltered view reuses the same summaries already
// fetched at the root (no new request) since it only needs
// name/client/dates; the crew filter switches to a dedicated per-person
// endpoint (useCompletedJobsForPerson) rather than fetching every
// completed job's bookings just to filter client-side.
// ---------------------------------------------------------------------------

function ArchiveRow({ name, clientName, startDate, endDate }: { name: string; clientName: string; startDate: string; endDate: string }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, background: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{name}</div>
        <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>{clientName}</div>
      </div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)' }}>
        {formatDate(startDate)} – {formatDate(endDate)}
      </div>
    </div>
  )
}

function ArchiveContent({ summaries, clients, people }: { summaries: JobSummary[]; clients: Record<string, Client>; people: Person[] }) {
  const [personFilter, setPersonFilter] = useState('')
  const completed = useMemo(() => summaries.filter((s) => s.job.status === 'complete'), [summaries])
  const { data: personCompleted, loading: personLoading } = useCompletedJobsForPerson(personFilter || undefined)

  const sortedPeople = useMemo(() => [...people].sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)), [people])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 24, color: 'var(--ink)' }}>Archive</div>
      </div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', marginBottom: 20 }}>Completed jobs — moved out of the active Jobs list once marked Complete.</div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)', maxWidth: 280, marginBottom: 20 }}>
        Filter to one crew member's history
        <select
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff' }}
        >
          <option value="">All completed jobs</option>
          {sortedPeople.map((p) => (
            <option key={p.id} value={p.id}>
              {p.first_name} {p.last_name}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
        {!personFilter &&
          completed.map((s) => <ArchiveRow key={s.job.id} name={s.job.name} clientName={clients[s.job.client_id]?.name ?? 'Unknown client'} startDate={s.job.start_date} endDate={s.job.end_date} />)}
        {!personFilter && completed.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No completed jobs yet.</div>}

        {personFilter && personLoading && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>Loading…</div>}
        {personFilter && !personLoading && personCompleted.map((j) => <ArchiveRow key={j.id} name={j.name} clientName={j.client_name} startDate={j.start_date} endDate={j.end_date} />)}
        {personFilter && !personLoading && personCompleted.length === 0 && (
          <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No completed jobs for this person yet.</div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crew (scheduler's people directory)
//
// Simplification vs. the original mock: the prototype's per-person
// "booked/available/pending" status was hand-authored mock data implying a
// cross-reference against live bookings for every person. Doing that for
// real would mean an aggregate endpoint this Phase 1 backend doesn't have
// yet (see backend/internal/handlers/people.go) — so this screen shows
// each Person's own real fields and filters by preferred_status/
// employment_type instead of a derived booking status. Primary role IS
// fetched per-row — but as a column on ListPeople's own response
// (primary_role_category, via a subquery server-side), not a per-person
// follow-up call, so the N+1 this screen was built to avoid stays avoided.
// ---------------------------------------------------------------------------

const CREW_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'preferred', label: 'Preferred' },
  { key: 'staff', label: 'Staff' },
  { key: 'freelancer', label: 'Freelancer' },
] as const

// A category's own filter button only appears once at least this many
// people carry it — the categories that actually exist today (see
// docs/ralto_settings_spec_v0_2.md's sibling brief) don't match the five
// originally requested, and Settings → Roles is how that gets reconciled,
// not a hardcoded label list here. A one-off (a typo, a category someone's
// about to rename) folds into "Other" instead of fragmenting the row —
// same principle as "no one" and "no roles at all" both landing there.
//
// Counted from role_categories (every role a person holds), not just
// primary_role_category — a filter is meant to find "who can do this",
// which includes a secondary skill, not only someone's main discipline.
// A person can therefore match more than one discipline button at once;
// that's intentional (unlike primary_role_category's on-card label, which
// still shows exactly one).
//
// Sound/Production/VT missing turned out to be two separate things, not
// one bug: (1) the old primary-only count under-counted real people (e.g.
// someone whose primary role is Vision but who also holds a Technical
// role couldn't be found under Technical at all) — fixed by counting
// role_categories above; but also (2), checked against live data, Sound
// and Production currently have exactly ONE real person each, and VT has
// none at all — even fixed, that's below what MIN_DISCIPLINE_COUNT was
// set to (2). Lowered to 1 as the reasonable call: a role that's real and
// that someone genuinely holds should be findable even if only one person
// has it today, and the original ">=2" was about hiding noise (a typo, a
// one-off), not legitimate categories with thin current headcount. This
// still can't make a truly empty category (VT, right now) appear — that
// needs an actual person holding a VT role, not a filter-logic change.
const MIN_DISCIPLINE_COUNT = 1
const OTHER_DISCIPLINE = 'other'

function disciplineBuckets(people: Person[]): { categories: string[]; hasOther: boolean } {
  const counts = new Map<string, number>()
  for (const p of people) {
    for (const cat of new Set((p.role_categories ?? []).map((c) => c.trim()).filter(Boolean))) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1)
    }
  }
  const categories: string[] = []
  for (const [cat, count] of counts) {
    if (count >= MIN_DISCIPLINE_COUNT) categories.push(cat)
  }
  categories.sort((a, b) => a.localeCompare(b))

  // "Other" catches everyone with no role at all, plus anyone whose roles
  // are all below-threshold ones that didn't earn their own button —
  // mirrors the old primary-only behaviour's fold-in, just evaluated
  // against the full role set instead of a single primary category.
  const categorySet = new Set(categories)
  const hasOther = people.some((p) => {
    const cats = (p.role_categories ?? []).map((c) => c.trim()).filter(Boolean)
    return cats.length === 0 || cats.every((c) => !categorySet.has(c))
  })
  return { categories, hasOther }
}

function personHasDiscipline(person: Person, discipline: string, realCategories: Set<string>): boolean {
  if (discipline === OTHER_DISCIPLINE) return (person.role_categories ?? []).every((c) => !realCategories.has(c.trim()))
  return (person.role_categories ?? []).some((c) => c.trim() === discipline)
}

// personToWriteInput — UpdatePerson overwrites every column in
// personWriteRequest, not just the ones a particular action means to
// change, so any partial write (toggling status, editing just the rate)
// has to start from the person's current values or it'll silently null out
// fields the calling UI doesn't expose (overtime_rule_id, phone_number,
// notification_channels).
function personToWriteInput(p: Person): PersonWriteInput {
  return {
    first_name: p.first_name,
    last_name: p.last_name,
    email: p.email,
    phone: p.phone,
    base_location: p.base_location,
    employment_type: p.employment_type,
    status: p.status,
    preferred_status: p.preferred_status,
    standard_rate: p.standard_rate,
    rate_currency: p.rate_currency,
    overtime_rule_id: p.overtime_rule_id,
    notes: p.notes,
    phone_number: p.phone_number,
    notification_channels: p.notification_channels,
    vehicle_registration: p.vehicle_registration,
  }
}

// PersonForm — shared by "New crew member" (person undefined) and Edit
// (person set). CreatePerson doesn't take a role itself; a selected primary
// role is attached as a separate person_roles row after the person exists,
// same create-parent-then-children order JobCreateForm uses for
// requirements/contacts. Primary role only applies at creation — editing an
// existing person manages roles via the Roles tab instead (add/remove
// secondary roles), so that selector is hidden once a person is passed in.
function PersonForm({
  person,
  roles,
  onCancel,
  onSaved,
}: {
  person?: Person
  roles: Role[]
  onCancel: () => void
  onSaved: (person: Person) => void
}) {
  const [firstName, setFirstName] = useState(person?.first_name ?? '')
  const [lastName, setLastName] = useState(person?.last_name ?? '')
  const [email, setEmail] = useState(person?.email ?? '')
  const [phone, setPhone] = useState(person?.phone ?? '')
  const [baseLocation, setBaseLocation] = useState(person?.base_location ?? '')
  const [employmentType, setEmploymentType] = useState<EmploymentType>(person?.employment_type ?? 'freelancer')
  const [preferredStatus, setPreferredStatus] = useState<PreferredStatus>(person?.preferred_status ?? 'standard')
  const [standardRate, setStandardRate] = useState(person?.standard_rate != null ? String(person.standard_rate) : '')
  const [rateCurrency, setRateCurrency] = useState(person?.rate_currency ?? '')
  const [notes, setNotes] = useState(person?.notes ?? '')
  const [vehicleRegistration, setVehicleRegistration] = useState(person?.vehicle_registration ?? '')
  const [roleId, setRoleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const inputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff', width: '100%', boxSizing: 'border-box' as const }
  const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }

  async function submit() {
    setError(undefined)
    if (!firstName || !lastName || !email) {
      setError('First name, last name, and email are required.')
      return
    }

    setSaving(true)
    try {
      const base = person ? personToWriteInput(person) : undefined
      const payload: PersonWriteInput = {
        ...base,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phone || undefined,
        base_location: baseLocation || undefined,
        employment_type: employmentType,
        preferred_status: preferredStatus,
        standard_rate: standardRate ? Number(standardRate) : undefined,
        rate_currency: rateCurrency || undefined,
        notes: notes || undefined,
        vehicle_registration: vehicleRegistration || undefined,
      }
      const saved = person ? await updatePerson(person.id, payload) : await createPerson(payload)
      if (!person && roleId) {
        await addPersonRole(saved.id, { role_id: roleId, is_primary: true })
      }
      onSaved(saved)
    } catch {
      setError('Could not save that crew member — check the fields and try again.')
      setSaving(false)
    }
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 22, color: 'var(--ink)', marginBottom: 16 }}>{person ? 'Edit crew member' : 'New crew member'}</div>

      <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            First name
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Last name
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Base location
            <input value={baseLocation} onChange={(e) => setBaseLocation(e.target.value)} placeholder="e.g. London" style={inputStyle} />
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Employment type
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)} style={inputStyle}>
              <option value="freelancer">Freelancer</option>
              <option value="staff">Staff</option>
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            Vehicle registration (optional)
            <input value={vehicleRegistration} onChange={(e) => setVehicleRegistration(e.target.value)} placeholder="e.g. AB12 CDE" style={inputStyle} />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 14 }}>
          <label style={{ ...labelStyle, flex: 1.2 }}>
            Preferred status
            <select value={preferredStatus} onChange={(e) => setPreferredStatus(e.target.value as PreferredStatus)} style={inputStyle}>
              <option value="preferred">Preferred</option>
              <option value="approved">Approved</option>
              <option value="standard">Standard</option>
              <option value="restricted">Restricted</option>
            </select>
          </label>
          <label style={{ ...labelStyle, flex: 1 }}>
            Standard rate
            <input type="number" min={0} value={standardRate} onChange={(e) => setStandardRate(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ ...labelStyle, flex: 0.7 }}>
            Currency
            <input value={rateCurrency} onChange={(e) => setRateCurrency(e.target.value.toUpperCase())} placeholder="GBP" style={inputStyle} />
          </label>
        </div>

        {!person && (
          <label style={labelStyle}>
            Primary role (optional)
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} style={inputStyle}>
              <option value="">No role yet</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label style={labelStyle}>
          Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'var(--font)' }} />
        </label>

        {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--danger)' }}>{error}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onCancel} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '9px 16px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '9px 18px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : person ? 'Save changes' : 'Create crew member'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PersonCard({ person, onClick }: { person: Person; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '14px 16px', fontFamily: 'inherit' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>
              {person.first_name} {person.last_name}
            </span>
            {person.preferred_status === 'preferred' && <Star size={12} color="var(--primary)" fill="var(--primary)" />}
          </div>
          <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2, textTransform: 'capitalize' }}>
            {person.employment_type}
            {person.primary_role_category ? ` · ${person.primary_role_category}` : ''}
          </div>
          {person.base_location && (
            <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={11} /> {person.base_location}
            </div>
          )}
        </div>
        <span style={{ flexShrink: 0, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11, padding: '4px 9px', borderRadius: 999, color: person.status === 'active' ? 'var(--success)' : 'var(--ink-muted)', background: person.status === 'active' ? 'var(--success-bg)' : 'var(--track)' }}>
          {person.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </div>
    </button>
  )
}

// --- Person detail (Crew screen drill-in) ---
//
// Availability is the first tab built — see addendum v2 §2. PERSON_TABS is
// deliberately an array so Roles/Skills/Documents can be added as further
// tabs later without restructuring this component.

const AVAILABILITY_TYPE_LABEL: Record<AvailabilityType, string> = {
  annual_leave: 'Annual leave',
  sick: 'Sick',
  toil: 'TOIL',
  other: 'Other',
}

const AVAILABILITY_STATUS_LABEL: Record<AvailabilityStatus, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  tentative: 'Tentative',
  booked: 'Booked',
}

function availabilityStatusColor(status: AvailabilityStatus) {
  if (status === 'unavailable') return { color: 'var(--danger)', bg: 'var(--danger-bg)' }
  if (status === 'tentative') return { color: 'var(--attention)', bg: 'var(--attention-bg)' }
  return { color: 'var(--success)', bg: 'var(--success-bg)' }
}

function AvailabilityRow({ entry, onDelete }: { entry: Availability; onDelete: () => void }) {
  const tone = availabilityStatusColor(entry.status)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', background: '#fff' }}>
      <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, padding: '4px 10px', borderRadius: 999, color: tone.color, background: tone.bg, flexShrink: 0 }}>
        {AVAILABILITY_STATUS_LABEL[entry.status]}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)' }}>
          {formatDate(entry.start_date)} – {formatDate(entry.end_date)}
          {entry.type && <span style={{ color: 'var(--ink-muted)' }}> · {AVAILABILITY_TYPE_LABEL[entry.type]}</span>}
        </div>
        {entry.notes && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{entry.notes}</div>}
      </div>
      <button onClick={onDelete} title="Remove entry" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--ink-muted)' }}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

function AddAvailabilityForm({
  personId,
  initialStartDate,
  initialEndDate,
  onSaved,
  onCancel,
}: {
  personId: string
  // Planner's "Not available" follow-up defaults this to the requirement's
  // own dates rather than today, since the whole point there is "mark them
  // unavailable for (at least) the dates just declined" — still editable,
  // just a different starting point than the Crew-tab call site.
  initialStartDate?: string
  initialEndDate?: string
  onSaved: () => void
  onCancel: () => void
}) {
  const [startDate, setStartDate] = useState(initialStartDate ?? todayISO())
  const [endDate, setEndDate] = useState(initialEndDate ?? todayISO())
  const [status, setStatus] = useState<AvailabilityStatus>('unavailable')
  const [type, setType] = useState<AvailabilityType | ''>('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const inputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff' }

  async function submit() {
    setSaving(true)
    setError(undefined)
    try {
      await createAvailability(personId, {
        start_date: startDate,
        end_date: endDate,
        status,
        type: status === 'unavailable' && type ? type : undefined,
        notes: notes || undefined,
      })
      onSaved()
    } catch {
      setError('Could not save that entry.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--primary-soft)', background: 'var(--primary-surface)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>Start date</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>End date</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
          <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as AvailabilityStatus)} style={inputStyle}>
            <option value="unavailable">Unavailable</option>
            <option value="available">Available</option>
            <option value="tentative">Tentative</option>
          </select>
        </label>
        {status === 'unavailable' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }}>Reason</span>
            <select value={type} onChange={(e) => setType(e.target.value as AvailabilityType | '')} style={inputStyle}>
              <option value="">Unspecified</option>
              <option value="annual_leave">Annual leave</option>
              <option value="sick">Sick</option>
              <option value="toil">TOIL</option>
              <option value="other">Other</option>
            </select>
          </label>
        )}
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" style={inputStyle} />
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-muted)' }}>
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving || !startDate || !endDate}
          style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Saving…' : 'Add entry'}
        </button>
      </div>
    </div>
  )
}

function PersonAvailabilityTab({ person }: { person: Person }) {
  const { data: entries, loading, reload } = useAvailability(person.id)
  const [adding, setAdding] = useState(false)

  const sorted = useMemo(() => [...entries].sort((a, b) => a.start_date.localeCompare(b.start_date)), [entries])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)' }}>Availability</span>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
          >
            <Plus size={13} /> Add entry
          </button>
        )}
      </div>

      {adding && (
        <div style={{ marginBottom: 14 }}>
          <AddAvailabilityForm
            personId={person.id}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false)
              reload()
            }}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sorted.map((entry) => (
          <AvailabilityRow key={entry.id} entry={entry} onDelete={() => deleteAvailability(person.id, entry.id).then(reload)} />
        ))}
        {!loading && sorted.length === 0 && !adding && (
          <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', padding: '12px 0' }}>No availability entries logged yet.</div>
        )}
      </div>
    </div>
  )
}

// ScheduleIt history — "was this person on site that day" lookups against
// the archived ScheduleIt account. Read-only end to end: no add/edit/
// delete here, matching the endpoint (only the one-shot import script ever
// writes scheduleit_history).
function ScheduleItHistoryRow({ entry }: { entry: ScheduleItHistory }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)' }}>{entry.title}</span>
        <span style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
          {formatDate(entry.date_start)}
          {entry.date_end && entry.date_end !== entry.date_start ? ` – ${formatDate(entry.date_end)}` : ''}
        </span>
      </div>
      {entry.client_name && <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>{entry.client_name}</div>}
      {entry.notes && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{entry.notes}</div>}
    </div>
  )
}

function PersonHistoryTab({ person }: { person: Person }) {
  const { data: entries, loading } = useScheduleItHistory(person.id)

  return (
    <div>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)', marginBottom: 12 }}>
        ScheduleIt history
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((entry) => (
          <ScheduleItHistoryRow key={entry.id} entry={entry} />
        ))}
        {!loading && entries.length === 0 && (
          <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', padding: '12px 0' }}>No ScheduleIt history for this person.</div>
        )}
      </div>
    </div>
  )
}

// PersonCompletedJobsTab — testing feedback item E's Archive crew-filter,
// surfaced a second place: sitting alongside the existing (read-only,
// ScheduleIt-imported) History tab rather than merged into it. Genuinely
// different data — real Ralto Jobs this person actually worked, not
// legacy imported rows — so it gets its own tab in the same profile area
// instead of conflating two different sources into one list.
function PersonCompletedJobsTab({ person }: { person: Person }) {
  const { data: jobs, loading } = useCompletedJobsForPerson(person.id)

  return (
    <div>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)', marginBottom: 12 }}>Completed jobs</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {jobs.map((j) => (
          <ArchiveRow key={j.id} name={j.name} clientName={j.client_name} startDate={j.start_date} endDate={j.end_date} />
        ))}
        {!loading && jobs.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', padding: '12px 0' }}>No completed jobs for this person yet.</div>}
      </div>
    </div>
  )
}

type PersonTabKey = 'availability' | 'roles' | 'history' | 'completed'
const PERSON_TABS: { key: PersonTabKey; label: string }[] = [
  { key: 'availability', label: 'Availability' },
  { key: 'roles', label: 'Roles' },
  { key: 'history', label: 'History' },
  { key: 'completed', label: 'Completed jobs' },
]

function PersonRolesTab({
  person,
  roles,
  personRoles,
  loading,
  reload,
}: {
  person: Person
  roles: Role[]
  personRoles: PersonRole[]
  loading: boolean
  reload: () => void
}) {
  const [addingRoleId, setAddingRoleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const inputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '7px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff' }
  const availableRoles = roles.filter((r) => !personRoles.some((pr) => pr.role_id === r.id))

  async function addRole() {
    if (!addingRoleId) return
    setSaving(true)
    setError(undefined)
    try {
      // Roles added here are always secondary — the one role a person can
      // create with is_primary set is chosen at creation time (PersonForm);
      // changing which role is primary afterward is explicitly out of scope.
      await addPersonRole(person.id, { role_id: addingRoleId, is_primary: false })
      setAddingRoleId('')
      reload()
    } catch {
      setError('Could not add that role.')
    } finally {
      setSaving(false)
    }
  }

  async function removeRole(pr: PersonRole) {
    await removePersonRole(person.id, pr.id)
    reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {personRoles.map((pr) => (
          <div key={pr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', background: '#fff' }}>
            <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13.5, color: 'var(--ink)', flex: 1 }}>{pr.role_name}</span>
            {pr.is_primary && (
              <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11, padding: '3px 9px', borderRadius: 999, color: 'var(--primary)', background: 'var(--primary-tint)' }}>Primary</span>
            )}
            <button onClick={() => removeRole(pr)} title="Remove role" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--ink-muted)' }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!loading && personRoles.length === 0 && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', padding: '12px 0' }}>No roles assigned yet.</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select value={addingRoleId} onChange={(e) => setAddingRoleId(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
          <option value="">Add a role…</option>
          {availableRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <button
          onClick={addRole}
          disabled={!addingRoleId || saving}
          style={{ border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', opacity: !addingRoleId || saving ? 0.6 : 1 }}
        >
          Add
        </button>
      </div>
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
    </div>
  )
}

// TempPasswordModal — the temporary password is only ever available in the
// InviteToCrewApp response body; there is no endpoint to fetch it again
// afterward, so this is the one place it's ever rendered. Nothing here
// stores it beyond this component's own state, and dismissing throws it
// away for good.
function TempPasswordModal({ password, onDismiss }: { password: string; onDismiss: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 24, width: 380, boxShadow: '0 20px 50px rgba(0,0,0,0.25)' }}>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 16, color: 'var(--ink)', marginBottom: 6 }}>App access granted</div>
        <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 14 }}>
          Share this temporary password with them directly. It won't be shown again — if it's lost, grant access again to generate a new one.
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--ink)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px', textAlign: 'center', letterSpacing: 1, marginBottom: 16 }}>
          {password}
        </div>
        <button
          onClick={onDismiss}
          style={{ width: '100%', border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '10px 0', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          I've saved it — done
        </button>
      </div>
    </div>
  )
}

type DeleteState = 'idle' | 'confirming' | 'blocked'

function PersonDetail({ person, roles, onBack, reloadPeople }: { person: Person; roles: Role[]; onBack: () => void; reloadPeople: () => void }) {
  const [tab, setTab] = useState<PersonTabKey>('availability')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteState, setDeleteState] = useState<DeleteState>('idle')
  const [inviting, setInviting] = useState(false)
  const [tempPassword, setTempPassword] = useState<string | undefined>(undefined)
  const { data: personRoles, loading: rolesLoading, reload: reloadPersonRoles } = usePersonRoles(person.id)

  const primaryRole = personRoles.find((pr) => pr.is_primary)

  async function toggleActive() {
    setBusy(true)
    try {
      await updatePerson(person.id, { ...personToWriteInput(person), status: person.status === 'active' ? 'inactive' : 'active' })
      reloadPeople()
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    setBusy(true)
    try {
      await deletePerson(person.id)
      reloadPeople()
      onBack()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setDeleteState('blocked')
      } else {
        setDeleteState('idle')
      }
    } finally {
      setBusy(false)
    }
  }

  async function grantAccess() {
    setInviting(true)
    try {
      const { temporary_password } = await invitePerson(person.id)
      setTempPassword(temporary_password)
    } finally {
      setInviting(false)
    }
  }

  if (editing) {
    return (
      <PersonForm
        person={person}
        roles={roles}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          reloadPeople()
        }}
      />
    )
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      {tempPassword && <TempPasswordModal password={tempPassword} onDismiss={() => setTempPassword(undefined)} />}

      <button
        onClick={onBack}
        style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', cursor: 'pointer', padding: 0, marginBottom: 16, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink-muted)' }}
      >
        <ChevronLeft size={14} /> Crew
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 22, color: 'var(--ink)' }}>
            {person.first_name} {person.last_name}
          </span>
          {person.preferred_status === 'preferred' && <Star size={14} color="var(--primary)" fill="var(--primary)" />}
        </div>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11, padding: '4px 9px', borderRadius: 999, color: person.status === 'active' ? 'var(--success)' : 'var(--ink-muted)', background: person.status === 'active' ? 'var(--success-bg)' : 'var(--track)' }}>
          {person.status === 'active' ? 'Active' : 'Inactive'}
        </span>
      </div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', marginBottom: 18 }}>
        {primaryRole && <span>{primaryRole.role_name} · </span>}
        <span style={{ textTransform: 'capitalize' }}>{person.employment_type}</span>
        {person.base_location ? ` · ${person.base_location}` : ''}
        {person.vehicle_registration ? ` · ${person.vehicle_registration}` : ''}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <button
          onClick={() => setEditing(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
        >
          <Pencil size={13} /> Edit
        </button>
        <button
          onClick={toggleActive}
          disabled={busy}
          style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: person.status === 'active' ? 'var(--danger)' : 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}
        >
          <UserX size={13} /> {person.status === 'active' ? 'Deactivate' : 'Reactivate'}
        </button>
        <button
          onClick={grantAccess}
          disabled={inviting}
          title="Generates a new temporary password each time"
          style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', opacity: inviting ? 0.7 : 1 }}
        >
          <KeyRound size={13} /> {inviting ? 'Granting…' : 'Grant app access'}
        </button>
      </div>

      {deleteState === 'idle' && (
        <button
          onClick={() => setDeleteState('confirming')}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, marginBottom: 18, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 11.5, color: 'var(--ink-muted)', textDecoration: 'underline' }}
        >
          Delete this record
        </button>
      )}
      {deleteState === 'confirming' && (
        <div style={{ border: '1px solid var(--danger)', background: 'var(--danger-bg)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>
            Delete {person.first_name} {person.last_name}? This can't be undone — use Deactivate instead if they might return.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setDeleteState('idle')} style={{ border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={busy}
              style={{ border: 'none', background: 'var(--danger)', color: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}
            >
              Yes, delete
            </button>
          </div>
        </div>
      )}
      {deleteState === 'blocked' && (
        <div style={{ border: '1px solid var(--danger)', background: 'var(--danger-bg)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink)' }}>
            {person.first_name} has booking history, so they can't be deleted — deactivate them instead to keep that history intact.
          </div>
          <button
            onClick={() => setDeleteState('idle')}
            style={{ alignSelf: 'flex-start', border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer', color: 'var(--ink-muted)' }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 18 }}>
        {PERSON_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '8px 4px',
              marginRight: 20,
              fontFamily: 'var(--font)',
              fontWeight: 600,
              fontSize: 13,
              color: tab === t.key ? 'var(--primary)' : 'var(--ink-muted)',
              borderBottom: tab === t.key ? '2px solid var(--primary)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'availability' && <PersonAvailabilityTab person={person} />}
      {tab === 'roles' && <PersonRolesTab person={person} roles={roles} personRoles={personRoles} loading={rolesLoading} reload={reloadPersonRoles} />}
      {tab === 'history' && <PersonHistoryTab person={person} />}
      {tab === 'completed' && <PersonCompletedJobsTab person={person} />}
    </div>
  )
}

function CrewContent({ people, roles, reloadPeople }: { people: Person[]; roles: Role[]; reloadPeople: () => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof CREW_FILTERS)[number]['key']>('all')
  const [discipline, setDiscipline] = useState<string>('all')
  const [selectedPersonId, setSelectedPersonId] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)

  const { categories: disciplineCategories, hasOther: disciplineHasOther } = useMemo(() => disciplineBuckets(people), [people])
  const disciplineCategorySet = useMemo(() => new Set(disciplineCategories), [disciplineCategories])

  const filtered = useMemo(() => {
    let list = people.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(query.toLowerCase()))
    if (filter === 'preferred') list = list.filter((p) => p.preferred_status === 'preferred')
    if (filter === 'staff' || filter === 'freelancer') list = list.filter((p) => p.employment_type === filter)
    if (discipline !== 'all') list = list.filter((p) => personHasDiscipline(p, discipline, disciplineCategorySet))
    return list
  }, [people, query, filter, discipline, disciplineCategorySet])

  if (creating) {
    return (
      <PersonForm
        roles={roles}
        onCancel={() => setCreating(false)}
        onSaved={(p) => {
          setCreating(false)
          reloadPeople()
          setSelectedPersonId(p.id)
        }}
      />
    )
  }

  const selectedPerson = people.find((p) => p.id === selectedPersonId)
  if (selectedPerson) {
    return <PersonDetail person={selectedPerson} roles={roles} onBack={() => setSelectedPersonId(undefined)} reloadPeople={reloadPeople} />
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 24, color: 'var(--ink)' }}>Crew</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)', borderRadius: 10, padding: '8px 12px', background: '#fff', width: 260 }}>
            <Search size={15} color="var(--ink-muted)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name" style={{ border: 'none', outline: 'none', background: 'none', fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)', flex: 1 }} />
          </div>
          <button
            onClick={() => setCreating(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            <UserPlus size={14} /> New crew member
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: disciplineCategories.length > 0 || disciplineHasOther ? 10 : 20 }}>
        {CREW_FILTERS.map((f) => {
          const isActive = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{ background: isActive ? 'var(--primary)' : '#fff', color: isActive ? '#fff' : 'var(--ink-muted)', border: isActive ? 'none' : '1px solid var(--line)', borderRadius: 999, padding: '7px 16px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {(disciplineCategories.length > 0 || disciplineHasOther) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {(['all', ...disciplineCategories, ...(disciplineHasOther ? [OTHER_DISCIPLINE] : [])] as const).map((d) => {
            const isActive = discipline === d
            const label = d === 'all' ? 'All disciplines' : d === OTHER_DISCIPLINE ? 'Other' : d
            return (
              <button
                key={d}
                onClick={() => setDiscipline(d)}
                style={{ background: isActive ? 'var(--primary-tint)' : '#fff', color: isActive ? 'var(--primary)' : 'var(--ink-muted)', border: isActive ? '1px solid var(--primary-soft)' : '1px solid var(--line)', borderRadius: 999, padding: '5px 13px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        {filtered.map((p) => (
          <PersonCard key={p.id} person={p} onClick={() => setSelectedPersonId(p.id)} />
        ))}
        {filtered.length === 0 && <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink-muted)' }}>No one matches.</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings — Roles, Overtime rules, Skills: the three reference tables
// schedulers curate directly (ralto_settings_spec_v0_2.md §3). Reference
// data, not an operational workflow — each section is just a list plus
// inline create/edit and delete-with-guard, nothing more elaborate.
// ---------------------------------------------------------------------------

const settingsInputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '8px 10px', fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', background: '#fff', width: '100%', boxSizing: 'border-box' as const }
const settingsLabelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)' }
const settingsRowStyle = { display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderRadius: 10, padding: '10px 14px', background: '#fff' }
const settingsIconButtonStyle = { border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: 'var(--ink-muted)', display: 'flex' }
const settingsCancelButtonStyle = { border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-muted)' }
const settingsPrimaryButtonStyle = { border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }
const settingsAddButtonStyle = { display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'var(--primary)', color: '#fff', borderRadius: 8, padding: '7px 14px', fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }

// Shared per-section delete flow: a click arms an inline confirm rather than
// deleting immediately, and a 409 from the guard (role/rule/skill still
// referenced) surfaces as a message under that row rather than a raw error —
// same graceful pattern as Crew's delete-with-booking-history handling.
function useDeleteWithGuard(deleteFn: (id: string) => Promise<unknown>, reload: () => void) {
  const [pendingId, setPendingId] = useState<string | undefined>(undefined)
  const [blocked, setBlocked] = useState<{ id: string; message: string } | undefined>(undefined)

  async function confirmDelete(id: string) {
    setBlocked(undefined)
    try {
      await deleteFn(id)
      reload()
    } catch (err) {
      setBlocked({ id, message: err instanceof ApiError ? err.message : 'Could not delete — try again.' })
    } finally {
      setPendingId(undefined)
    }
  }

  return { pendingId, setPendingId, blocked, confirmDelete }
}

function RoleForm({ role, onCancel, onSaved }: { role?: Role; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(role?.name ?? '')
  const [category, setCategory] = useState(role?.category ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const payload = { name, category: category || undefined }
      if (role) await updateRole(role.id, payload)
      else await createRole(payload)
      onSaved()
    } catch {
      setError('Could not save that role.')
      setSaving(false)
    }
  }

  return (
    <div style={{ ...settingsRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...settingsLabelStyle, flex: 1 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={settingsInputStyle} />
        </label>
        <label style={{ ...settingsLabelStyle, flex: 1 }}>
          Category (optional)
          <input value={category} onChange={(e) => setCategory(e.target.value)} style={settingsInputStyle} />
        </label>
      </div>
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={settingsCancelButtonStyle}>
          Cancel
        </button>
        <button onClick={submit} disabled={saving} style={{ ...settingsPrimaryButtonStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : role ? 'Save' : 'Add role'}
        </button>
      </div>
    </div>
  )
}

function RolesSection({ roles, reload }: { roles: Role[]; reload: () => void }) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const { pendingId, setPendingId, blocked, confirmDelete } = useDeleteWithGuard(deleteRole, reload)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)' }}>Roles</span>
        {!creating && (
          <button onClick={() => setCreating(true)} style={settingsAddButtonStyle}>
            <Plus size={13} /> Add role
          </button>
        )}
      </div>
      {creating && (
        <div style={{ marginBottom: 10 }}>
          <RoleForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roles.map((role) =>
          editingId === role.id ? (
            <RoleForm key={role.id} role={role} onCancel={() => setEditingId(undefined)} onSaved={() => { setEditingId(undefined); reload() }} />
          ) : (
            <div key={role.id}>
              <div style={settingsRowStyle}>
                <div style={{ flex: 1, fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span style={{ fontWeight: 600 }}>{role.name}</span>
                  {role.category && <span style={{ color: 'var(--ink-muted)' }}> · {role.category}</span>}
                </div>
                {pendingId === role.id ? (
                  <>
                    <span style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)' }}>Delete this role?</span>
                    <button onClick={() => setPendingId(undefined)} style={{ ...settingsCancelButtonStyle, padding: '5px 10px' }}>
                      Cancel
                    </button>
                    <button onClick={() => confirmDelete(role.id)} style={{ ...settingsPrimaryButtonStyle, background: 'var(--danger)', padding: '5px 10px' }}>
                      Confirm
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditingId(role.id)} title="Edit role" style={settingsIconButtonStyle}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setPendingId(role.id)} title="Delete role" style={settingsIconButtonStyle}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
              {blocked?.id === role.id && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{blocked.message}</div>}
            </div>
          ),
        )}
        {roles.length === 0 && !creating && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No roles yet.</div>}
      </div>
    </div>
  )
}

function VehicleForm({ vehicle, onCancel, onSaved }: { vehicle?: Vehicle; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(vehicle?.name ?? '')
  const [registration, setRegistration] = useState(vehicle?.registration ?? '')
  const [notes, setNotes] = useState(vehicle?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function submit() {
    if (!name.trim() || !registration.trim()) {
      setError('Name and registration are both required.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const payload = { name, registration, notes: notes || undefined }
      if (vehicle) await updateVehicle(vehicle.id, payload)
      else await createVehicle(payload)
      onSaved()
    } catch {
      setError('Could not save that vehicle.')
      setSaving(false)
    }
  }

  return (
    <div style={{ ...settingsRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...settingsLabelStyle, flex: 1 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Transit Van 1" style={settingsInputStyle} />
        </label>
        <label style={{ ...settingsLabelStyle, flex: 1 }}>
          Registration
          <input value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="e.g. AB12 CDE" style={settingsInputStyle} />
        </label>
      </div>
      <label style={settingsLabelStyle}>
        Notes (optional)
        <input value={notes} onChange={(e) => setNotes(e.target.value)} style={settingsInputStyle} />
      </label>
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={settingsCancelButtonStyle}>
          Cancel
        </button>
        <button onClick={submit} disabled={saving} style={{ ...settingsPrimaryButtonStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : vehicle ? 'Save' : 'Add vehicle'}
        </button>
      </div>
    </div>
  )
}

function VehiclesSection({ vehicles, reload }: { vehicles: Vehicle[]; reload: () => void }) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const { pendingId, setPendingId, blocked, confirmDelete } = useDeleteWithGuard(deleteVehicle, reload)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)' }}>Vehicles</span>
        {!creating && (
          <button onClick={() => setCreating(true)} style={settingsAddButtonStyle}>
            <Plus size={13} /> Add vehicle
          </button>
        )}
      </div>
      {creating && (
        <div style={{ marginBottom: 10 }}>
          <VehicleForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {vehicles.map((vehicle) =>
          editingId === vehicle.id ? (
            <VehicleForm key={vehicle.id} vehicle={vehicle} onCancel={() => setEditingId(undefined)} onSaved={() => { setEditingId(undefined); reload() }} />
          ) : (
            <div key={vehicle.id}>
              <div style={settingsRowStyle}>
                <div style={{ flex: 1, fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span style={{ fontWeight: 600 }}>{vehicle.name}</span>
                  <span style={{ color: 'var(--ink-muted)' }}> · {vehicle.registration}</span>
                </div>
                {pendingId === vehicle.id ? (
                  <>
                    <span style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)' }}>Delete this vehicle?</span>
                    <button onClick={() => setPendingId(undefined)} style={{ ...settingsCancelButtonStyle, padding: '5px 10px' }}>
                      Cancel
                    </button>
                    <button onClick={() => confirmDelete(vehicle.id)} style={{ ...settingsPrimaryButtonStyle, background: 'var(--danger)', padding: '5px 10px' }}>
                      Confirm
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditingId(vehicle.id)} title="Edit vehicle" style={settingsIconButtonStyle}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setPendingId(vehicle.id)} title="Delete vehicle" style={settingsIconButtonStyle}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
              {blocked?.id === vehicle.id && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{blocked.message}</div>}
            </div>
          ),
        )}
        {vehicles.length === 0 && !creating && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No fleet vehicles yet.</div>}
      </div>
    </div>
  )
}

function OvertimeRuleForm({ rule, onCancel, onSaved }: { rule?: OvertimeRule; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(rule?.name ?? '')
  const [thresholdHours, setThresholdHours] = useState(rule ? String(rule.threshold_hours) : '')
  const [multiplier, setMultiplier] = useState(rule ? String(rule.multiplier) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function submit() {
    if (!name.trim() || !thresholdHours || !multiplier) {
      setError('Name, threshold, and multiplier are all required.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const payload = { name, threshold_hours: Number(thresholdHours), multiplier: Number(multiplier) }
      if (rule) await updateOvertimeRule(rule.id, payload)
      else await createOvertimeRule(payload)
      onSaved()
    } catch {
      setError('Could not save that overtime rule.')
      setSaving(false)
    }
  }

  return (
    <div style={{ ...settingsRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...settingsLabelStyle, flex: 1.4 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={settingsInputStyle} />
        </label>
        <label style={{ ...settingsLabelStyle, flex: 1 }}>
          Threshold (hours)
          <input type="number" min={0} step="0.5" value={thresholdHours} onChange={(e) => setThresholdHours(e.target.value)} style={settingsInputStyle} />
        </label>
        <label style={{ ...settingsLabelStyle, flex: 1 }}>
          Multiplier
          <input type="number" min={1} step="0.1" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} style={settingsInputStyle} />
        </label>
      </div>
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={settingsCancelButtonStyle}>
          Cancel
        </button>
        <button onClick={submit} disabled={saving} style={{ ...settingsPrimaryButtonStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : rule ? 'Save' : 'Add rule'}
        </button>
      </div>
    </div>
  )
}

function OvertimeRulesSection({ rules, reload }: { rules: OvertimeRule[]; reload: () => void }) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const { pendingId, setPendingId, blocked, confirmDelete } = useDeleteWithGuard(deleteOvertimeRule, reload)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)' }}>Overtime rules</span>
        {!creating && (
          <button onClick={() => setCreating(true)} style={settingsAddButtonStyle}>
            <Plus size={13} /> Add rule
          </button>
        )}
      </div>
      {creating && (
        <div style={{ marginBottom: 10 }}>
          <OvertimeRuleForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rules.map((rule) =>
          editingId === rule.id ? (
            <OvertimeRuleForm key={rule.id} rule={rule} onCancel={() => setEditingId(undefined)} onSaved={() => { setEditingId(undefined); reload() }} />
          ) : (
            <div key={rule.id}>
              <div style={settingsRowStyle}>
                <div style={{ flex: 1, fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span style={{ fontWeight: 600 }}>{rule.name}</span>
                  <span style={{ color: 'var(--ink-muted)' }}>
                    {' '}
                    · {rule.threshold_hours}h threshold · ×{rule.multiplier}
                  </span>
                </div>
                {pendingId === rule.id ? (
                  <>
                    <span style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)' }}>Delete this rule?</span>
                    <button onClick={() => setPendingId(undefined)} style={{ ...settingsCancelButtonStyle, padding: '5px 10px' }}>
                      Cancel
                    </button>
                    <button onClick={() => confirmDelete(rule.id)} style={{ ...settingsPrimaryButtonStyle, background: 'var(--danger)', padding: '5px 10px' }}>
                      Confirm
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditingId(rule.id)} title="Edit rule" style={settingsIconButtonStyle}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setPendingId(rule.id)} title="Delete rule" style={settingsIconButtonStyle}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
              {blocked?.id === rule.id && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{blocked.message}</div>}
            </div>
          ),
        )}
        {rules.length === 0 && !creating && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No overtime rules yet.</div>}
      </div>
    </div>
  )
}

const SKILL_TYPE_LABEL: Record<SkillType, string> = {
  skill: 'Skill',
  certification: 'Certification',
  visa: 'Visa',
  credential: 'Credential',
}

function SkillForm({ skill, onCancel, onSaved }: { skill?: Skill; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(skill?.name ?? '')
  const [type, setType] = useState<SkillType>(skill?.type ?? 'skill')
  const [expiryTracked, setExpiryTracked] = useState(skill?.expiry_tracked ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      const payload = { name, type, expiry_tracked: expiryTracked }
      if (skill) await updateSkill(skill.id, payload)
      else await createSkill(payload)
      onSaved()
    } catch {
      setError('Could not save that skill.')
      setSaving(false)
    }
  }

  return (
    <div style={{ ...settingsRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ ...settingsLabelStyle, flex: 1.4 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={settingsInputStyle} />
        </label>
        <label style={{ ...settingsLabelStyle, flex: 1 }}>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as SkillType)} style={settingsInputStyle}>
            <option value="skill">Skill</option>
            <option value="certification">Certification</option>
            <option value="visa">Visa</option>
            <option value="credential">Credential</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', paddingBottom: 8, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={expiryTracked} onChange={(e) => setExpiryTracked(e.target.checked)} />
          Track expiry
        </label>
      </div>
      {error && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={settingsCancelButtonStyle}>
          Cancel
        </button>
        <button onClick={submit} disabled={saving} style={{ ...settingsPrimaryButtonStyle, opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : skill ? 'Save' : 'Add skill'}
        </button>
      </div>
    </div>
  )
}

function SkillsSection({ skills, reload }: { skills: Skill[]; reload: () => void }) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const { pendingId, setPendingId, blocked, confirmDelete } = useDeleteWithGuard(deleteSkill, reload)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)' }}>Skills</span>
        {!creating && (
          <button onClick={() => setCreating(true)} style={settingsAddButtonStyle}>
            <Plus size={13} /> Add skill
          </button>
        )}
      </div>
      {creating && (
        <div style={{ marginBottom: 10 }}>
          <SkillForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); reload() }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {skills.map((skill) =>
          editingId === skill.id ? (
            <SkillForm key={skill.id} skill={skill} onCancel={() => setEditingId(undefined)} onSaved={() => { setEditingId(undefined); reload() }} />
          ) : (
            <div key={skill.id}>
              <div style={settingsRowStyle}>
                <div style={{ flex: 1, fontFamily: 'var(--font)', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span style={{ fontWeight: 600 }}>{skill.name}</span>
                  <span style={{ color: 'var(--ink-muted)' }}>
                    {' '}
                    · {SKILL_TYPE_LABEL[skill.type]}
                    {skill.expiry_tracked ? ' · expiry tracked' : ''}
                  </span>
                </div>
                {pendingId === skill.id ? (
                  <>
                    <span style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--ink-muted)' }}>Delete this skill?</span>
                    <button onClick={() => setPendingId(undefined)} style={{ ...settingsCancelButtonStyle, padding: '5px 10px' }}>
                      Cancel
                    </button>
                    <button onClick={() => confirmDelete(skill.id)} style={{ ...settingsPrimaryButtonStyle, background: 'var(--danger)', padding: '5px 10px' }}>
                      Confirm
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditingId(skill.id)} title="Edit skill" style={settingsIconButtonStyle}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => setPendingId(skill.id)} title="Delete skill" style={settingsIconButtonStyle}>
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
              {blocked?.id === skill.id && <div style={{ fontFamily: 'var(--font)', fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>{blocked.message}</div>}
            </div>
          ),
        )}
        {skills.length === 0 && !creating && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>No skills yet.</div>}
      </div>
    </div>
  )
}

// DakboardFeedSection — the org-wide "Booked jobs" feed for an internal
// Dakboard display. Deliberately not personalised: one shared link for
// the whole organisation, generated on first view here (never
// proactively) and invalidated only by an explicit regenerate — same
// token semantics as the crew's own per-person feed, just scoped to the
// org instead of a Person. See internal/handlers/calendar_feed.go.
function DakboardFeedSection() {
  const [feedUrl, setFeedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .get<{ feed_url: string }>('/dakboard-feed')
      .then((res) => setFeedUrl(res.feed_url))
      .finally(() => setLoading(false))
  }, [])

  async function copy() {
    if (!feedUrl) return
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API unavailable — the URL is still visible/selectable above.
    }
  }

  async function regenerate() {
    setRegenerating(true)
    try {
      const res = await api.post<{ feed_url: string }>('/dakboard-feed/regenerate')
      setFeedUrl(res.feed_url)
      setConfirmingRegenerate(false)
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <div>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 600, fontSize: 14, color: 'var(--ink-muted)', marginBottom: 4 }}>Dakboard feed</div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--ink-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        One shared link for an internal Dakboard display — not personalised per crew member. It lists every Booked job (firm commitment, not pencilled or cancelled), with only the crew who are individually Confirmed on each one.
      </div>

      <div style={{ ...settingsRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <LinkIcon size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink)', lineHeight: 1.4 }}>
            Add this link as a subscribed calendar on the Dakboard device (or any calendar app used for the same purpose).
          </div>
        </div>

        {loading && <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)' }}>Loading…</div>}

        {!loading && feedUrl && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                readOnly
                value={feedUrl}
                onFocus={(e) => e.target.select()}
                style={{ ...settingsInputStyle, background: 'var(--surface)', color: 'var(--ink-muted)', fontSize: 12.5 }}
              />
              <button onClick={copy} style={{ ...settingsCancelButtonStyle, display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div style={{ fontFamily: 'var(--font)', fontSize: 11.5, color: 'var(--ink-muted)', lineHeight: 1.4 }}>
              Calendar apps typically poll a link like this every hour or so, not instantly.
            </div>

            {!confirmingRegenerate ? (
              <button
                onClick={() => setConfirmingRegenerate(true)}
                style={{ ...settingsIconButtonStyle, width: 'fit-content', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font)', fontWeight: 600, fontSize: 12.5 }}
              >
                <RefreshCw size={13} /> Regenerate link
              </button>
            ) : (
              <div style={{ padding: 12, borderRadius: 10, background: 'var(--danger-bg)' }}>
                <div style={{ fontFamily: 'var(--font)', fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.4 }}>
                  This immediately stops the current link from working, including on the Dakboard device itself — it'll need the new link entered in its place.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button onClick={() => setConfirmingRegenerate(false)} style={settingsCancelButtonStyle}>
                    Cancel
                  </button>
                  <button
                    onClick={regenerate}
                    disabled={regenerating}
                    style={{ ...settingsPrimaryButtonStyle, background: 'var(--danger)', opacity: regenerating ? 0.7 : 1 }}
                  >
                    {regenerating ? 'Regenerating…' : 'Yes, regenerate'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

type SettingsTabKey = 'roles' | 'overtime' | 'skills' | 'vehicles' | 'dakboard'
const SETTINGS_TABS: { key: SettingsTabKey; label: string }[] = [
  { key: 'roles', label: 'Roles' },
  { key: 'overtime', label: 'Overtime rules' },
  { key: 'skills', label: 'Skills' },
  { key: 'vehicles', label: 'Vehicles' },
  { key: 'dakboard', label: 'Dakboard feed' },
]

function SettingsContent({
  roles,
  reloadRoles,
  vehicles,
  reloadVehicles,
}: {
  roles: Role[]
  reloadRoles: () => void
  vehicles: Vehicle[]
  reloadVehicles: () => void
}) {
  const [tab, setTab] = useState<SettingsTabKey>('roles')
  const { data: overtimeRules, reload: reloadOvertimeRules } = useOvertimeRules()
  const { data: skills, reload: reloadSkills } = useSkills()

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <div style={{ fontFamily: 'var(--font)', fontWeight: 700, fontSize: 24, color: 'var(--ink)', marginBottom: 4 }}>Settings</div>
      <div style={{ fontFamily: 'var(--font)', fontSize: 13, color: 'var(--ink-muted)', marginBottom: 20 }}>Reference data schedulers curate — roles, overtime rules, skills, fleet vehicles — plus the shared Dakboard feed link.</div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 20 }}>
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '8px 4px',
              marginRight: 20,
              fontFamily: 'var(--font)',
              fontWeight: 600,
              fontSize: 13,
              color: tab === t.key ? 'var(--primary)' : 'var(--ink-muted)',
              borderBottom: tab === t.key ? '2px solid var(--primary)' : '2px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 640 }}>
        {tab === 'roles' && <RolesSection roles={roles} reload={reloadRoles} />}
        {tab === 'overtime' && <OvertimeRulesSection rules={overtimeRules} reload={reloadOvertimeRules} />}
        {tab === 'skills' && <SkillsSection skills={skills} reload={reloadSkills} />}
        {tab === 'vehicles' && <VehiclesSection vehicles={vehicles} reload={reloadVehicles} />}
        {tab === 'dakboard' && <DakboardFeedSection />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root app — the only thing that owns navigation state
// ---------------------------------------------------------------------------

export function RaltoDesktopApp() {
  const [active, setActive] = useState<NavKey>('today')
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>(undefined)
  const [selectedPlannerJobId, setSelectedPlannerJobId] = useState<string | undefined>(undefined)
  const [plannerTargetReqId, setPlannerTargetReqId] = useState<string | undefined>(undefined)
  const [jobPrefill, setJobPrefill] = useState<JobCreatePrefill | undefined>(undefined)

  const { summaries, reload: reloadSummaries } = useJobSummaries()
  const { data: clientsList, reload: reloadClients } = useClients()
  const { data: venuesList, reload: reloadVenues } = useVenues()
  const { data: projectsList } = useProjects()
  const { data: rolesList, reload: reloadRoles } = useRoles()
  const { data: vehiclesList, reload: reloadVehicles } = useVehicles()
  const { data: people, reload: reloadPeople } = usePeople()
  const { data: alerts, reload: reloadAlerts } = useAlerts()

  const clients = useMemo(() => indexById(clientsList), [clientsList])
  const venues = useMemo(() => indexById(venuesList), [venuesList])

  // Testing feedback item D: Jobs and Planner both read from this same
  // summaries list (see JobsContent/PlannerContent's shared props below),
  // fetched once at mount regardless of which tab is active — same as
  // it's always been. Polling it keeps a second scheduler's new Job (or
  // newly-added crew) visible here within the interval instead of only on
  // a manual page refresh, without discarding anything: JobCreateForm
  // seeds its own local state once at mount and isn't re-derived from
  // summaries afterwards (confirmed before adding this), so a background
  // refetch here can't blow away an in-progress create/edit.
  useEffect(() => {
    const id = setInterval(reloadSummaries, 45000)
    return () => clearInterval(id)
  }, [reloadSummaries])

  const openJobFromCalendar = (jobId: string) => {
    setSelectedPlannerJobId(jobId)
    setActive('planner')
  }

  // Testing feedback item A: Today's job cards had no click handler at
  // all. Jobs (not Planner) is the natural destination here — Today's
  // list is job-scoped ("N confirmed / N required"), matching the Jobs
  // tab's own list, not a crewing action against one specific role the
  // way Calendar's openJobFromCalendar is.
  const openJobFromToday = (jobId: string) => {
    setSelectedJobId(jobId)
    setActive('jobs')
  }

  // Same handoff shape as openJobFromCalendar, extended to carry the
  // specific unfilled requirement a Jobs-screen role row was clicked for —
  // so Planner opens with that exact role selected, not just the job's
  // first unfulfilled one.
  const openRoleInPlanner = (jobId: string, reqId: string) => {
    setSelectedPlannerJobId(jobId)
    setPlannerTargetReqId(reqId)
    setActive('planner')
  }

  // Conversion is a thin layer on top of job creation (addendum v2 §3):
  // pre-fill the same form from the event's own fields and jump to Jobs.
  // client_id may be null on the event — the form just leaves that field
  // blank, since Job.client_id is required and the scheduler has to
  // supply it regardless.
  const convertEventToJob = (event: ProspectiveEvent) => {
    setJobPrefill({
      name: event.name,
      start_date: event.date_start,
      end_date: event.date_end,
      client_id: event.client_id,
      fromProspectiveEventId: event.id,
    })
    setSelectedJobId(undefined)
    setActive('jobs')
  }

  // The app shell used to be a fixed 1240x800 "card" floating on a grey
  // backdrop (a leftover from when this screen was first mocked up), which
  // left most of the browser viewport unused and made Crewing feel
  // noticeably more cramped than Equiptra's own full-viewport layout — see
  // Ric's suite-consistency feedback. It's now a real full-viewport shell:
  // height: 100vh (not minHeight) so Sidebar stays pinned and each
  // *Content screen's own flex: 1 + overflowY: 'auto' keeps scrolling
  // internally exactly as before, just filling the real window instead of
  // a fixed box. No per-screen layout logic changed — every screen already
  // sized itself with flex: 1 rather than a fixed pixel width, so they
  // reflow into the extra space on their own.
  return (
    <div style={{ height: '100vh', overflow: 'hidden', background: 'var(--surface)', display: 'flex' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        :root {
          --font: 'Inter', ui-sans-serif, system-ui, sans-serif;
          --ink: #18232E;
          --ink-muted: #667085;
          --surface: #F5F7F8;
          --line: #DCE3E7;
          --track: #EAECEF;

          --primary: #453E96;
          --primary-hover: #373178;
          --primary-soft: #6963AC;
          --primary-tint: #EDECF7;
          --primary-surface: #F7F6FC;

          --success: #2F855A;
          --success-bg: #E7F3ED;
          --attention: #A16207;
          --attention-bg: #FBF0DE;
          --danger: #B42318;
          --danger-bg: #F9E6E4;
        }
        input::placeholder { color: var(--ink-muted); opacity: 1; }
      `}</style>

      <Sidebar active={active} onSelect={setActive} />
      {active === 'today' && <TodayContent summaries={summaries} clients={clients} alerts={alerts} reloadAlerts={reloadAlerts} onOpenJob={openJobFromToday} />}
      {active === 'calendar' && <CalendarContent summaries={summaries} clients={clients} onOpenJob={openJobFromCalendar} onConvertEvent={convertEventToJob} />}
      {active === 'team' && <ResourceCalendarContent people={people} onOpenJob={openJobFromCalendar} onConvertEvent={convertEventToJob} />}
      {active === 'jobs' && (
        <JobsContent
          summaries={summaries}
          clients={clients}
          venues={venues}
          venuesList={venuesList}
          reloadVenues={reloadVenues}
          projects={projectsList}
          roles={rolesList}
          vehiclesList={vehiclesList}
          selectedId={selectedJobId}
          onSelect={setSelectedJobId}
          reloadSummaries={reloadSummaries}
          reloadClients={reloadClients}
          prefill={jobPrefill}
          onConsumedPrefill={() => setJobPrefill(undefined)}
          onOpenRoleInPlanner={openRoleInPlanner}
        />
      )}
      {active === 'planner' && (
        <PlannerContent
          summaries={summaries}
          clients={clients}
          selectedJobId={selectedPlannerJobId}
          onSelectJob={setSelectedPlannerJobId}
          reloadSummaries={reloadSummaries}
          targetReqId={plannerTargetReqId}
          onConsumedTarget={() => setPlannerTargetReqId(undefined)}
        />
      )}
      {active === 'crew' && <CrewContent people={people} roles={rolesList} reloadPeople={reloadPeople} />}
      {active === 'archive' && <ArchiveContent summaries={summaries} clients={clients} people={people} />}
      {active === 'settings' && <SettingsContent roles={rolesList} reloadRoles={reloadRoles} vehicles={vehiclesList} reloadVehicles={reloadVehicles} />}
    </div>
  )
}
