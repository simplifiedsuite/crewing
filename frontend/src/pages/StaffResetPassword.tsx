import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'

// Scheduler/staff's own equivalent of CrewResetPassword.tsx — reached only
// via the emailed link (?token=…), runs fully logged-out, and on success
// just points at the ordinary sign-in screen rather than establishing a
// session itself.
export function StaffResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    setSubmitting(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: newPassword })
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#E7E5E1', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
      <div style={{ width: 340, background: '#fff', border: '1px solid #DCE3E7', borderRadius: 16, padding: 32, boxShadow: '0 20px 40px rgba(23,21,31,0.12)' }}>
        <div style={{ fontWeight: 700, fontSize: 20, color: '#18232E', marginBottom: 4 }}>Crewing</div>
        <div style={{ fontSize: 13, color: '#667085', marginBottom: 24 }}>Choose a new password</div>

        {!token ? (
          <div style={{ fontSize: 13.5, color: '#B42318', lineHeight: 1.5 }}>
            This reset link is missing its token. Request a new one from the <Link to="/forgot-password" style={{ color: '#453E96' }}>forgot password</Link> page.
          </div>
        ) : done ? (
          <>
            <div style={{ fontSize: 13.5, color: '#18232E', lineHeight: 1.5, marginBottom: 20 }}>
              Your password has been reset.
            </div>
            <Link
              to="/"
              style={{
                display: 'block',
                textAlign: 'center',
                width: '100%',
                padding: '10px 0',
                borderRadius: 8,
                background: '#453E96',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
                boxSizing: 'border-box',
              }}
            >
              Sign in
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <label style={{ display: 'block', fontSize: 12.5, color: '#667085', marginBottom: 4 }}>New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #DCE3E7', marginBottom: 14, fontSize: 14 }}
            />
            <label style={{ display: 'block', fontSize: 12.5, color: '#667085', marginBottom: 4 }}>Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #DCE3E7', marginBottom: 14, fontSize: 14 }}
            />
            {error && <div style={{ color: '#B42318', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
            <button
              type="submit"
              disabled={submitting}
              style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: '#453E96', color: '#fff', fontWeight: 600, fontSize: 14, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
            >
              {submitting ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
