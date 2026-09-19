"""
Crewing iCal feed generator
============================

Turns a Person's Bookings/BookingShifts into a valid RFC 5545 (.ics) calendar
feed, matching the schema addendum's design:

  Person.calendar_feed_token  (nullable, unique, generated on first request)
  -> feed scope: that person's own bookings only (confirmed by Ric)

Two decisions this file settles, that the addendum had left open:

1. TENTATIVE BOOKINGS ARE INCLUDED, not just confirmed ones — both
   'offered' and 'pencilled' (see migrations/0004_pencil.sql for that
   status). Both appear using iCalendar's own STATUS property
   (STATUS:TENTATIVE), which every mainstream calendar app already renders
   distinctly (usually a hatched/dashed event) — so this doesn't need a
   text hack like a "[Tentative]" prefix. Reasoning: a crew member not
   seeing a held offer on their personal calendar is more likely to cause
   a real double-booking than seeing something correctly labelled
   tentative. DESCRIPTION still distinguishes 'pencilled' from 'offered'
   in words, since the two mean different things (held vs. formally
   asked) even though a calendar app can only draw one "tentative" style
   for both.

2. REFRESH INTERVAL is set explicitly via X-PUBLISHED-TTL (and the parallel
   REFRESH-INTERVAL property some clients look for instead), rather than
   leaving it to whatever a calendar app defaults to. Set to 1 hour here —
   this is the "near real-time, not push" caveat from the addendum, now
   actually encoded in the feed instead of just being a note to the user.

One VEVENT is generated per BookingShift, not per Booking — this is what
correctly represents day-varying call times for multi-day bookings, per the
data model's core principle that call times are per-shift, not per-booking.

No external dependencies. iCalendar is a simple text format; hand-rolling it
here avoids a dependency for something this self-contained, and this
environment has no network access to install one in any case.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional


# ---------------------------------------------------------------------------
# Domain types — a minimal stand-in for the real Booking/BookingShift/Person
# entities described in the data model. A real implementation would pull
# these from the database instead of constructing them by hand.
# ---------------------------------------------------------------------------


@dataclass
class BookingShift:
    id: str
    date: str          # "2026-11-14"
    call_time: str      # "07:00"
    end_time: str        # "23:30"
    venue: str
    timezone: str = "Europe/London"


@dataclass
class Booking:
    id: str
    job_name: str
    client_name: str
    role: str
    status: str  # "confirmed" | "offered"
    shifts: list[BookingShift] = field(default_factory=list)
    notes: Optional[str] = None
    last_modified: Optional[datetime] = None
    # Fallback fields, used only when shifts is empty — a Booking created
    # before syncBookingShifts existed (see booking_shifts.go's own "item L"
    # comment) has no BookingShift rows at all. Without these the booking
    # was previously just dropped from the feed (see git history), not
    # rendered as anything — the exact class of live commitment silently
    # going missing that this feed exists to prevent. start_date/end_date
    # are the Booking's own (already the precise days that person covers,
    # same source JobCreateForm/offerBooking write), not the Job's — a
    # partial-job booking's own range is more precise than the Job's full
    # span would be.
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    call_time: Optional[str] = None
    venue: Optional[str] = None
    timezone: str = "Europe/London"


@dataclass
class Person:
    id: str
    name: str
    calendar_feed_token: str


@dataclass
class AvailabilityBlock:
    """A Holiday or TOIL Availability entry — the only two Availability.type
    values either feed renders (see AVAILABILITY_ICS_LABEL below). Everything
    else (Sick, Other, Bank Holiday, and untyped/generic Unavailable — the
    common freelancer "blocked out" entry) stays excluded from both feeds,
    same as before this feature: the concern that originally kept Availability
    out of the feed entirely was freelancer noise from blanket unavailability,
    and that concern doesn't apply to a specifically-typed Holiday/TOIL entry
    regardless of whether the person happens to be staff or a freelancer —
    confirmed directly against production data that nothing in the backend or
    frontend actually restricts these two types to staff (CreateAvailability
    has no employment_type check, and AddAvailabilityForm's Reason dropdown
    offers them to every person), so the type filter alone is the correct and
    sufficient gate, not an additional person-type guard.
    person_name is only used by the Dakboard rendering path (per-person feed
    already knows whose calendar it is; the shared Dakboard feed doesn't)."""

    id: str
    start_date: str
    end_date: str
    type: str  # "annual_leave" | "toil"
    day_portion: str = "full"  # "full" | "am" | "pm" — see migrations/0019
    person_name: Optional[str] = None


@dataclass
class JobSummary:
    """One row of the org-wide Dakboard feed — a Job, its Confirmed crew,
    and enough context for a wall display, not a full Job record."""

    id: str
    name: str
    start_date: str  # "2026-11-14"
    end_date: str    # "2026-11-16"
    location: Optional[str] = None
    crew: list[str] = field(default_factory=list)  # already-formatted "Name (Role)" strings


# ---------------------------------------------------------------------------
# RFC 5545 helpers
# ---------------------------------------------------------------------------

ICS_STATUS = {
    "confirmed": "CONFIRMED",
    "offered": "TENTATIVE",
    "pencilled": "TENTATIVE",
}

# The only two Availability.type values either feed renders — see
# AvailabilityBlock's own docstring for why Sick/Other/Bank Holiday/untyped
# stay excluded. Deliberately short, unambiguous labels ("Holiday"/"TOIL")
# rather than the raw enum value, so a glance at a calendar can't mistake
# one of these for a job name.
AVAILABILITY_ICS_LABEL = {
    "annual_leave": "Holiday",
    "toil": "TOIL",
}


def _escape_text(value: str) -> str:
    """Escape a text value per RFC 5545 §3.3.11 — backslash, semicolon,
    comma, and newline all need escaping inside TEXT properties."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _fold_line(line: str) -> str:
    """RFC 5545 §3.1 requires content lines to be folded at 75 octets, with
    each continuation line starting with a single space. Calendar apps are
    inconsistent about enforcing this, but a feed that ignores it entirely
    risks silent truncation in stricter clients (notably older Outlook)."""
    if len(line.encode("utf-8")) <= 75:
        return line
    folded = []
    current = line
    first = True
    while current:
        limit = 75 if first else 74  # continuation lines lose 1 octet to the leading space
        # Fold on a byte boundary without splitting a multi-byte UTF-8 char.
        chunk = current.encode("utf-8")[:limit].decode("utf-8", errors="ignore")
        folded.append(chunk if first else " " + chunk)
        current = current[len(chunk):]
        first = False
    return "\r\n".join(folded)


def _dt_local(date_str: str, time_str: str) -> str:
    """Format a date + time as a floating local datetime (no Z suffix) with
    a TZID reference handled separately — DTSTART/DTEND carry the TZID
    parameter, this just formats the value itself: YYYYMMDDTHHMMSS."""
    dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    return dt.strftime("%Y%m%dT%H%M%S")


def _dtstamp_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _date_only(date_str: str, plus_days: int = 0) -> str:
    """Format a bare date (no time component) as YYYYMMDD, for an all-day
    VEVENT's DTSTART/DTEND;VALUE=DATE. plus_days shifts the date forward —
    used for DTEND, which RFC 5545 §3.6.1 treats as exclusive for all-day
    events (a job running start..end DATE-wise needs DTEND = end + 1 day
    to actually cover its last day on the calendar)."""
    dt = datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=plus_days)
    return dt.strftime("%Y%m%d")


# ---------------------------------------------------------------------------
# VEVENT generation — one per contiguous run of uniform BookingShifts, not
# one per shift. Per-day BookingShift rows exist to represent day-varying
# call times (see the module docstring) — but the per-day booking coverage
# feature also creates one identical 09:00-17:00 "All days" shift per day by
# default (see booking_shifts.go's defaultShiftTimes), which is the common
# case for a booking nobody has actually set day-varying times on. Rendering
# THAT as N separate daily VEVENTs is what produced the reported bug: a
# single multi-day booking splitting into a separate event per day in a
# subscriber's calendar app, instead of the one continuous event the same
# multi-day span renders as everywhere else the app shows it. Grouping
# contiguous, identical-time shifts back into one VEVENT fixes that while
# still rendering genuinely day-varying call times (or an actual gap, e.g.
# covering day 1 and day 3 but not day 2 of a 3-day job) as separate events,
# since those breaks are real information a subscriber needs to see.
# ---------------------------------------------------------------------------


def _group_contiguous_shifts(shifts: list[BookingShift]) -> list[list[BookingShift]]:
    """Groups shifts into runs where each run is consecutive calendar days
    with identical call_time/end_time/venue/timezone. A run of length 1 is
    just an ordinary single-day shift — venue is included in the grouping
    key (not just times) since a run spanning two different venues would
    render one of them under the wrong LOCATION if merged."""
    ordered = sorted(shifts, key=lambda s: s.date)
    runs: list[list[BookingShift]] = []
    for shift in ordered:
        if runs:
            prev = runs[-1][-1]
            prev_date = datetime.strptime(prev.date, "%Y-%m-%d")
            shift_date = datetime.strptime(shift.date, "%Y-%m-%d")
            contiguous = shift_date == prev_date + timedelta(days=1)
            uniform = (
                shift.call_time == prev.call_time
                and shift.end_time == prev.end_time
                and shift.venue == prev.venue
                and shift.timezone == prev.timezone
            )
            if contiguous and uniform:
                runs[-1].append(shift)
                continue
        runs.append([shift])
    return runs


def _booking_text(booking: Booking) -> tuple[str, str, str]:
    """SUMMARY/DESCRIPTION/STATUS are identical regardless of whether a
    booking renders as one merged run, several runs, or the no-shifts
    fallback — factored out once rather than duplicated at each call site."""
    summary = _escape_text(f"{booking.job_name} ({booking.role})")
    status = ICS_STATUS.get(booking.status, "TENTATIVE")

    description_parts = [f"Client: {booking.client_name}", f"Role: {booking.role}"]
    if booking.status == "offered":
        description_parts.append("Status: offer pending your response — not yet confirmed.")
    elif booking.status == "pencilled":
        description_parts.append("Status: pencilled — you're being held for this, not yet formally offered or confirmed.")
    if booking.notes:
        description_parts.append(booking.notes)
    # Escape each part's raw content individually, THEN join with the
    # RFC 5545 newline escape (\n) — joining first and escaping the whole
    # string afterwards would double-escape that backslash into \\n.
    description = "\\n".join(_escape_text(part) for part in description_parts)
    return summary, description, status


def _run_to_vevent(booking: Booking, run: list[BookingShift]) -> str:
    first, last = run[0], run[-1]
    # Stable across the run's own lifetime: the first shift's id doesn't
    # change if a later day gets added/removed from the same contiguous
    # uniform run, so a calendar app sees an UPDATE to the same event
    # (matching LAST-MODIFIED) rather than a delete+recreate.
    uid = f"ralto-shift-{first.id}@ralto.app"
    dtstamp = _dtstamp_now()
    dtstart = _dt_local(first.date, first.call_time)
    dtend = _dt_local(last.date, last.end_time)
    summary, description, status = _booking_text(booking)
    location = _escape_text(first.venue)
    last_modified = (booking.last_modified or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;TZID={first.timezone}:{dtstart}",
        f"DTEND;TZID={first.timezone}:{dtend}",
        f"SUMMARY:{summary}",
        f"LOCATION:{location}",
        f"DESCRIPTION:{description}",
        f"STATUS:{status}",
        f"LAST-MODIFIED:{last_modified}",
        "END:VEVENT",
    ]
    return "\r\n".join(_fold_line(l) for l in lines)


def _booking_fallback_vevent(booking: Booking) -> Optional[str]:
    """Renders a booking that has no BookingShift rows at all (created
    before syncBookingShifts existed to keep them populated — see
    booking_shifts.go) as a single VEVENT spanning the Booking's own
    start_date/end_date, instead of the booking being silently dropped from
    the feed entirely, which is what happened before this fix (confirmed
    directly: 'UEL PFC Levski Sofia', a real live confirmed booking, had
    zero shift rows and was simply absent from the subscriber's feed —
    worse than the reported splitting bug, since a missing booking on a
    personal calendar is exactly the kind of gap that causes a real
    double-booking)."""
    if not booking.start_date or not booking.end_date:
        return None
    uid = f"ralto-booking-{booking.id}@ralto.app"
    dtstamp = _dtstamp_now()
    call = (booking.call_time or "09:00").strip() or "09:00"
    try:
        end = (datetime.strptime(call, "%H:%M") + timedelta(hours=8)).strftime("%H:%M")
    except ValueError:
        call, end = "09:00", "17:00"
    dtstart = _dt_local(booking.start_date, call)
    dtend = _dt_local(booking.end_date, end)
    summary, description, status = _booking_text(booking)
    location = _escape_text(booking.venue or "Venue TBC")
    last_modified = (booking.last_modified or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;TZID={booking.timezone}:{dtstart}",
        f"DTEND;TZID={booking.timezone}:{dtend}",
        f"SUMMARY:{summary}",
        f"LOCATION:{location}",
        f"DESCRIPTION:{description}",
        f"STATUS:{status}",
        f"LAST-MODIFIED:{last_modified}",
        "END:VEVENT",
    ]
    return "\r\n".join(_fold_line(l) for l in lines)


def _booking_to_vevents(booking: Booking) -> list[str]:
    if not booking.shifts:
        fallback = _booking_fallback_vevent(booking)
        return [fallback] if fallback else []
    runs = _group_contiguous_shifts(booking.shifts)
    return [_run_to_vevent(booking, run) for run in runs]


# ---------------------------------------------------------------------------
# Holiday/TOIL VEVENT generation — shared by both feeds (per-person and
# Dakboard), since the rendering only differs in whether the person's name
# needs to be spelled out in SUMMARY. All-day: Availability records carry no
# time-of-day at all (no call_time-equivalent column — see the model), just
# a date range plus the AM/PM-only DayPortion flag from testing feedback S,
# which is noted in DESCRIPTION rather than folded into SUMMARY so the title
# itself stays exactly "Holiday" / "TOIL", per the brief's own instruction
# not to leave these ambiguous with a job name.
# ---------------------------------------------------------------------------


def _availability_to_vevent(av: AvailabilityBlock, *, include_person_name: bool) -> Optional[str]:
    label = AVAILABILITY_ICS_LABEL.get(av.type)
    if label is None:
        return None  # defensive — callers are expected to have already filtered to Holiday/TOIL only

    uid_prefix = "ralto-dakboard-availability" if include_person_name else "ralto-availability"
    uid = f"{uid_prefix}-{av.id}@ralto.app"
    dtstamp = _dtstamp_now()
    dtstart = _date_only(av.start_date)
    dtend = _date_only(av.end_date, plus_days=1)  # DTEND is exclusive for all-day events

    summary_text = f"{label} — {av.person_name}" if include_person_name and av.person_name else label
    summary = _escape_text(summary_text)

    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;VALUE=DATE:{dtstart}",
        f"DTEND;VALUE=DATE:{dtend}",
        f"SUMMARY:{summary}",
        "STATUS:CONFIRMED",  # a recorded Holiday/TOIL entry, not a pencilled/offered booking — see module docstring
    ]
    if av.day_portion in ("am", "pm"):
        lines.append(f"DESCRIPTION:{_escape_text(av.day_portion.upper() + ' only')}")
    lines.append("END:VEVENT")
    return "\r\n".join(_fold_line(l) for l in lines)


# ---------------------------------------------------------------------------
# Full feed generation
# ---------------------------------------------------------------------------


def generate_ics_feed(person: Person, bookings: list[Booking], availability: Optional[list[AvailabilityBlock]] = None) -> str:
    """Generate a complete .ics feed for one person's bookings, plus their
    Holiday/TOIL Availability entries (see AvailabilityBlock).

    Confirmed and offered (tentative) bookings are both included — see the
    module docstring for why. Cancelled/declined bookings are assumed to
    already be filtered out by the caller before this function is reached;
    this function has no opinion on booking lifecycle, only on rendering.
    Same division of responsibility for availability: the caller is
    expected to have already scoped it to type IN ('annual_leave', 'toil')
    for this person within the feed's date window — this function renders
    whatever it's handed (_availability_to_vevent skips anything else
    defensively, but shouldn't need to in practice).
    """
    vevents = []
    for booking in bookings:
        vevents.extend(_booking_to_vevents(booking))
    for av in availability or []:
        vevent = _availability_to_vevent(av, include_person_name=False)
        if vevent:
            vevents.append(vevent)

    header = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Crewing//Crew Booking Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:Crewing — {_escape_text(person.name)}'s bookings",
        "X-WR-TIMEZONE:Europe/London",
        # Refresh hints — most calendar apps poll on their own schedule
        # regardless, but this documents the intent and some clients (e.g.
        # some Google Calendar / Outlook versions) do respect it.
        "X-PUBLISHED-TTL:PT1H",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ]
    footer = ["END:VCALENDAR"]

    body = "\r\n".join(header) + "\r\n" + "\r\n".join(vevents) + "\r\n" + "\r\n".join(footer)
    return body + "\r\n"


# ---------------------------------------------------------------------------
# Org-wide Dakboard feed — deliberately separate from the per-person feed
# above (own dataclass, own VEVENT shape, own top-level generator). One
# VEVENT per Job, not per shift: this is a dashboard "what's on" view, not
# a crew member's own day-by-day schedule, so per-shift call-time detail
# would be noise here.
# ---------------------------------------------------------------------------


def _job_to_vevent(job: JobSummary) -> str:
    uid = f"ralto-dakboard-job-{job.id}@ralto.app"
    dtstamp = _dtstamp_now()
    dtstart = _date_only(job.start_date)
    dtend = _date_only(job.end_date, plus_days=1)  # DTEND is exclusive for all-day events

    summary = _escape_text(job.name)
    description = _escape_text(", ".join(job.crew) if job.crew else "No crew confirmed yet")

    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;VALUE=DATE:{dtstart}",
        f"DTEND;VALUE=DATE:{dtend}",
        f"SUMMARY:{summary}",
        f"DESCRIPTION:{description}",
        "STATUS:CONFIRMED",  # only Booked/firm-commitment jobs reach this feed at all
    ]
    if job.location:
        lines.append(f"LOCATION:{_escape_text(job.location)}")
    lines.append("END:VEVENT")
    return "\r\n".join(_fold_line(l) for l in lines)


def generate_dakboard_ics_feed(jobs: list[JobSummary], availability: Optional[list[AvailabilityBlock]] = None) -> str:
    """Generate the org-wide Dakboard feed: one event per Booked/firm-
    commitment, non-cancelled Job, description listing only its Confirmed
    crew — plus one event per Holiday/TOIL Availability entry org-wide,
    each attributed to the person it belongs to (see AvailabilityBlock —
    unlike the per-person feed, whose calendar it is isn't already implicit
    here, so include_person_name=True). Filtering (commitment/status/
    booking-status/availability type) is the caller's job, same division of
    responsibility as generate_ics_feed above — this function only renders
    what it's handed.
    """
    vevents = [_job_to_vevent(job) for job in jobs]
    for av in availability or []:
        vevent = _availability_to_vevent(av, include_person_name=True)
        if vevent:
            vevents.append(vevent)

    header = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Crewing//Dakboard Jobs Feed//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Crewing — Booked jobs",
        "X-WR-TIMEZONE:Europe/London",
        "X-PUBLISHED-TTL:PT1H",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ]
    footer = ["END:VCALENDAR"]

    body = "\r\n".join(header) + "\r\n" + "\r\n".join(vevents) + "\r\n" + "\r\n".join(footer)
    return body + "\r\n"


# ---------------------------------------------------------------------------
# Minimal structural validator — since this environment has no network
# access to install the `icalendar` package for round-trip validation, this
# checks the output against the RFC 5545 rules that actually matter for a
# calendar app to accept the feed, rather than trusting it blindly.
# ---------------------------------------------------------------------------


def validate_ics(text: str) -> list[str]:
    problems = []
    lines = text.split("\r\n")
    if lines[-1] == "":
        lines = lines[:-1]

    if not text.endswith("\r\n"):
        problems.append("File does not end with CRLF.")
    if lines[0] != "BEGIN:VCALENDAR":
        problems.append("First line must be BEGIN:VCALENDAR.")
    if lines[-1] != "END:VCALENDAR":
        problems.append("Last line must be END:VCALENDAR.")

    # Every BEGIN:X must have a matching END:X, properly nested.
    stack = []
    for line in lines:
        if line.startswith("BEGIN:"):
            stack.append(line[6:])
        elif line.startswith("END:"):
            if not stack or stack[-1] != line[4:]:
                problems.append(f"Unmatched or misnested {line}")
            else:
                stack.pop()
    if stack:
        problems.append(f"Unclosed block(s): {stack}")

    # Required calendar-level properties.
    for required in ("VERSION:2.0", "PRODID:"):
        if not any(l.startswith(required) for l in lines):
            problems.append(f"Missing required property starting with {required!r}")

    # Every VEVENT needs UID, DTSTAMP, DTSTART at minimum (RFC 5545 §3.6.1).
    in_event = False
    event_props = set()
    for line in lines:
        if line == "BEGIN:VEVENT":
            in_event = True
            event_props = set()
        elif line == "END:VEVENT":
            for req in ("UID", "DTSTAMP", "DTSTART"):
                if req not in event_props:
                    problems.append(f"A VEVENT is missing required property {req}")
            in_event = False
        elif in_event and ":" in line and not line.startswith(" "):
            prop_name = line.split(":", 1)[0].split(";")[0]
            event_props.add(prop_name)

    # Line-length folding check (informational — many clients tolerate long
    # lines, but a strict one may not).
    for line in text.split("\r\n"):
        if len(line.encode("utf-8")) > 75 and not line.startswith(" "):
            problems.append(f"Unfolded line exceeds 75 octets: {line[:50]}...")

    # Double-escaping check — a literal "\\n" (backslash-backslash-n) in a
    # DESCRIPTION means a newline escape got escaped again, which is exactly
    # the bug this generator had during development. A correct escaped
    # newline is a single backslash followed by n.
    for line in lines:
        if line.startswith("DESCRIPTION") and "\\\\n" in line:
            problems.append("DESCRIPTION contains a double-escaped newline (\\\\n) — likely escaped twice.")

    return problems


# ---------------------------------------------------------------------------
# Demo — same sample jobs used across the rest of Crewing's prototypes, built
# out as one crew member's booking list to show the feed end to end.
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    person = Person(id="p-sam-ortiz", name="Sam Ortiz", calendar_feed_token=str(uuid.uuid4()))

    bookings = [
        Booking(
            id="bk-ufc327",
            job_name="UFC 327 — Las Vegas",
            client_name="TNT Sports",
            role="EVS Operator",
            status="confirmed",
            notes="Load-in via loading dock C. Ask for Dana on arrival for badge collection.",
            shifts=[
                # Day-varying call times within one multi-day booking — the
                # exact case the schema addendum calls out BookingShift for.
                BookingShift(id="sh-ufc327-1", date="2026-11-14", call_time="14:00", end_time="20:00", venue="T-Mobile Arena, Las Vegas"),
                BookingShift(id="sh-ufc327-2", date="2026-11-15", call_time="10:00", end_time="18:00", venue="T-Mobile Arena, Las Vegas"),
                BookingShift(id="sh-ufc327-3", date="2026-11-16", call_time="07:00", end_time="23:30", venue="T-Mobile Arena, Las Vegas"),
            ],
        ),
        Booking(
            id="bk-riyadh",
            job_name="Riyadh Boxing",
            client_name="Kingdom Sports Group",
            role="EVS Operator",
            status="offered",
            shifts=[
                BookingShift(id="sh-riyadh-1", date="2026-12-05", call_time="09:00", end_time="22:00", venue="Kingdom Arena, Riyadh", timezone="Asia/Riyadh"),
            ],
        ),
        # Regression case for the reported bug: 5 identical "All days"
        # 09:00-17:00 default shifts (see booking_shifts.go's
        # defaultShiftTimes) on consecutive days — must collapse to ONE
        # VEVENT spanning 10-14 Oct, not 5 separate daily events.
        Booking(
            id="bk-sabeh-slavia",
            job_name="FC Sabeh v Slavia",
            client_name="UEFA",
            role="Engineering Manager",
            status="confirmed",
            shifts=[
                BookingShift(id="sh-sabeh-1", date="2026-10-10", call_time="09:00", end_time="17:00", venue="Olympic Stadium", timezone="Asia/Baku"),
                BookingShift(id="sh-sabeh-2", date="2026-10-11", call_time="09:00", end_time="17:00", venue="Olympic Stadium", timezone="Asia/Baku"),
                BookingShift(id="sh-sabeh-3", date="2026-10-12", call_time="09:00", end_time="17:00", venue="Olympic Stadium", timezone="Asia/Baku"),
                BookingShift(id="sh-sabeh-4", date="2026-10-13", call_time="09:00", end_time="17:00", venue="Olympic Stadium", timezone="Asia/Baku"),
                BookingShift(id="sh-sabeh-5", date="2026-10-14", call_time="09:00", end_time="17:00", venue="Olympic Stadium", timezone="Asia/Baku"),
            ],
        ),
        # Genuinely non-uniform: covering day 1 and day 3 of a 3-day job,
        # not day 2 — must stay TWO separate VEVENTs, not collapse into one
        # block spanning day 1-3 (which would wrongly imply covering the
        # gap day too).
        Booking(
            id="bk-gap-job",
            job_name="MCWFC v Arsenal",
            client_name="Man City",
            role="Camera Op",
            status="confirmed",
            shifts=[
                BookingShift(id="sh-gap-1", date="2026-10-03", call_time="09:00", end_time="17:00", venue="Etihad Stadium"),
                BookingShift(id="sh-gap-3", date="2026-10-05", call_time="09:00", end_time="17:00", venue="Etihad Stadium"),
            ],
        ),
        # No BookingShift rows at all — a booking created before
        # syncBookingShifts existed. Must render as ONE fallback VEVENT
        # spanning the Booking's own start_date/end_date, not be dropped.
        Booking(
            id="bk-legacy-no-shifts",
            job_name="UEL PFC Levski Sofia",
            client_name="UEFA",
            role="Tech Manager",
            status="confirmed",
            start_date="2026-09-15",
            end_date="2026-09-18",
            venue="Etihad Stadium",
        ),
    ]

    # Holiday/TOIL feature — one of each type, plus one AM-only TOIL entry
    # to exercise the DESCRIPTION day-portion note. Sick/Other/Bank Holiday
    # aren't modelled here at all since the caller (main.py) is responsible
    # for never handing this function anything but annual_leave/toil in the
    # first place — validated separately below via the defensive None
    # return in _availability_to_vevent.
    availability = [
        AvailabilityBlock(id="av-holiday-1", start_date="2026-12-24", end_date="2026-12-31", type="annual_leave"),
        AvailabilityBlock(id="av-toil-1", start_date="2026-11-03", end_date="2026-11-03", type="toil", day_portion="am"),
    ]

    feed = generate_ics_feed(person, bookings, availability)

    problems = validate_ics(feed)
    print("=== Validation ===")
    if problems:
        for p in problems:
            print(f"  ISSUE: {p}")
    else:
        print("  No structural issues found.")

    print("\n=== Regression checks ===")
    sabeh_events = feed.count("FC Sabeh v Slavia")
    gap_events = feed.count("MCWFC v Arsenal")
    legacy_events = feed.count("UEL PFC Levski Sofia")
    assert sabeh_events == 1, f"expected FC Sabeh v Slavia to collapse to 1 VEVENT, got {sabeh_events}"
    assert gap_events == 2, f"expected the day1+day3 gap booking to stay 2 VEVENTs, got {gap_events}"
    assert legacy_events == 1, f"expected the no-shifts legacy booking to render as 1 fallback VEVENT, got {legacy_events}"
    print("  FC Sabeh v Slavia (5 uniform contiguous shifts) -> 1 VEVENT: OK")
    print("  MCWFC v Arsenal (day 1 + day 3, gap on day 2) -> 2 VEVENTs: OK")
    print("  UEL PFC Levski Sofia (0 shift rows) -> 1 fallback VEVENT: OK")

    assert feed.count("SUMMARY:Holiday") == 1, "expected exactly one bare 'Holiday' SUMMARY on the per-person feed"
    assert feed.count("SUMMARY:TOIL") == 1, "expected exactly one bare 'TOIL' SUMMARY on the per-person feed"
    assert "DESCRIPTION:AM only" in feed, "expected the AM-only TOIL entry's day-portion note"
    assert _availability_to_vevent(AvailabilityBlock(id="x", start_date="2026-01-01", end_date="2026-01-01", type="sick"), include_person_name=False) is None
    print("  Holiday -> 1 bare-titled all-day VEVENT: OK")
    print("  TOIL (AM only) -> 1 VEVENT with day-portion DESCRIPTION: OK")
    print("  Sick type -> no VEVENT (defensive filter): OK")

    dakboard_feed = generate_dakboard_ics_feed(
        [],
        [AvailabilityBlock(id="av-holiday-1", start_date="2026-12-24", end_date="2026-12-31", type="annual_leave", person_name="Sam Ortiz")],
    )
    assert "SUMMARY:Holiday — Sam Ortiz" in dakboard_feed, "expected the Dakboard feed to attribute the Holiday event to the person"
    print("  Dakboard Holiday event attributed to person name: OK")

    print("\n=== Feed preview ===")
    print(feed)
