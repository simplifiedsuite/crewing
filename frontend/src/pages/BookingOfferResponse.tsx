import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

// The actual offer email's link (Addendum v3 §2) — public, unauthenticated,
// token-based, deliberately outside both /crew/* and the scheduler's own
// auth-gated routes (see App.tsx). Two-step confirmation: this page's GET
// only ever reads and renders; the Accept/Decline buttons are the only
// thing that POSTs and actually changes anything, since mail clients and
// security scanners routinely pre-fetch links and a bare GET that actioned
// the offer would silently misfire on those.

type OfferPageData = {
  status: 'valid' | 'used' | 'expired' | 'not_found'
  role_name?: string
  job_name?: string
  dates_text?: string
  venue_name?: string
  call_time?: string | null
  rate?: number | null
  rate_currency?: string | null
}

const CARD_STYLE: React.CSSProperties = {
  width: '100%',
  maxWidth: 360,
  background: '#fff',
  border: '1px solid #DCE3E7',
  borderRadius: 16,
  padding: 28,
}

const PAGE_STYLE: React.CSSProperties = {
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#F5F7F8',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  padding: 20,
}

function formatRate(rate?: number | null, currency?: string | null): string {
  if (rate == null) return 'Rate TBC'
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£'
  return `${symbol}${rate.toFixed(2)}`
}

export function BookingOfferResponse() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<OfferPageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<'accept' | 'decline' | null>(null)
  const [responded, setResponded] = useState<'accept' | 'decline' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    api
      .get<OfferPageData>(`/booking-offers/${token}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load this offer'))
      .finally(() => setLoading(false))
  }, [token])

  async function respond(response: 'accept' | 'decline') {
    if (!token) return
    setSubmitting(response)
    setError(null)
    try {
      const result = await api.post<OfferPageData>(`/booking-offers/${token}/respond`, { response })
      if (result.status === 'used' || result.status === 'expired' || result.status === 'not_found') {
        // The offer moved on via a different channel between this page
        // loading and the button being pressed — same "already handled"
        // outcome as a stale link, not an error.
        setData(result)
      } else {
        setResponded(response)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send your response — please try again')
    } finally {
      setSubmitting(null)
    }
  }

  if (!token) {
    return (
      <div style={PAGE_STYLE}>
        <div style={CARD_STYLE}>
          <div style={{ fontWeight: 700, fontSize: 20, color: '#18232E', marginBottom: 4 }}>Crewing</div>
          <div style={{ fontSize: 13.5, color: '#B42318', lineHeight: 1.5 }}>This link is missing its token.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={PAGE_STYLE}>
      <div style={CARD_STYLE}>
        <div style={{ fontWeight: 700, fontSize: 20, color: '#18232E', marginBottom: 4 }}>Crewing</div>

        {loading && <div style={{ fontSize: 13.5, color: '#667085' }}>Loading…</div>}

        {!loading && error && <div style={{ fontSize: 13.5, color: '#B42318', lineHeight: 1.5 }}>{error}</div>}

        {!loading && !error && responded && (
          <div style={{ fontSize: 14, color: '#18232E', lineHeight: 1.5 }}>
            {responded === 'accept'
              ? "Thanks — you're pencilled. We'll be in touch once everything's confirmed."
              : "Thanks — we've let the scheduler know you can't make this one."}
          </div>
        )}

        {!loading && !error && !responded && data?.status === 'used' && (
          <div style={{ fontSize: 13.5, color: '#667085', lineHeight: 1.5 }}>This offer's already been handled.</div>
        )}
        {!loading && !error && !responded && data?.status === 'expired' && (
          <div style={{ fontSize: 13.5, color: '#667085', lineHeight: 1.5 }}>This link has expired. Ask your scheduler to resend it if you're still interested.</div>
        )}
        {!loading && !error && !responded && data?.status === 'not_found' && (
          <div style={{ fontSize: 13.5, color: '#667085', lineHeight: 1.5 }}>We couldn't find this offer. The link may be incorrect.</div>
        )}

        {!loading && !error && !responded && data?.status === 'valid' && (
          <>
            <div style={{ fontSize: 13, color: '#667085', marginBottom: 20 }}>You've been offered a job</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: '#18232E', marginBottom: 4 }}>
              {data.role_name} on {data.job_name}
            </div>
            <div style={{ fontSize: 13.5, color: '#18232E', lineHeight: 1.7, marginBottom: 20 }}>
              <div>{data.dates_text}</div>
              <div>{data.venue_name}</div>
              <div>Call time: {data.call_time ?? 'TBC'}</div>
              <div>{formatRate(data.rate, data.rate_currency)}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => respond('decline')}
                disabled={submitting !== null}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: '1px solid #DCE3E7',
                  background: '#fff',
                  color: '#18232E',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: submitting ? 'default' : 'pointer',
                  opacity: submitting !== null ? 0.7 : 1,
                }}
              >
                {submitting === 'decline' ? 'Sending…' : 'Decline'}
              </button>
              <button
                onClick={() => respond('accept')}
                disabled={submitting !== null}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: '#453E96',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: submitting ? 'default' : 'pointer',
                  opacity: submitting !== null ? 0.7 : 1,
                }}
              >
                {submitting === 'accept' ? 'Sending…' : 'Accept'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
