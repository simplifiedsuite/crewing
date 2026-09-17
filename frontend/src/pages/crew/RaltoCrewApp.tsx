import { useEffect, useMemo, useState } from 'react'
import { Home as HomeIcon, CalendarCheck, User, ChevronLeft, MapPin, Phone, Mail, Pencil, FileText, Bell, Check, CheckCircle2, Clock, X, CalendarDays, ChevronRight, Link as LinkIcon, Copy, RefreshCw, Car } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import { formatTime } from '../../lib/format'
import { useCrewAuth } from '../../context/CrewAuthContext'
import type { AvailabilityRequest, AvailabilityResponseValue, CrewBooking, JobContact, OperationalAlert, Person, PersonDocument } from '../../types'

// ---------------------------------------------------------------------------
// Ralto crew app — converted from ralto-crew-mobile.jsx. Renders
// full-viewport (no fake phone-bezel/status-bar chrome — that was for the
// desktop-side-by-side demo; the real PWA fills whatever viewport it's
// given, same adjustment made for RaltoMobileApp.tsx).
//
// Simplification vs. the prototype: JobDetail's Travel/Hotel/Documents rows
// were mock-only fields with no real schema counterpart (see
// ralto-data-model-v0_1.md — Booking has no travel/hotel columns). Dropped
// in favour of the fields that map to real data: call time, venue, the
// job's production contact (GetMyBookingContact), and the booking's own
// notes. Personal documents (PersonDocument) are shown on Profile instead,
// where they actually belong — they're per-person, not per-job.
// ---------------------------------------------------------------------------

const statusStyle: Record<string, { color: string; bg: string; label: string; Icon: typeof CheckCircle2 }> = {
  confirmed: { color: 'var(--success)', bg: 'var(--success-bg)', label: 'Confirmed', Icon: CheckCircle2 },
  offered: { color: 'var(--attention)', bg: 'var(--attention-bg)', label: 'Awaiting response', Icon: Clock },
  declined: { color: 'var(--danger)', bg: 'var(--danger-bg)', label: 'Declined', Icon: X },
  complete: { color: 'var(--success)', bg: 'var(--success-bg)', label: 'Complete', Icon: CheckCircle2 },
}

function StatusPill({ status }: { status: string }) {
  const s = statusStyle[status] ?? statusStyle.offered
  return (
    <span style={{ color: s.color, background: s.bg, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12, padding: '4px 10px', borderRadius: 999, letterSpacing: 0.1 }}>{s.label}</span>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-muted)', margin: '28px 20px 10px' }}>{children}</div>
}

function Divider() {
  return <div style={{ height: 1, background: 'var(--line)', margin: '0 20px' }} />
}

