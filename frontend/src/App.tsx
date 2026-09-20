import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { StaffAuthProvider, useStaffAuth } from './context/StaffAuthContext'
import { CrewAuthProvider, useCrewAuth } from './context/CrewAuthContext'
import { StaffLogin } from './pages/StaffLogin'
import { StaffForgotPassword } from './pages/StaffForgotPassword'
import { StaffResetPassword } from './pages/StaffResetPassword'
import { CrewLogin } from './pages/CrewLogin'
import { CrewForgotPassword } from './pages/CrewForgotPassword'
import { CrewResetPassword } from './pages/CrewResetPassword'
import { StaffChangePassword } from './pages/StaffChangePassword'
import { CrewChangePassword } from './pages/CrewChangePassword'
import { BookingOfferResponse } from './pages/BookingOfferResponse'
import { RaltoDesktopApp } from './pages/scheduler/RaltoDesktopApp'
import { RaltoMobileApp } from './pages/scheduler/RaltoMobileApp'
import { RaltoCrewApp } from './pages/crew/RaltoCrewApp'

// One React codebase serves desktop and mobile (per Phase 1 scope): the
// scheduler shell picks a layout by viewport width. The crew persona is a
// structurally separate app (/crew/*) with its own session/auth context —
// not just a different route, a different cookie entirely (see
// backend/internal/middleware/auth.go's staff/crew split).
const MOBILE_BREAKPOINT = 768

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < MOBILE_BREAKPOINT)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

function SchedulerShell() {
  const { user, loading } = useStaffAuth()
  const isMobile = useIsMobileViewport()

  if (loading) return null
  if (!user) {
    // Same reasoning as CrewShell's own logged-out branch: everywhere else
    // in the scheduler shell is state-driven, not URL-driven, but forgot/
    // reset-password need real, deep-linkable routes.
    return (
      <Routes>
        <Route path="forgot-password" element={<StaffForgotPassword />} />
        <Route path="reset-password" element={<StaffResetPassword />} />
        <Route path="*" element={<StaffLogin />} />
      </Routes>
    )
  }
  // Gate before anything else renders: RaltoDesktopApp/RaltoMobileApp never
  // mount while this is true, so none of their data-fetching hooks fire —
  // there's no route to "skip past" this by navigating directly on the
  // frontend, and the backend enforces the same restriction independently
  // (RequireStaffPasswordSet) if it somehow were.
  if (user.must_change_password) return <StaffChangePassword />
  return isMobile ? <RaltoMobileApp /> : <RaltoDesktopApp />
}

function CrewShell() {
  const { person, loading } = useCrewAuth()

  if (loading) return null
  if (!person) {
    // The only place under /crew/* that needs real path-based routing —
    // everywhere else (RaltoCrewApp's own tabs) is state-driven, not
    // URL-driven, but a forgot/reset-password screen has to be reachable
    // pre-session and, for reset, deep-linkable with a token in the query
    // string, so it needs an actual route rather than app state.
    return (
      <Routes>
        <Route path="forgot-password" element={<CrewForgotPassword />} />
        <Route path="reset-password" element={<CrewResetPassword />} />
        <Route path="*" element={<CrewLogin />} />
      </Routes>
    )
  }
  if (person.must_change_password) return <CrewChangePassword />
  return <RaltoCrewApp />
}

export function App() {
  return (
    <Routes>
      <Route
        path="/crew/*"
        element={
          <CrewAuthProvider>
            <CrewShell />
          </CrewAuthProvider>
        }
      />
      {/* Public, unauthenticated freelancer offer response (Addendum v3 §2)
          — genuinely outside both auth trees above, not just the logged-out
          branch of one of them, since a scheduler or staff session cookie
          being present shouldn't change how this page behaves either. Must
          come before the /* catch-all below, which would otherwise swallow it. */}
      <Route path="/respond/:token" element={<BookingOfferResponse />} />
      <Route
        path="/*"
        element={
          <StaffAuthProvider>
            <SchedulerShell />
          </StaffAuthProvider>
        }
      />
    </Routes>
  )
}
