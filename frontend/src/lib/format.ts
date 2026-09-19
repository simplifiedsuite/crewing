// Postgres TIME columns come back as "HH:MM:SS" text (see backend/internal/db/db.go's
// SimpleProtocol note) — trim the seconds for display everywhere a call time is shown.
export function formatTime(time: string | undefined): string | undefined {
  return time?.slice(0, 5)
}

// Postgres DATE columns come back as "YYYY-MM-DD" text — the requested
// DD/MM/YY display format, in one place so every call site (desktop
// scheduler, mobile scheduler, crew app) stays consistent by construction
// rather than by remembering to match each other.
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

// formatDateRange — a start/end DATE pair, collapsed to a single date when
// they're equal rather than a same-day range like "18/09/26 – 18/09/26".
export function formatDateRange(startIso: string, endIso: string): string {
  return startIso === endIso ? formatDate(startIso) : `${formatDate(startIso)} – ${formatDate(endIso)}`
}
