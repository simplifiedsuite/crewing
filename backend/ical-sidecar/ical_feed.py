"""
Ralto iCal feed generator
=========================

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


@dataclass
class Person:
    id: str
    name: str
    calendar_feed_token: str


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
# VEVENT generation — one per BookingShift
# ---------------------------------------------------------------------------


def _shift_to_vevent(booking: Booking, shift: BookingShift) -> str:
    uid = f"ralto-shift-{shift.id}@ralto.app"
    dtstamp = _dtstamp_now()
    dtstart = _dt_local(shift.date, shift.call_time)
    dtend = _dt_local(shift.date, shift.end_time)
    status = ICS_STATUS.get(booking.status, "TENTATIVE")

    summary = _escape_text(f"{booking.job_name} ({booking.role})")
    location = _escape_text(shift.venue)

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

    last_modified = (booking.last_modified or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")

    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;TZID={shift.timezone}:{dtstart}",
        f"DTEND;TZID={shift.timezone}:{dtend}",
        f"SUMMARY:{summary}",
        f"LOCATION:{location}",
        f"DESCRIPTION:{description}",
        f"STATUS:{status}",
        f"LAST-MODIFIED:{last_modified}",
        "END:VEVENT",
    ]
    return "\r\n".join(_fold_line(l) for l in lines)


# ---------------------------------------------------------------------------
# Full feed generation
# ---------------------------------------------------------------------------


def generate_ics_feed(person: Person, bookings: list[Booking]) -> str:
    """Generate a complete .ics feed for one person's bookings.

    Confirmed and offered (tentative) bookings are both included — see the
    module docstring for why. Cancelled/declined bookings are assumed to
    already be filtered out by the caller before this function is reached;
    this function has no opinion on booking lifecycle, only on rendering.
    """
    vevents = []
    for booking in bookings:
        for shift in booking.shifts:
            vevents.append(_shift_to_vevent(booking, shift))

    header = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Ralto//Crew Booking Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:Ralto — {_escape_text(person.name)}'s bookings",
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


def generate_dakboard_ics_feed(jobs: list[JobSummary]) -> str:
    """Generate the org-wide Dakboard feed: one event per Booked/firm-
    commitment, non-cancelled Job, description listing only its Confirmed
    crew. Filtering (commitment/status/booking-status) is the caller's
    job, same division of responsibility as generate_ics_feed above — this
    function only renders what it's handed.
    """
    vevents = [_job_to_vevent(job) for job in jobs]

    header = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Ralto//Dakboard Jobs Feed//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Ralto — Booked jobs",
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
# Demo — same sample jobs used across the rest of Ralto's prototypes, built
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
    ]

    feed = generate_ics_feed(person, bookings)

    problems = validate_ics(feed)
    print("=== Validation ===")
    if problems:
        for p in problems:
            print(f"  ISSUE: {p}")
    else:
        print("  No structural issues found.")

    print("\n=== Feed preview ===")
    print(feed)
