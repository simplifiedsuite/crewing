import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

// Styled to match CrewLogin.tsx/CrewChangePassword.tsx exactly — same card,
// same field styling — since this is reached directly off the login screen
// and should read as the same product, not a separate flow bolted on.
//
// Always shows the same confirmation once submitted, regardless of whether
// the email matched an account — the backend already collapses "no such
// account" and "sent" into one response (see RequestCrewPasswordReset's own
// comment); this page just doesn't add a second way to tell them apart on
// top of that.
export function CrewForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post('/crew/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#F5F7F8', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 340, background: '#fff', border: '1px solid #DCE3E7', borderRadius: 16, padding: 28 }}>
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
          <Link to="/crew" style={{ fontSize: 12.5, color: '#453E96', textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
