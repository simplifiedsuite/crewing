import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Calendar,
  Briefcase,
  CalendarRange,
  Bell,
  RefreshCw,
  UserPlus,
  Check,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Minus,
  ChevronLeft,
  Search,
  MapPin,
  Phone,
  CalendarDays,
  Star,
  Send,
  Users,
  LayoutGrid,
  LogOut,
  Settings,
} from 'lucide-react'
import { api } from '../../lib/api'
import { formatDate, formatDateRange } from '../../lib/format'
import { useStaffAuth } from '../../context/StaffAuthContext'
import {
  useAlerts,
  useClients,
  useVenues,
  useJobSummaries,
  usePeople,
  useCandidates,
  useBookingsForRequirement,
  useRoles,
  indexById,
  resolveAlert,
  offerBooking,
  type JobSummary,
} from '../../lib/hooks'
import type { Booking, Client, JobContact, JobRequirementWithCounts, OperationalAlert, Person, Venue } from '../../types'
// Reuses the desktop Settings screen verbatim (all four tabs — Roles,
// Overtime rules, Skills, Dakboard feed) rather than rebuilding it here —
// mobile had no way to reach Settings at all (see the "Settings" button
// next to Sign out below), and the fix should surface the same content,
// not a cut-down mobile version of it.
import { SettingsContent } from './RaltoDesktopApp'

// ---------------------------------------------------------------------------
// Ralto scheduler mobile app — merges what were ralto-today-mobile.jsx,
// ralto-calendar-mobile.jsx, ralto-jobs-mobile.jsx and
// ralto-planner-mobile.jsx into one shell with a shared bottom tab bar, the
// same approach used for RaltoDesktopApp.tsx. This is the SCHEDULER's app —
// RaltoCrewApp is a different persona and stays separate.
//
// Unlike the original prototype file, this renders full-viewport (no fake
// phone-bezel frame / fake status bar) — that chrome was for a desktop
// side-by-side demo; the real PWA fills whatever viewport it's given.
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'today', label: 'Today', icon: LayoutDashboard },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'jobs', label: 'Jobs', icon: Briefcase },
  { key: 'planner', label: 'Planner', icon: CalendarRange },
] as const

type TabKey = (typeof TABS)[number]['key']
// Settings isn't a bottom-tab (five icons is cramped on a phone) — it's
// reached via the button next to Sign out instead, same place desktop
// keeps the two together at the bottom of its own sidebar.
type ViewKey = TabKey | 'settings'

// Testing feedback Q — same fix as RaltoDesktopApp: real URL paths for the
// tab bar (and Planner's selected Job) instead of plain useState, so Back
// steps through views before leaving Crewing. No 'crew'/'team'/'archive'
// tabs exist on mobile, so unlike desktop's NAV_PATH there's no /crew
// collision to route around.
const VIEW_PATH: Record<ViewKey, string> = {
  today: '/today',
  calendar: '/calendar',
  jobs: '/jobs',
  planner: '/planner',
  settings: '/settings',
}

function viewFromPathname(pathname: string): ViewKey {
  const segment = `/${pathname.split('/')[1] ?? ''}`
  const match = (Object.entries(VIEW_PATH) as [ViewKey, string][]).find(([, path]) => path === segment)
  return match ? match[0] : 'today'
}

function jobIdFromPathname(pathname: string): string | undefined {
  const parts = pathname.split('/').filter(Boolean)
  return parts[1] || undefined
}

const FALLBACK_CLIENT_COLORS = ['#453E96', '#F4511E', '#1B3A8C', '#006C35', '#E10600', '#005C30']

function clientColor(client: Client | undefined, fallbackIndex: number): string {
  if (client?.brand_color_hex) return client.brand_color_hex
  return FALLBACK_CLIENT_COLORS[fallbackIndex % FALLBACK_CLIENT_COLORS.length]
}

function personName(people: Record<string, Person>, id: string): string {
  const p = people[id]
  return p ? `${p.first_name} ${p.last_name}` : 'Unknown'
}

// ---------------------------------------------------------------------------
// Shared drill-down: Matching (open positions) / Assigned (already filled)
// ---------------------------------------------------------------------------

function Row({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '16px 20px' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={16} color="var(--primary)" />
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--ink)', marginTop: 2 }}>{value}</div>
      </div>
    </div>
  )
}