function Row({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, padding: '16px 20px' }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon size={16} color="var(--primary)" />
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--ink)', marginTop: 2, lineHeight: 1.4 }}>{value}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function HomeScreen({ bookings, alerts, onRespond, onAcknowledge, onOpenJob }: { bookings: CrewBooking[]; alerts: OperationalAlert[]; onRespond: (id: string, decision: 'accept' | 'decline') => Promise<void>; onAcknowledge: (alert: OperationalAlert) => Promise<void>; onOpenJob: (b: CrewBooking) => void }) {
  const { person } = useCrewAuth()
  const [respondingId, setRespondingId] = useState<string | null>(null)

  const pendingOffers = bookings.filter((b) => b.status === 'offered')
  const confirmed = bookings.filter((b) => b.status === 'confirmed').sort((a, b) => a.start_date.localeCompare(b.start_date))
  const nextJob = confirmed[0] ?? pendingOffers[0]
  const upcoming = nextJob ? confirmed.filter((b) => b.id !== nextJob.id) : confirmed

  const attentionCount = pendingOffers.length + alerts.length

  async function respond(id: string, decision: 'accept' | 'decline') {
    await onRespond(id, decision)
    setRespondingId(null)
  }

  return (
    <div>
      <div style={{ padding: '22px 20px 4px' }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-muted)' }}>Good morning</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: 'var(--ink)' }}>
          {person?.first_name} {person?.last_name}
        </div>
      </div>

      {nextJob && (
        <div style={{ padding: '0 20px 20px' }}>
          <div style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 16, padding: '18px 18px 18px 24px', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: 'var(--primary)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginBottom: 8 }}>Next job</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, lineHeight: 1.2, color: 'var(--ink)' }}>{nextJob.job_name}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--ink-muted)', marginTop: 4 }}>
                  {nextJob.client_name} · {nextJob.role_name}
                </div>
              </div>
              <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: statusStyle[nextJob.status]?.bg ?? statusStyle.offered.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(() => {
                  const Icon = statusStyle[nextJob.status]?.Icon ?? statusStyle.offered.Icon
                  return <Icon size={15} color={statusStyle[nextJob.status]?.color ?? statusStyle.offered.color} strokeWidth={2.5} />
                })()}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 18, marginTop: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>Call time</div>
                <div style={{ fontFamily: 'var(--font-body)', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>
                  {nextJob.start_date}
                  {nextJob.call_time ? ` · ${formatTime(nextJob.call_time)}` : ''}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>Venue</div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 17, color: 'var(--ink)' }}>{nextJob.venue_name ?? 'TBC'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
              <StatusPill status={nextJob.status} />
            </div>

            <button
              onClick={() => onOpenJob(nextJob)}
              style={{ marginTop: 18, width: '100%', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 12, padding: '13px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' }}
            >
              View details <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {attentionCount > 0 && (
        <>
          <SectionLabel>Needs your attention</SectionLabel>
          <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {pendingOffers.map((offer) => (
              <div key={offer.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--attention-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Bell size={15} color="var(--attention)" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{offer.job_name}</div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                      {offer.role_name} · {offer.start_date} – {offer.end_date}
                    </div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>{offer.venue_name ?? 'Venue TBC'}</div>
                  </div>
                </div>

                {respondingId !== offer.id ? (
                  <button onClick={() => setRespondingId(offer.id)} style={{ marginTop: 12, width: '100%', background: 'var(--ink)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                    Respond
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <button
                      onClick={() => respond(offer.id, 'decline')}
                      style={{ flex: 1, background: '#fff', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10, padding: '10px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <X size={15} /> Decline
                    </button>
                    <button
                      onClick={() => respond(offer.id, 'accept')}
                      style={{ flex: 1, background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <Check size={15} /> Accept
                    </button>
                  </div>
                )}
              </div>
            ))}

            {alerts.map((alert) => (
              <div key={alert.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16, background: '#fff', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--attention-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bell size={15} color="var(--attention)" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{alert.job_name}</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>A call-time or schedule change needs your acknowledgement.</div>
                </div>
                <button
                  onClick={() => onAcknowledge(alert)}
                  style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)', cursor: 'pointer', flexShrink: 0 }}
                >
                  Got it
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionLabel>Upcoming</SectionLabel>
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {upcoming.length === 0 && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>Nothing else on the schedule yet.</div>}
        {upcoming.map((job) => {
          const s = statusStyle[job.status] ?? statusStyle.confirmed
          const StatusIcon = s.Icon
          return (
            <div key={job.id} style={{ position: 'relative', border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: '12px 14px 12px 18px', overflow: 'hidden', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'var(--primary)' }} />
              <div>
                <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, color: 'var(--ink)' }}>{job.job_name}</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)' }}>
                  {job.start_date} – {job.end_date}
                </div>
              </div>
              <div style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <StatusIcon size={13} color={s.color} strokeWidth={2.5} />
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ height: 90 }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Job detail
// ---------------------------------------------------------------------------

function JobDetailScreen({ job, onBack }: { job: CrewBooking; onBack: () => void }) {
  const [contact, setContact] = useState<JobContact | null>(null)

  useEffect(() => {
    api
      .get<JobContact>(`/crew/bookings/${job.id}/contact`)
      .then(setContact)
      .catch(() => setContact(null))
  }, [job.id])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px 6px' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, marginLeft: -4, color: 'var(--ink)' }}>
          <ChevronLeft size={22} />
        </button>
      </div>

      <div style={{ padding: '6px 20px 16px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 22, color: 'var(--ink)', lineHeight: 1.2 }}>{job.job_name}</div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-muted)', marginTop: 4 }}>
          {job.role_name} · {job.client_name}
        </div>
        <div style={{ marginTop: 10 }}>
          <StatusPill status={job.status} />
        </div>
      </div>

      <Divider />
      <Row icon={CalendarDays} label="Call" value={`${job.start_date}${job.call_time ? ' · ' + formatTime(job.call_time) : ''}`} />
      <Divider />
      <Row icon={MapPin} label="Venue" value={job.venue_name ?? 'Not yet set'} />
      <Divider />
      <Row icon={Phone} label="Production contact" value={contact ? `${contact.name}${contact.role_title ? ' · ' + contact.role_title : ''}${contact.phone ? ' · ' + contact.phone : ''}` : 'Not yet assigned'} />
      {job.notes && (
        <>
          <Divider />
          <Row icon={Bell} label="Notes" value={job.notes} />
        </>
      )}

      <div style={{ height: 40 }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

function AvailabilityScreen() {
  const [requests, setRequests] = useState<AvailabilityRequest[]>([])
  const [answering, setAnswering] = useState<string | null>(null)

  function reload() {
    api.get<AvailabilityRequest[]>('/crew/availability-requests').then(setRequests)
  }

  useEffect(reload, [])

  const pending = requests.filter((r) => r.status === 'pending')

  async function choose(id: string, response: AvailabilityResponseValue) {
    setAnswering(id)
    await api.post(`/crew/availability-requests/${id}/respond`, { response })
    setAnswering(null)
    reload()
  }

  return (
    <div style={{ padding: '22px 20px' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, color: 'var(--ink)' }}>Availability</div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-muted)', marginTop: 4 }}>
        {pending.length === 0 ? 'No requests waiting on you' : `${pending.length} request${pending.length === 1 ? '' : 's'} waiting on you`}
      </div>

      {pending.map((req) => (
        <div key={req.id} style={{ marginTop: 20, border: '1px solid var(--line)', borderRadius: 12, padding: 18, background: '#fff' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: 'var(--ink)' }}>
            {req.start_date} – {req.end_date}
          </div>
          {req.message && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 4 }}>{req.message}</div>}
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-muted)', marginTop: 6 }}>Are you available?</div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            {(
              [
                { key: 'yes' as const, label: 'Yes' },
                { key: 'partially' as const, label: 'Partially' },
                { key: 'no' as const, label: 'No' },
              ]
            ).map((opt) => (
              <button
                key={opt.key}
                disabled={answering === req.id}
                onClick={() => choose(req.id, opt.key)}
                style={{ flex: 1, background: opt.key === 'yes' ? 'var(--primary)' : '#fff', color: opt.key === 'yes' ? '#fff' : 'var(--ink)', border: opt.key === 'yes' ? 'none' : '1px solid var(--line)', borderRadius: 10, padding: '10px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      {pending.length === 0 && (
        <div style={{ marginTop: 24, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', lineHeight: 1.5 }}>
          No requests right now. When one comes in, it'll show here — a one-tap answer, nothing to fill in.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function SectionLabelInline({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink-muted)', margin: '24px 0 10px' }}>{children}</div>
}

const DOCUMENT_TYPE_LABEL: Record<PersonDocument['type'], string> = {
  certification: 'Certification',
  visa: 'Visa',
  production_credential: 'Production credential',
}

// ProfileEditForm — email/phone/base_location/notification_channels only.
// This is deliberately not the full picture: employment type, rate,
// preferred status, and notes are scheduler-owned and this screen has no
// field for any of them — matching what UpdateMyProfile actually accepts,
// not hiding fields that the API would otherwise honour.
function ProfileEditForm({ person, onCancel, onSaved }: { person: Person; onCancel: () => void; onSaved: (p: Person) => void }) {
  const [email, setEmail] = useState(person.email)
  const [phone, setPhone] = useState(person.phone ?? '')
  const [baseLocation, setBaseLocation] = useState(person.base_location ?? '')
  const [vehicleRegistration, setVehicleRegistration] = useState(person.vehicle_registration ?? '')
  const initialChannels = useMemo(() => {
    try {
      return person.notification_channels ? (JSON.parse(person.notification_channels) as { email?: boolean; whatsapp?: boolean }) : {}
    } catch {
      return {}
    }
  }, [person.notification_channels])
  const [notifyEmail, setNotifyEmail] = useState(initialChannels.email !== false)
  const [notifyWhatsapp, setNotifyWhatsapp] = useState(initialChannels.whatsapp !== false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  // Progressive disclosure: the password field only appears once email has
  // actually been touched — the requirement is behavioural (enforced
  // server-side regardless), not about this exact interaction shape.
  const emailChanged = email.trim().toLowerCase() !== person.email.trim().toLowerCase()

  const inputStyle = { border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)', background: '#fff', width: '100%', boxSizing: 'border-box' as const }
  const labelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 5, fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-muted)', marginTop: 14 }

  async function submit() {
    setError(undefined)
    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    if (emailChanged && !currentPassword) {
      setError('Enter your current password to change your email.')
      return
    }
    setSaving(true)
    try {
      const updated = await api.put<Person>('/crew/me', {
        email,
        phone: phone || undefined,
        base_location: baseLocation || undefined,
        vehicle_registration: vehicleRegistration || undefined,
        // Not surfaced on this form — carried forward as-is so saving
        // phone/location/notifications doesn't silently blank it out.
        phone_number: person.phone_number,
        notification_channels: JSON.stringify({ email: notifyEmail, whatsapp: notifyWhatsapp }),
        current_password: emailChanged ? currentPassword : undefined,
      })
      onSaved(updated)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Current password is incorrect.')
      } else {
        setError('Could not save — check the fields and try again.')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, color: 'var(--ink)' }}>Edit profile</div>

      <label style={{ ...labelStyle, marginTop: 18 }}>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Base location
        <input value={baseLocation} onChange={(e) => setBaseLocation(e.target.value)} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Vehicle registration (optional)
        <input value={vehicleRegistration} onChange={(e) => setVehicleRegistration(e.target.value)} placeholder="For site/parking access" style={inputStyle} />
      </label>

      <div style={labelStyle}>
        Notifications
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)' }}>
            <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
            Email
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink)' }}>
            <input type="checkbox" checked={notifyWhatsapp} onChange={(e) => setNotifyWhatsapp(e.target.checked)} />
            WhatsApp
          </label>
        </div>
      </div>

      {emailChanged && (
        <label style={labelStyle}>
          Current password (required to change email)
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={inputStyle} />
        </label>
      )}

      {error && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--danger)', marginTop: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: 'var(--ink)', cursor: 'pointer' }}
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={saving}
          style={{ flex: 1, background: 'var(--primary)', border: 'none', borderRadius: 10, padding: '11px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: '#fff', cursor: 'pointer', opacity: saving ? 0.7 : 1 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// CalendarFeedSection — the crew-facing side of the personal iCal feed
// (ralto_schema_addendum_v1.md §2). GET triggers server-side generation on
// first view (never proactive), so there's nothing to create client-side
// here — just fetch-and-show, copy, and an explicit, clearly-warned
// regenerate.
function CalendarFeedSection() {
  const [feedUrl, setFeedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .get<{ feed_url: string }>('/crew/calendar-feed')
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
      // Clipboard API unavailable (e.g. no secure context) — the URL is
      // still visible and selectable in the input above, nothing else to do.
    }
  }

  async function regenerate() {
    setRegenerating(true)
    try {
      const res = await api.post<{ feed_url: string }>('/crew/calendar-feed/regenerate')
      setFeedUrl(res.feed_url)
      setConfirmingRegenerate(false)
    } finally {
      setRegenerating(false)
    }
  }

  return (
    <>
      <SectionLabelInline>Calendar feed</SectionLabelInline>
      <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff', padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <LinkIcon size={16} color="var(--primary)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, color: 'var(--ink)', fontWeight: 600 }}>Subscribe to your bookings</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 3, lineHeight: 1.4 }}>
              Add this link to your phone or computer's calendar app to see your jobs alongside everything else. Confirmed jobs show normally; offered or pencilled jobs show as "tentative" so you can tell them apart.
            </div>
          </div>
        </div>

        {loading && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--ink-muted)', marginTop: 14 }}>Loading…</div>}

        {!loading && feedUrl && (
          <>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                readOnly
                value={feedUrl}
                onFocus={(e) => e.target.select()}
                style={{ flex: 1, minWidth: 0, border: '1px solid var(--line)', borderRadius: 8, padding: '9px 10px', fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--ink-muted)', background: 'var(--tint)' }}
              />
              <button
                onClick={copy}
                style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '9px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer' }}
              >
                <Copy size={13} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)', marginTop: 10, lineHeight: 1.4 }}>
              Calendar apps usually check a link like this every hour or so, not instantly — a same-day schedule change may take a little while to show up.
            </div>

            {!confirmingRegenerate ? (
              <button
                onClick={() => setConfirmingRegenerate(true)}
                style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink-muted)', cursor: 'pointer' }}
              >
                <RefreshCw size={12} /> Regenerate link
              </button>
            ) : (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--danger-bg)' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--danger)', lineHeight: 1.4 }}>
                  This immediately stops the current link from working — anywhere you've already subscribed will stop updating, and you'll need to re-subscribe with the new one.
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => setConfirmingRegenerate(false)}
                    style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={regenerate}
                    disabled={regenerating}
                    style={{ flex: 1, background: 'var(--danger)', border: 'none', borderRadius: 8, padding: '8px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 13, color: '#fff', cursor: 'pointer', opacity: regenerating ? 0.7 : 1 }}
                  >
                    {regenerating ? 'Regenerating…' : 'Yes, regenerate'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function ProfileScreen() {
  const { person, logout, updatePerson } = useCrewAuth()
  const [documents, setDocuments] = useState<PersonDocument[]>([])
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    api.get<PersonDocument[]>('/crew/documents').then(setDocuments)
  }, [])

  if (editing && person) {
    return (
      <div style={{ padding: '22px 20px' }}>
        <ProfileEditForm
          person={person}
          onCancel={() => setEditing(false)}
          onSaved={(p) => {
            updatePerson(p)
            setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: '22px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, color: 'var(--ink)' }}>
            {person?.first_name} {person?.last_name}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--ink-muted)', marginTop: 4 }}>
            {person?.base_location ? `Based in ${person.base_location}` : 'Location not set'}
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 5, border: '1px solid var(--line)', background: '#fff', borderRadius: 8, padding: '7px 12px', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 12.5, color: 'var(--ink)', cursor: 'pointer', flexShrink: 0 }}
        >
          <Pencil size={13} /> Edit
        </button>
      </div>

      <SectionLabelInline>Contact</SectionLabelInline>
      <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }}>
        <Row icon={Mail} label="Email" value={person?.email ?? 'Not set'} />
        <Divider />
        <Row icon={Phone} label="Phone" value={person?.phone || 'Not set'} />
        <Divider />
        <Row icon={Car} label="Vehicle registration" value={person?.vehicle_registration || 'Not set'} />
      </div>

      <SectionLabelInline>Documents</SectionLabelInline>
      <div style={{ border: '1px solid var(--line)', borderRadius: 12, background: '#fff' }}>
        {documents.length === 0 && <div style={{ padding: 16, fontFamily: 'var(--font-body)', fontSize: 13.5, color: 'var(--ink-muted)' }}>No documents on file.</div>}
        {documents.map((doc, i) => (
          <div key={doc.id}>
            <Row icon={FileText} label={DOCUMENT_TYPE_LABEL[doc.type]} value={doc.expiry_date ? `Valid to ${doc.expiry_date}` : 'No expiry set'} />
            {i < documents.length - 1 && <Divider />}
          </div>
        ))}
      </div>

      <CalendarFeedSection />

      <button
        onClick={logout}
        style={{ marginTop: 24, width: '100%', background: 'none', border: '1px solid var(--line)', borderRadius: 10, padding: '11px 0', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: 'var(--ink)', cursor: 'pointer' }}
      >
        Sign out
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

type TabKey = 'home' | 'availability' | 'profile'

export function RaltoCrewApp() {
  const [tab, setTab] = useState<TabKey>('home')
  const [openJob, setOpenJob] = useState<CrewBooking | null>(null)
  const [bookings, setBookings] = useState<CrewBooking[]>([])
  const [alerts, setAlerts] = useState<OperationalAlert[]>([])

  function reload() {
    api.get<CrewBooking[]>('/crew/bookings').then(setBookings)
    api.get<OperationalAlert[]>('/crew/alerts').then(setAlerts)
  }

  useEffect(reload, [])

  const pendingCount = useMemo(() => bookings.filter((b) => b.status === 'offered').length + alerts.length, [bookings, alerts])

  async function handleRespond(id: string, decision: 'accept' | 'decline') {
    await api.post(`/crew/offers/${id}/respond`, { response: decision })
    reload()
  }

  async function handleAcknowledge(alert: OperationalAlert) {
    if (!alert.related_entity_id) return
    await api.post(`/crew/bookings/${alert.related_entity_id}/acknowledge`)
    reload()
  }

  let body: React.ReactNode
  if (openJob) {
    body = <JobDetailScreen job={openJob} onBack={() => setOpenJob(null)} />
  } else if (tab === 'home') {
    body = <HomeScreen bookings={bookings} alerts={alerts} onRespond={handleRespond} onAcknowledge={handleAcknowledge} onOpenJob={setOpenJob} />
  } else if (tab === 'availability') {
    body = <AvailabilityScreen />
  } else {
    body = <ProfileScreen />
  }

  return (
    <div className="dvh-shell" style={{ background: '#fff', display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-body)' }}>
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
          --line: #E7E5E2;
          --success: #3F8F6D;
          --success-bg: #EAF4EF;
          --attention: #C98A2B;
          --attention-bg: #FBF1E1;
          --danger: #B5473C;
          --danger-bg: #F8EBE9;
        }
      `}</style>

      <div style={{ flex: 1, overflowY: 'auto' }}>{body}</div>

      <div style={{ display: 'flex', borderTop: '1px solid var(--line)', background: '#fff', padding: '10px 0 16px' }}>
        {(
          [
            { key: 'home' as const, icon: HomeIcon, label: 'Home' },
            { key: 'availability' as const, icon: CalendarCheck, label: 'Availability' },
            { key: 'profile' as const, icon: User, label: 'Profile' },
          ]
        ).map((t) => {
          const Icon = t.icon
          const isActive = tab === t.key && !openJob
          return (
            <button
              key={t.key}
              onClick={() => {
                setOpenJob(null)
                setTab(t.key)
              }}
              style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, position: 'relative' }}
            >
              <Icon size={20} color={isActive ? 'var(--primary)' : 'var(--ink-muted)'} />
              {t.key === 'home' && pendingCount > 0 && <span style={{ position: 'absolute', top: -2, right: 'calc(50% - 14px)', width: 8, height: 8, borderRadius: 999, background: 'var(--danger)' }} />}
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600, color: isActive ? 'var(--primary)' : 'var(--ink-muted)' }}>{t.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
