import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useCrewAuth, ApiError } from '../context/CrewAuthContext'

export function CrewLogin() {
  const { login } = useCrewAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: '#F5F7F8', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', padding: 20 }}>
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 340, background: '#fff', border: '1px solid #DCE3E7', borderRadius: 16, padding: 28 }}>
        <div style={{ fontWeight: 700, fontSize: 20, color: '#18232E', marginBottom: 4 }}>Crewing</div>
        <div style={{ fontSize: 13, color: '#667085', marginBottom: 24 }}>Crew sign in</div>
        <label style={{ display: 'block', fontSize: 12.5, color: '#667085', marginBottom: 4 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #DCE3E7', marginBottom: 14, fontSize: 14 }}
        />
        <label style={{ display: 'block', fontSize: 12.5, color: '#667085', marginBottom: 4 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{ width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #DCE3E7', marginBottom: 6, fontSize: 14 }}
        />
        <div style={{ textAlign: 'right', marginBottom: 14 }}>
          <Link to="/crew/forgot-password" style={{ fontSize: 12.5, color: '#453E96', textDecoration: 'none' }}>
            Forgot password?
          </Link>
        </div>
        {error && <div style={{ color: '#B42318', fontSize: 12.5, marginBottom: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: '#453E96', color: '#fff', fontWeight: 600, fontSize: 14, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1 }}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