// venueMapsQuery/venueMapsURL/VenueValue — same "open in Maps" link as the
// crew app's own (RaltoCrewApp.tsx), reused shape rather than a shared
// component since the two apps don't share components anywhere else
// either. Google's universal maps search URL, matching the crew app's
// choice. Prefers the venue's own address/city/country (already on hand
// here via useVenues() — no backend change needed, unlike the crew app's
// flattened booking response) alongside its name; falls back to just the
// name when there's no address on file, and to nothing at all when no
// venue is set, so a job with none keeps today's plain "Not set" text.
function venueMapsQuery(venue: Venue | undefined): string | undefined {
  if (!venue) return undefined
  return [venue.name, venue.address, venue.city, venue.country].filter(Boolean).join(', ')
}
function venueMapsURL(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
function VenueValue({ venue }: { venue: Venue | undefined }) {
  const query = venueMapsQuery(venue)
  if (!query || !venue) return <>Not set</>
  return (
    <a href={venueMapsURL(query)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
      {venue.name}
    </a>
  )
}

function CandidateGroup({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 20px', marginBottom: 8 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: tone }} />
        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-muted)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

function MatchingScreen({ jobName, req, onBack, onOffered }: { jobName: string; req: JobRequirementWithCounts; onBack: () => void; onOffered: () => void }) {
  const { data: pool, reload } = useCandidates(req.id)
  const [offered, setOffered] = useState<string[]>([])

  async function sendOffer(personId: string) {
    setOffered((prev) => [...prev, personId])
    await offerBooking(req.id, personId, req.start_date, req.end_date, req.call_time)
    await reload()
    onOffered()
  }

  const openLeft = req.quantity_required - req.quantity_confirmed - req.quantity_offered - offered.length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px 6px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4, color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
      </div>
      <div style={{ padding: '4px 20px 14px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>{jobName}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21, color: 'var(--ink)' }}>Find {req.role_name}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
          {openLeft} position{openLeft === 1 ? '' : 's'} still open
        </div>
      </div>

      <CandidateGroup title="Preferred" tone="var(--success)">
        {pool.suitable.length === 0 && <div style={{ padding: '0 20px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>No one in this group right now.</div>}
        {pool.suitable.map((c) => (
          <div key={c.person_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>{c.name}</span>
                {c.preferred_status === 'preferred' && <Star size={12} color="var(--primary)" fill="var(--primary)" />}
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <MapPin size={11} /> {c.base_location ?? 'Unknown'} {c.standard_rate ? `· ${c.rate_currency ?? ''}${c.standard_rate}/day` : ''}
              </div>
            </div>
            {offered.includes(c.person_id) ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: 'var(--success)' }}>
                <Check size={14} /> Offered
              </span>
            ) : (
              <button
                onClick={() => sendOffer(c.person_id)}
                style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 9, padding: '7px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Send size={12} /> Offer
              </button>
            )}
          </div>
        ))}
      </CandidateGroup>

      <CandidateGroup title="Possible" tone="var(--attention)">
        {pool.possible.length === 0 && <div style={{ padding: '0 20px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>No one in this group right now.</div>}
        {pool.possible.map((c) => (
          <div key={c.person_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>{c.name}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>{c.base_location ?? 'Unknown'}</div>
            </div>
            {offered.includes(c.person_id) ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: 'var(--success)' }}>
                <Check size={14} /> Offered
              </span>
            ) : (
              <button
                onClick={() => sendOffer(c.person_id)}
                style={{ background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, padding: '7px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', flexShrink: 0 }}
              >
                Offer
              </button>
            )}
          </div>
        ))}
      </CandidateGroup>

      {pool.conflicted.length > 0 && (
        <CandidateGroup title="Conflict — already booked" tone="var(--attention)">
          {pool.conflicted.map((c) => (
            <div key={c.person_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--line)', background: 'var(--attention-bg)' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>{c.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--attention)', marginTop: 2 }}>
                  <AlertTriangle size={11} /> Already booked on {c.conflict_job_name}
                </div>
              </div>
              {offered.includes(c.person_id) ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: 'var(--success)' }}>
                  <Check size={14} /> Offered
                </span>
              ) : (
                <button
                  onClick={() => sendOffer(c.person_id)}
                  style={{ background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 9, padding: '7px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer', flexShrink: 0 }}
                >
                  Offer anyway
                </button>
              )}
            </div>
          ))}
        </CandidateGroup>
      )}

      <CandidateGroup title="Unavailable" tone="var(--danger)">
        {pool.unavailable.map((c) => (
          <div key={c.person_id} style={{ padding: '12px 20px', borderTop: '1px solid var(--line)', opacity: 0.6 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>{c.name}</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>{c.reason}</div>
          </div>
        ))}
      </CandidateGroup>

      <div style={{ height: 40 }} />
    </div>
  )
}

function AssignedScreen({ jobName, req, people, onBack }: { jobName: string; req: JobRequirementWithCounts; people: Record<string, Person>; onBack: () => void }) {
  const { data: bookings } = useBookingsForRequirement(req.id)
  const confirmed = bookings.filter((b) => b.status === 'confirmed')
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px 6px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4, color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
      </div>
      <div style={{ padding: '4px 20px 14px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>{jobName}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21, color: 'var(--ink)' }}>{req.role_name} — fully crewed</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Check size={14} /> {req.quantity_confirmed}/{req.quantity_required} confirmed
        </div>
      </div>
      {confirmed.map((b, i) => (
        <div key={b.id}>
          <div style={{ padding: '13px 20px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--ink)' }}>{personName(people, b.person_id)}</div>
          {i < confirmed.length - 1 && <div style={{ height: 1, background: 'var(--line)', margin: '0 20px' }} />}
        </div>
      ))}
      <div style={{ height: 40 }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function isLiveToday(job: JobSummary['job']): boolean {
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

function StatBlock({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '10px 12px' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, fontVariantNumeric: 'tabular-nums', color: tone || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--ink-muted)', marginTop: 5, lineHeight: 1.3 }}>{label}</div>
    </div>
  )
}

function AttentionCard({ alert, onResolve }: { alert: OperationalAlert; onResolve: (id: string) => void }) {
  const copy = ALERT_COPY[alert.type]
  const Icon = copy.icon
  const tone = toneColor[copy.tone]
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: '#fff', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: 999, background: tone.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={15} color={tone.fg} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14.5, color: 'var(--ink)' }}>{copy.title}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 2, lineHeight: 1.4 }}>{alert.job_name}</div>
        <button
          onClick={() => onResolve(alert.id)}
          style={{ marginTop: 10, background: 'none', border: '1px solid var(--line)', borderRadius: 9, padding: '6px 11px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          {copy.actionLabel} <Check size={12} />
        </button>
      </div>
    </div>
  )
}

function TodayContent({ summaries, clients, alerts, reloadAlerts, onOpenJob }: { summaries: JobSummary[]; clients: Record<string, Client>; alerts: OperationalAlert[]; reloadAlerts: () => void; onOpenJob: (id: string) => void }) {
  const { user } = useStaffAuth()
  const liveSummaries = useMemo(() => summaries.filter((s) => isLiveToday(s.job)), [summaries])
  const totalRequired = liveSummaries.reduce((sum, s) => sum + s.required, 0)
  const totalConfirmed = liveSummaries.reduce((sum, s) => sum + s.confirmed, 0)

  async function resolve(id: string) {
    await resolveAlert(id)
    reloadAlerts()
  }

  return (
    <div>
      <div style={{ padding: '20px 20px 4px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-muted)' }}>Hello, {user?.name.split(' ')[0]}</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, color: 'var(--ink)' }}>Today</div>
      </div>

      <div style={{ display: 'flex', padding: '18px 20px', gap: 8 }}>
        <StatBlock value={liveSummaries.length} label="Jobs live" />
        <StatBlock value={totalRequired} label="Crew needed" />
        <StatBlock value={totalConfirmed} label="Confirmed & ready" tone={totalConfirmed === totalRequired && totalRequired > 0 ? 'var(--success)' : 'var(--attention)'} />
      </div>

      <div style={{ margin: '10px 20px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-muted)' }}>Needs attention</div>

      {alerts.length > 0 ? (
        <div style={{ padding: '10px 20px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {alerts.map((alert) => (
            <AttentionCard key={alert.id} alert={alert} onResolve={resolve} />
          ))}
        </div>
      ) : (
        <div style={{ margin: '10px 20px 0', padding: '22px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: 'var(--success-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Check size={16} color="var(--success)" />
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>All crew covered</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>No action required.</div>
        </div>
      )}

      <div style={{ margin: '28px 20px 8px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-muted)' }}>Today's jobs</div>
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {liveSummaries.length === 0 && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>No jobs running today.</div>}
        {liveSummaries.map((s, i) => {
          const complete = s.confirmed === s.required && s.required > 0
          const client = clients[s.job.client_id]
          const color = complete ? 'var(--success)' : 'var(--attention)'
          return (
            <button
              key={s.job.id}
              onClick={() => onOpenJob(s.job.id)}
              style={{ position: 'relative', width: '100%', textAlign: 'left', border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '12px 14px 12px 18px', overflow: 'hidden', cursor: 'pointer' }}
            >
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: clientColor(client, i) }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.job.name}</div>
              </div>
              <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, color, marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
                {s.confirmed}/{s.required} confirmed
              </div>
            </button>
          )
        })}
      </div>
      <div style={{ height: 30 }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

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
function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function addWeeks(date: Date, n: number): Date {
  return addDays(date, n * 7)
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

interface CalendarJob {
  id: string
  name: string
  clientName: string
  clientColor: string
  start: string
  end: string
  confirmed: number
  required: number
}

function DayCell({ date, inMonth, isToday, isSelected, jobs, onSelect }: { date: Date; inMonth: boolean; isToday: boolean; isSelected: boolean; jobs: CalendarJob[]; onSelect: (d: Date) => void }) {
  return (
    <button onClick={() => onSelect(date)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: inMonth ? 1 : 0.35 }}>
      <span
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: isToday || isSelected ? 700 : 500,
          color: isSelected ? '#fff' : isToday ? 'var(--primary)' : 'var(--ink)',
          background: isSelected ? 'var(--primary)' : 'transparent',
        }}
      >
        {date.getDate()}
      </span>
      <div style={{ display: 'flex', gap: 2, height: 5 }}>
        {jobs.slice(0, 3).map((j) => (
          <span key={j.id} style={{ width: 5, height: 5, borderRadius: '50%', background: j.clientColor }} />
        ))}
      </div>
    </button>
  )
}

function AgendaCard({ job, onOpen }: { job: CalendarJob; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(job.id)} style={{ position: 'relative', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px 12px 18px', marginBottom: 10, cursor: 'pointer', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: job.clientColor }} />
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{job.name}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 2 }}>{job.clientName}</div>
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, color: job.confirmed === job.required ? 'var(--success)' : 'var(--attention)', marginTop: 6 }}>
        {job.confirmed}/{job.required} confirmed
      </div>
    </button>
  )
}

