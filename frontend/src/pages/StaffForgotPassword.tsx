import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

// Scheduler/staff's own equivalent of CrewForgotPassword.tsx — same layout
// and same "always show the same confirmation" behaviour (see
// RequestStaffPasswordReset's own comment for why), styled to match
// StaffLogin.tsx rather than CrewLogin.tsx (slightly different card
// shadow/width, matching that screen exactly).
export function StaffForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#E7E5E1', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ width: 340, background: '#fff', border: '1px solid #DCE3E7', borderRadius: 16, padding: 32, boxShadow: '0 20px 40px rgba(23,21,31,0.12)' }}>
        <div style={{ fontWeight: 700, fontSize: 20, color: '#18232E', marginBottom: 4 }}>Crewing</div>
        <div style={{ fontSize: 13, color: '#667085', marginBottom: 24 }}>Reset your password</div>

        {sent ? (
          <div style={{ fontSize: 13.5, color: '#18232E', lineHeight: 1.5, marginBottom: 20 }}>
            If that email has an account, we've sent a link to reset your password. Check your inbox (and spam folder) — the link expires in 1 hour.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: 'block', fontSize: 12.5, color: '#667085', marginBottom: 4 }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #DCE3E7', marginBottom: 14, fontSize: 14 }}
            />
            {error && <div style={{ color: '#B42318', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
            <button
              type="submit"
              disabled={submitting}
              style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: '#453E96', color: '#fff', fontWeight: 600, fontSize: 14, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <Link to="/" style={{ fontSize: 12.5, color: '#453E96', textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