// Continuous-scroll tuning — same treatment the desktop app's own
// Calendar/Team views got (CC/DD): the old Month/Week toggle here only
// ever changed how many weeks were visible per "page" (a full month grid
// vs exactly one week), paginated with prev/next. Once scrolling itself is
// continuous, that distinction is gone — there's no fixed page size left
// for "week" to be a smaller alternative to, and DayCell has no separate
// density mode the way desktop's WeekRow does (it's always just dots), so
// the toggle is dropped entirely rather than kept as a no-op. Radius/
// expand/threshold are smaller than desktop's own tuning to match a
// phone's much shorter viewport.
const MOBILE_CAL_INITIAL_RADIUS_WEEKS = 6
const MOBILE_CAL_EXPAND_WEEKS = 6
const MOBILE_CAL_EDGE_THRESHOLD_PX = 400
// The weeks grid gets its own fixed-height, independently-scrollable box
// (unlike desktop, mobile's Calendar has a separate agenda section below
// the grid that needs to stay in the normal page flow, not scroll away
// inside the same virtualized region) — enough rows to always show the
// current week plus a little context either side.
const MOBILE_CAL_GRID_HEIGHT = 340

function CalendarContent({ summaries, clients, onOpenJob }: { summaries: JobSummary[]; clients: Record<string, Client>; onOpenJob: (id: string) => void }) {
  const today = useMemo(() => new Date(), [])
  const todayWeekStart = useMemo(() => startOfWeek(today), [today])
  const [rangeStart, setRangeStart] = useState(() => addWeeks(todayWeekStart, -MOBILE_CAL_INITIAL_RADIUS_WEEKS))
  const [rangeEnd, setRangeEnd] = useState(() => addWeeks(todayWeekStart, MOBILE_CAL_INITIAL_RADIUS_WEEKS))
  const [selectedDate, setSelectedDate] = useState(today)

  // Deleted jobs drop off the Calendar same as every other normal view —
  // matches desktop's own CalendarContent (which otherwise shows every
  // status here, unlike Jobs/Planner which already exclude Complete). This
  // was missing on mobile: a cancelled+deleted job (e.g. a disposable test
  // job) still showed here with live confirmed/required counts.
  const calendarJobs: CalendarJob[] = useMemo(
    () =>
      summaries
        .filter((s) => !s.job.deleted_at)
        .map((s, i) => ({
          id: s.job.id,
          name: s.job.name,
          clientName: clients[s.job.client_id]?.name ?? 'Unknown client',
          clientColor: clientColor(clients[s.job.client_id], i),
          start: s.job.start_date,
          end: s.job.end_date,
          confirmed: s.confirmed,
          required: s.required,
        })),
    [summaries, clients],
  )

  function jobsOnDate(date: Date): CalendarJob[] {
    const iso = toISODate(date)
    return calendarJobs.filter((j) => j.start <= iso && iso <= j.end)
  }

  // The full continuous run of weeks currently rendered — grows via
  // handleScroll below as the grid's own scroller nears either edge.
  const weekStarts = useMemo(() => {
    const out: Date[] = []
    let cursor = rangeStart
    while (cursor <= rangeEnd) {
      out.push(cursor)
      cursor = addWeeks(cursor, 1)
    }
    return out
  }, [rangeStart, rangeEnd])

  const scrollRef = useRef<HTMLDivElement>(null)
  const todayRowRef = useRef<HTMLDivElement>(null)
  const monthDividerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollHeightBeforeRef = useRef(0)
  const pendingCompensationRef = useRef(false)
  // See RaltoDesktopApp.tsx's CalendarContent for the full write-up on why
  // both of the guards below exist — same live-tested bugs, same fixes,
  // just re-tuned for this grid's own smaller scale.
  const expandingTopRef = useRef(false)
  const expandingBottomRef = useRef(false)
  const suppressScrollHandlingRef = useRef(false)
  const [visibleMonthLabel, setVisibleMonthLabel] = useState(`${MONTH_LABELS[todayWeekStart.getMonth()]} ${todayWeekStart.getFullYear()}`)

  function handleScroll() {
    const el = scrollRef.current
    if (!el || suppressScrollHandlingRef.current) return
    if (el.scrollTop < MOBILE_CAL_EDGE_THRESHOLD_PX && !expandingTopRef.current) {
      expandingTopRef.current = true
      scrollHeightBeforeRef.current = el.scrollHeight
      pendingCompensationRef.current = true
      setRangeStart((d) => addWeeks(d, -MOBILE_CAL_EXPAND_WEEKS))
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < MOBILE_CAL_EDGE_THRESHOLD_PX && !expandingBottomRef.current) {
      expandingBottomRef.current = true
      setRangeEnd((d) => addWeeks(d, MOBILE_CAL_EXPAND_WEEKS))
    }

    const containerTop = el.getBoundingClientRect().top
    let current = visibleMonthLabel
    let bestTop = -Infinity
    for (const [key, node] of monthDividerRefs.current) {
      const top = node.getBoundingClientRect().top - containerTop
      if (top <= 20 && top > bestTop) {
        bestTop = top
        current = key
      }
    }
    if (current !== visibleMonthLabel) setVisibleMonthLabel(current)
  }

  useLayoutEffect(() => {
    expandingTopRef.current = false
    if (!pendingCompensationRef.current) return
    pendingCompensationRef.current = false
    const el = scrollRef.current
    if (!el) return
    el.scrollTop += el.scrollHeight - scrollHeightBeforeRef.current
  }, [rangeStart])

  useEffect(() => {
    expandingBottomRef.current = false
  }, [rangeEnd])

  function scrollToToday() {
    suppressScrollHandlingRef.current = true
    todayRowRef.current?.scrollIntoView({ block: 'start' })
    setVisibleMonthLabel(`${MONTH_LABELS[todayWeekStart.getMonth()]} ${todayWeekStart.getFullYear()}`)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        suppressScrollHandlingRef.current = false
      }),
    )
  }

  // Waits for summaries to have actually loaded (fetched async at the app
  // root) before the initial auto-scroll — see RaltoDesktopApp.tsx's own
  // version of this fix for the live-tested reflow bug it closes off.
  const hasAutoScrolledRef = useRef(false)
  useEffect(() => {
    if (hasAutoScrolledRef.current || calendarJobs.length === 0) return
    hasAutoScrolledRef.current = true
    scrollToToday()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarJobs])

  const agenda = jobsOnDate(selectedDate)

  return (
    <div>
      <div style={{ padding: '20px 20px 4px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, color: 'var(--ink)' }}>Calendar</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 6px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{visibleMonthLabel}</div>
        <button onClick={scrollToToday} style={{ background: 'var(--tint)', border: 'none', borderRadius: 8, padding: '6px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--primary)', cursor: 'pointer' }}>
          Today
        </button>
      </div>

      <div style={{ padding: '8px 16px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
          {WEEKDAY_LETTERS.map((d, i) => (
            <div key={i} style={{ textAlign: 'center', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 11, color: 'var(--ink-muted)' }}>
              {d}
            </div>
          ))}
        </div>
        <div ref={scrollRef} onScroll={handleScroll} style={{ height: MOBILE_CAL_GRID_HEIGHT, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, marginTop: 4 }}>
          {weekStarts.map((weekStart) => {
            const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
            const isTodayWeek = sameDay(weekStart, todayWeekStart)
            // A month divider renders right before the week containing that
            // month's 1st — same "exactly once, never duplicated" idea
            // desktop's own CalendarContent uses.
            const monthBoundary = weekDates.find((d) => d.getDate() === 1)
            return (
              <div key={weekStart.toISOString()}>
                {monthBoundary && (
                  <div
                    ref={(node) => {
                      const key = `${MONTH_LABELS[monthBoundary.getMonth()]} ${monthBoundary.getFullYear()}`
                      if (node) monthDividerRefs.current.set(key, node)
                      else monthDividerRefs.current.delete(key)
                    }}
                    style={{ padding: '4px 8px', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 11, color: 'var(--ink)', background: 'var(--tint)' }}
                  >
                    {MONTH_LABELS[monthBoundary.getMonth()]} {monthBoundary.getFullYear()}
                  </div>
                )}
                <div
                  ref={(node) => {
                    if (isTodayWeek) todayRowRef.current = node
                  }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}
                >
                  {weekDates.map((date) => (
                    <DayCell key={date.toISOString()} date={date} inMonth={true} isToday={sameDay(date, today)} isSelected={sameDay(date, selectedDate)} jobs={jobsOnDate(date)} onSelect={setSelectedDate} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ margin: '20px 20px 10px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-muted)' }}>
        {selectedDate.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
      <div style={{ padding: '0 20px' }}>
        {agenda.length > 0 ? agenda.map((job) => <AgendaCard key={job.id} job={job} onOpen={onOpenJob} />) : <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', padding: '8px 0 20px' }}>No jobs scheduled.</div>}
      </div>
      <div style={{ height: 30 }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

function urgencyFor(summary: JobSummary) {
  const unfilled = summary.required - summary.confirmed - summary.offered
  if (unfilled <= 0 && summary.required > 0) return { tier: 'complete', color: 'var(--success)', bg: 'var(--success-bg)', Icon: CheckCircle2 }
  const daysUntilStart = Math.ceil((new Date(summary.job.start_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  if (daysUntilStart <= 5) return { tier: 'critical', color: 'var(--danger)', bg: 'var(--danger-bg)', Icon: AlertTriangle }
  if (daysUntilStart <= 30) return { tier: 'attention', color: 'var(--attention)', bg: 'var(--attention-bg)', Icon: Clock }
  return { tier: 'quiet', color: 'var(--ink-muted)', bg: 'var(--track)', Icon: Minus }
}

function statusLabel(summary: JobSummary): string {
  const unfilled = summary.required - summary.confirmed - summary.offered
  const u = urgencyFor(summary)
  if (u.tier === 'complete') return 'Complete'
  if (u.tier === 'critical') return `Attention required · ${unfilled} unfilled`
  if (u.tier === 'attention') return `${unfilled} unfilled`
  return summary.confirmed === 0 ? 'Not yet crewed' : `${unfilled} unfilled · plenty of time`
}

function JobRow({ summary, client, fallbackIndex, onOpen }: { summary: JobSummary; client: Client | undefined; fallbackIndex: number; onOpen: (id: string) => void }) {
  const u = urgencyFor(summary)
  const quiet = u.tier === 'complete' || u.tier === 'quiet'
  const pct = summary.required > 0 ? (summary.confirmed / summary.required) * 100 : 0
  const StatusIcon = u.Icon

  return (
    <button onClick={() => onOpen(summary.job.id)} style={{ position: 'relative', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px 12px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: clientColor(client, fallbackIndex), opacity: quiet ? 0.6 : 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14.5, color: quiet ? 'var(--ink-muted)' : 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary.job.name}</span>
          <span style={{ fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 13, color: u.color, flexShrink: 0 }}>
            {summary.confirmed}/{summary.required}
          </span>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 2 }}>
          {formatDateRange(summary.job.start_date, summary.job.end_date)}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <div style={{ flex: 1, height: 5, borderRadius: 999, background: 'var(--track)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: u.tier === 'quiet' ? 'var(--ink-muted)' : u.color, opacity: quiet ? 0.5 : 1 }} />
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: u.color, marginTop: 6, fontWeight: u.tier === 'complete' ? 400 : 600 }}>{statusLabel(summary)}</div>
      </div>
      <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: u.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <StatusIcon size={14} color={u.color} strokeWidth={2.5} />
      </div>
    </button>
  )
}

function RoleRow({ req, onOpen }: { req: JobRequirementWithCounts; onOpen: (req: JobRequirementWithCounts) => void }) {
  const unfilled = req.quantity_required - req.quantity_confirmed - req.quantity_offered
  const pct = req.quantity_required > 0 ? (req.quantity_confirmed / req.quantity_required) * 100 : 0
  const complete = unfilled <= 0
  const StatusIcon = complete ? CheckCircle2 : req.quantity_offered > 0 ? Clock : AlertTriangle
  const statusColor = complete ? 'var(--success)' : 'var(--attention)'
  const statusBg = complete ? 'var(--success-bg)' : 'var(--attention-bg)'
  return (
    <button onClick={() => onOpen(req)} style={{ width: '100%', textAlign: 'left', background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>{req.role_name}</span>
          <span style={{ fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600, color: unfilled > 0 ? 'var(--attention)' : 'var(--ink-muted)' }}>
            {req.quantity_confirmed}/{req.quantity_required}
          </span>
        </div>
        <div style={{ height: 5, borderRadius: 999, background: 'var(--track)', overflow: 'hidden', marginTop: 8 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: unfilled > 0 ? 'var(--attention)' : 'var(--success)' }} />
        </div>
        {req.quantity_offered > 0 && <div style={{ fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--attention)', marginTop: 6 }}>{req.quantity_offered} offered</div>}
      </div>
      <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: statusBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <StatusIcon size={13} color={statusColor} strokeWidth={2.5} />
      </div>
    </button>
  )
}

function JobOverview({ summary, client, venue, contact, onBack, onOpenRole }: { summary: JobSummary; client: Client | undefined; venue: Venue | undefined; contact: string; onBack: () => void; onOpenRole: (req: JobRequirementWithCounts) => void }) {
  const unfilled = summary.required - summary.confirmed - summary.offered
  const u = urgencyFor(summary)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px 6px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4, color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
      </div>
      <div style={{ padding: '4px 20px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: clientColor(client, 0), flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>{client?.name ?? 'Unknown client'}</span>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: 'var(--ink)', lineHeight: 1.2 }}>{summary.job.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, padding: '4px 10px', borderRadius: 999, color: u.color, background: u.bg }}>{unfilled === 0 ? 'Complete' : statusLabel(summary)}</span>
        </div>
      </div>
      <div style={{ height: 1, background: 'var(--line)', margin: '0 20px' }} />
      <Row icon={CalendarDays} label="Dates" value={formatDateRange(summary.job.start_date, summary.job.end_date)} />
      <div style={{ height: 1, background: 'var(--line)', margin: '0 20px' }} />
      <Row icon={MapPin} label="Venue" value={<VenueValue venue={venue} />} />
      <div style={{ height: 1, background: 'var(--line)', margin: '0 20px' }} />
      <Row icon={Phone} label="Production contact" value={contact} />
      <div style={{ margin: '24px 20px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-muted)' }}>Crewing by role</span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
          {summary.confirmed}/{summary.required} total
        </span>
      </div>
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {summary.requirements.map((r) => (
          <RoleRow key={r.id} req={r} onOpen={onOpenRole} />
        ))}
        {summary.requirements.length === 0 && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>No role requirements added yet.</div>}
      </div>
      <div style={{ margin: '18px 20px 0', fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-muted)', lineHeight: 1.5 }}>Tap a role to find crew for open positions, or see who's already assigned.</div>
      <div style={{ height: 40 }} />
    </div>
  )
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Attention' },
  { key: 'complete', label: 'Complete' },
] as const

// Shared by both the Jobs tab and Planner: once a role is tapped, decide
// whether to show the open-positions matcher or the already-filled list.
function RoleDrilldown({ jobName, req, people, onBack, onOffered }: { jobName: string; req: JobRequirementWithCounts; people: Record<string, Person>; onBack: () => void; onOffered: () => void }) {
  const openSlots = req.quantity_required - req.quantity_confirmed - req.quantity_offered
  if (openSlots > 0) {
    return <MatchingScreen jobName={jobName} req={req} onBack={onBack} onOffered={onOffered} />
  }
  return <AssignedScreen jobName={jobName} req={req} people={people} onBack={onBack} />
}

function JobsContent({ summaries, clients, venues, people, reloadSummaries }: { summaries: JobSummary[]; clients: Record<string, Client>; venues: Record<string, Venue>; people: Record<string, Person>; reloadSummaries: () => void }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const [openRole, setOpenRole] = useState<JobRequirementWithCounts | null>(null)
  const [contacts, setContacts] = useState<JobContact[]>([])

  const openJob = summaries.find((s) => s.job.id === openJobId) ?? null

  useEffect(() => {
    if (!openJob) return
    api.get<JobContact[]>(`/jobs/${openJob.job.id}/contacts`).then(setContacts).catch(() => setContacts([]))
  }, [openJob?.job.id])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    // Deleted jobs (always cancelled, never complete — see
    // migrations/0016) are excluded here regardless of which filter tab
    // is active, same as desktop drops them everywhere except Archive.
    // Unlike desktop's own JobsContent, Complete jobs are deliberately
    // NOT excluded at this level — mobile has no separate Archive screen,
    // so the "Complete" filter tab below is this list's only way to reach
    // them. Missing the deleted_at exclusion let cancelled+deleted test
    // jobs show up with live "unfilled"/"attention" badges as if still open.
    let list = summaries
      .filter((s) => !s.job.deleted_at)
      .filter((s) => s.job.name.toLowerCase().includes(q) || (clients[s.job.client_id]?.name ?? '').toLowerCase().includes(q))
    if (filter === 'attention') list = list.filter((s) => ['critical', 'attention'].includes(urgencyFor(s).tier))
    else if (filter === 'complete') list = list.filter((s) => urgencyFor(s).tier === 'complete')
    const rank: Record<string, number> = { critical: 0, attention: 1, quiet: 2, complete: 3 }
    return [...list].sort((a, b) => rank[urgencyFor(a).tier] - rank[urgencyFor(b).tier])
  }, [summaries, clients, query, filter])

  if (openJob && openRole) {
    return (
      <RoleDrilldown
        jobName={openJob.job.name}
        req={openRole}
        people={people}
        onBack={() => setOpenRole(null)}
        onOffered={() => {
          setOpenRole(null)
          reloadSummaries()
        }}
      />
    )
  }

  if (openJob) {
    const venue = openJob.job.venue_id ? venues[openJob.job.venue_id] : undefined
    const primary = contacts[0]
    return (
      <JobOverview
        summary={openJob}
        client={clients[openJob.job.client_id]}
        venue={venue}
        contact={primary ? `${primary.name}${primary.phone ? ' · ' + primary.phone : ''}` : 'Not yet assigned'}
        onBack={() => setOpenJobId(null)}
        onOpenRole={setOpenRole}
      />
    )
  }

  return (
    <div>
      <div style={{ padding: '20px 20px 4px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 24, color: 'var(--ink)' }}>Jobs</div>
      </div>
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--track)', borderRadius: 10, padding: '9px 12px' }}>
          <Search size={15} color="var(--ink-muted)" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search jobs or clients" style={{ border: 'none', background: 'none', outline: 'none', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', flex: 1 }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '14px 20px 6px' }}>
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{ background: active ? 'var(--primary)' : 'var(--track)', color: active ? '#fff' : 'var(--ink-muted)', border: 'none', borderRadius: 999, padding: '6px 14px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>
              {f.label}
            </button>
          )
        })}
      </div>
      <div style={{ marginTop: 6, padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.map((s, i) => (
          <JobRow key={s.job.id} summary={s} client={clients[s.job.client_id]} fallbackIndex={i} onOpen={setOpenJobId} />
        ))}
        {filtered.length === 0 && <div style={{ padding: '30px 0', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--ink-muted)' }}>No jobs match.</div>}
      </div>
      <div style={{ height: 40 }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

function completeness(reqs: JobRequirementWithCounts[]) {
  const required = reqs.reduce((s, r) => s + r.quantity_required, 0)
  const confirmed = reqs.reduce((s, r) => s + r.quantity_confirmed, 0)
  const unfilled = required - confirmed - reqs.reduce((s, r) => s + r.quantity_offered, 0)
  return { required, confirmed, unfilled }
}

function JobChip({ summary, client, fallbackIndex, active, onClick }: { summary: JobSummary; client: Client | undefined; fallbackIndex: number; active: boolean; onClick: () => void }) {
  const { required, confirmed } = completeness(summary.requirements)
  const complete = confirmed === required && required > 0
  return (
    <button onClick={onClick} style={{ position: 'relative', flexShrink: 0, background: active ? 'var(--primary)' : '#fff', border: active ? 'none' : '1px solid var(--line)', borderRadius: 14, padding: '10px 14px 10px 18px', textAlign: 'left', cursor: 'pointer', minWidth: 148, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: clientColor(client, fallbackIndex), opacity: active ? 0.85 : 1 }} />
      <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13.5, color: active ? '#fff' : 'var(--ink)' }}>{summary.job.name}</div>
      {/* Same tile-date fix as the desktop Planner's JobChip — collapsed to
          a single date for a single-day job. */}
      <div style={{ fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontSize: 11.5, marginTop: 2, color: active ? 'rgba(255,255,255,0.7)' : 'var(--ink-muted)' }}>
        {summary.job.start_date === summary.job.end_date
          ? formatDate(summary.job.start_date)
          : `${formatDate(summary.job.start_date)} – ${formatDate(summary.job.end_date)}`}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontSize: 12, marginTop: 3, color: active ? 'rgba(255,255,255,0.85)' : complete ? 'var(--success)' : 'var(--attention)', fontWeight: 600 }}>
        {confirmed}/{required} confirmed
      </div>
    </button>
  )
}

// The requirements list already carries counts, not member lists — for a
// "who's on this job" view, this fetches actual booking rows per
// requirement (small N, fine at Phase 1's scale) rather than adding a
// job-level members endpoint yet.
function PeopleTab({ summary, people }: { summary: JobSummary; people: Record<string, Person> }) {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    Promise.all(summary.requirements.map((r) => api.get<Booking[]>(`/job-requirements/${r.id}/bookings`))).then((results) => {
      if (cancelled) return
      const ids = new Set<string>()
      for (const bookings of results) {
        for (const b of bookings) {
          if (b.status === 'confirmed') ids.add(b.person_id)
        }
      }
      setNames([...ids].map((id) => personName(people, id)))
    })
    return () => {
      cancelled = true
    }
  }, [summary, people])

  return (
    <div>
      <div style={{ padding: '18px 20px 4px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>
        {names.length} people currently on {summary.job.name}
      </div>
      {names.map((name, i) => (
        <div key={name + i}>
          <div style={{ padding: '13px 20px', fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--ink)' }}>{name}</div>
          {i < names.length - 1 && <div style={{ height: 1, background: 'var(--line)', margin: '0 20px' }} />}
        </div>
      ))}
    </div>
  )
}

function PlannerContent({ summaries, clients, people, selectedJobId, onSelectJob, reloadSummaries }: { summaries: JobSummary[]; clients: Record<string, Client>; people: Record<string, Person>; selectedJobId: string | undefined; onSelectJob: (id: string) => void; reloadSummaries: () => void }) {
  const [detailReq, setDetailReq] = useState<JobRequirementWithCounts | null>(null)
  const [view, setView] = useState<'roles' | 'people'>('roles')
  // Same exclusion as desktop's own PlannerContent — Complete jobs are
  // done crewing, and deleted (always-cancelled) jobs shouldn't be
  // crewable at all. Missing here let cancelled+deleted test jobs show
  // up as a selectable tile with live "unfilled" role counts.
  const activeSummaries = useMemo(() => summaries.filter((s) => s.job.status !== 'complete' && !s.job.deleted_at), [summaries])
  const summary = activeSummaries.find((s) => s.job.id === selectedJobId) ?? activeSummaries[0]

  useEffect(() => {
    setDetailReq(null)
    setView('roles')
  }, [selectedJobId])

  if (!summary) {
    return <div style={{ padding: 32, fontFamily: 'var(--font-body)', color: 'var(--ink-muted)' }}>No jobs yet — create one to get started.</div>
  }

  const { required, confirmed, unfilled } = completeness(summary.requirements)

  if (detailReq) {
    return (
      <RoleDrilldown
        jobName={summary.job.name}
        req={detailReq}
        people={people}
        onBack={() => setDetailReq(null)}
        onOffered={() => {
          setDetailReq(null)
          reloadSummaries()
        }}
      />
    )
  }

  return (
    <div>
      <div style={{ padding: '20px 20px 4px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>Planner</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 21, color: 'var(--ink)' }}>{summary.job.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: clientColor(clients[summary.job.client_id], 0), flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>{formatDateRange(summary.job.start_date, summary.job.end_date)}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '16px 20px 4px', overflowX: 'auto' }}>
        {activeSummaries.map((s, i) => (
          <JobChip key={s.job.id} summary={s} client={clients[s.job.client_id]} fallbackIndex={i} active={s.job.id === summary.job.id} onClick={() => onSelectJob(s.job.id)} />
        ))}
      </div>

      <div style={{ padding: '18px 20px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 19, color: unfilled > 0 ? 'var(--attention)' : 'var(--success)' }}>
            {confirmed}/{required}
          </span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginLeft: 6 }}>{unfilled > 0 ? `${unfilled} unfilled` : 'Fully crewed'}</span>
        </div>
        <div style={{ display: 'flex', background: 'var(--track)', borderRadius: 10, padding: 3 }}>
          {(
            [
              { key: 'roles', icon: LayoutGrid, label: 'Roles' },
              { key: 'people', icon: Users, label: 'People' },
            ] as const
          ).map((t) => {
            const Icon = t.icon
            const active = view === t.key
            return (
              <button key={t.key} onClick={() => setView(t.key)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: active ? '#fff' : 'none', border: 'none', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, color: active ? 'var(--ink)' : 'var(--ink-muted)' }}>
                <Icon size={13} /> {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {view === 'roles' ? (
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {summary.requirements.map((req) => (
            <RoleRow key={req.id} req={req} onOpen={setDetailReq} />
          ))}
          {summary.requirements.length === 0 && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>No role requirements added yet.</div>}
        </div>
      ) : (
        <PeopleTab summary={summary} people={people} />
      )}
      <div style={{ height: 40 }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root app — shared bottom tab bar + lifted state for the Calendar → Planner
// jump, matching RaltoDesktopApp.tsx.
// ---------------------------------------------------------------------------

export function RaltoMobileApp() {
  const location = useLocation()
  const navigate = useNavigate()
  const view = viewFromPathname(location.pathname)
  const selectedPlannerJobId = view === 'planner' ? jobIdFromPathname(location.pathname) : undefined
  const { logout } = useStaffAuth()

  useEffect(() => {
    if (location.pathname === '/') navigate(VIEW_PATH.today, { replace: true })
  }, [location.pathname, navigate])

  const selectView = (key: ViewKey) => {
    if (key !== view) navigate(VIEW_PATH[key])
  }

  const { summaries, reload: reloadSummaries } = useJobSummaries()
  const { data: clientsList } = useClients()
  const { data: venuesList } = useVenues()
  const { data: peopleList } = usePeople()
  const { data: alerts, reload: reloadAlerts } = useAlerts()
  const { data: rolesList, reload: reloadRoles } = useRoles()

  const clients = useMemo(() => indexById(clientsList), [clientsList])
  const venues = useMemo(() => indexById(venuesList), [venuesList])
  const people = useMemo(() => indexById(peopleList), [peopleList])

  const openJobInPlanner = (jobId: string) => {
    navigate(`${VIEW_PATH.planner}/${jobId}`)
  }

  return (
    <div className="dvh-shell" style={{ background: '#fff', fontFamily: 'var(--font-body)', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        :root {
          --font-display: 'Inter', sans-serif;
          --font-body: 'Inter', sans-serif;
          --ink: #211D2E;
          --ink-muted: #6E6A7C;
          --bg: #FFFFFF;
          --primary: #453E96;
          --tint: #EEEBFA;
          --track: #F1F0EE;
          --line: #E7E5E2;
          --success: #3F8F6D;
          --success-bg: #EAF4EF;
          --attention: #C98A2B;
          --attention-bg: #FBF1E1;
          --danger: #B5473C;
          --danger-bg: #F8EBE9;
        }
        input::placeholder { color: var(--ink-muted); opacity: 1; }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16, padding: '10px 20px 0' }}>
        {/* Settings has no bottom-tab icon (five is cramped on a phone) —
            this is the mobile equivalent of desktop's sidebar, which keeps
            Settings right next to Sign out too. Everything that lives in
            Settings (the Dakboard/iCal feed link included) was otherwise
            unreachable on mobile. */}
        <button
          onClick={() => selectView('settings')}
          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: view === 'settings' ? 'var(--primary)' : 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
        >
          <Settings size={13} /> Settings
        </button>
        <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          <LogOut size={13} /> Sign out
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {view === 'today' && <TodayContent summaries={summaries} clients={clients} alerts={alerts} reloadAlerts={reloadAlerts} onOpenJob={openJobInPlanner} />}
        {view === 'calendar' && <CalendarContent summaries={summaries} clients={clients} onOpenJob={openJobInPlanner} />}
        {view === 'jobs' && <JobsContent summaries={summaries} clients={clients} venues={venues} people={people} reloadSummaries={reloadSummaries} />}
        {view === 'planner' && (
          <PlannerContent
            summaries={summaries}
            clients={clients}
            people={people}
            selectedJobId={selectedPlannerJobId}
            onSelectJob={(id) => navigate(`${VIEW_PATH.planner}/${id}`)}
            reloadSummaries={reloadSummaries}
          />
        )}
        {view === 'settings' && <SettingsContent roles={rolesList} reloadRoles={reloadRoles} />}
      </div>

      <div style={{ display: 'flex', borderTop: '1px solid var(--line)', background: '#fff', padding: '10px 0 16px' }}>
        {TABS.map((t) => {
          const Icon = t.icon
          const active = view === t.key
          return (
            <button key={t.key} onClick={() => selectView(t.key)} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <Icon size={20} color={active ? 'var(--primary)' : 'var(--ink-muted)'} />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, color: active ? 'var(--primary)' : 'var(--ink-muted)' }}>{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
