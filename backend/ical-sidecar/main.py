"""
Ralto iCal sidecar
==================

A thin FastAPI wrapper around ical_feed.py. Serves two genuinely separate
feeds, sharing only this file's DB-connection plumbing and ical_feed.py's
low-level RFC 5545 helpers — getting one has no effect on and exposes
nothing about the other:

- /feed/{token}.ics — one crew member's own confirmed/offered/pencilled
  bookings, looked up by their personal Person.calendar_feed_token.
- /feed/dakboard/{token}.ics — the org-wide "what's booked" view, looked
  up by the shared org_settings.dakboard_feed_token, for an internal
  Dakboard display rather than any one person.

Deployed as its own Render service (see ../render.yaml) rather than folded
into the Go API — see ralto_backend_scaffold_plan.md §4 for why iCal stays
a Python sidecar rather than being ported to Go.
"""

import os

import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse

from ical_feed import AvailabilityBlock, Booking, BookingShift, JobSummary, Person, generate_dakboard_ics_feed, generate_ics_feed

app = FastAPI()


def get_connection():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg2.connect(database_url)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/feed/{token}.ics")
def feed(token: str):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, first_name || ' ' || last_name AS name FROM people WHERE calendar_feed_token = %s",
                (token,),
            )
            person_row = cur.fetchone()
            if not person_row:
                raise HTTPException(status_code=404, detail="Unknown or revoked calendar feed token")
            person = Person(id=person_row["id"], name=person_row["name"], calendar_feed_token=token)

            # Confirmed, offered, and pencilled bookings — declined and
            # cancelled are never useful on a personal calendar. Per the
            # schema addendum's open question (resolved): this feed shows
            # both flavours of tentative booking, not confirmed-only, each
            # rendered with STATUS:TENTATIVE (see ical_feed.py's module
            # docstring for why that beats a text-prefix hack).
            cur.execute(
                """
                SELECT b.id, b.status, b.notes, b.start_date, b.end_date, b.call_time,
                       j.name AS job_name, c.name AS client_name, ro.name AS role,
                       COALESCE(v.name, 'Venue TBC') AS venue, COALESCE(v.timezone, 'UTC') AS timezone
                FROM bookings b
                JOIN job_requirements jr ON jr.id = b.job_requirement_id
                JOIN jobs j ON j.id = jr.job_id
                JOIN clients c ON c.id = j.client_id
                JOIN roles ro ON ro.id = jr.role_id
                LEFT JOIN venues v ON v.id = j.venue_id
                WHERE b.person_id = %s AND b.status IN ('confirmed', 'offered', 'pencilled')
                """,
                (person_row["id"],),
            )
            booking_rows = cur.fetchall()

            bookings = []
            for row in booking_rows:
                cur.execute(
                    """
                    SELECT bs.id, bs.date, bs.call_time, bs.end_time,
                           COALESCE(v.name, 'Venue TBC') AS venue, COALESCE(v.timezone, 'UTC') AS timezone
                    FROM booking_shifts bs
                    JOIN bookings b ON b.id = bs.booking_id
                    JOIN job_requirements jr ON jr.id = b.job_requirement_id
                    JOIN jobs j ON j.id = jr.job_id
                    LEFT JOIN venues v ON v.id = j.venue_id
                    WHERE bs.booking_id = %s
                    ORDER BY bs.date
                    """,
                    (row["id"],),
                )
                shift_rows = cur.fetchall()
                shifts = [
                    BookingShift(
                        id=str(s["id"]),
                        date=str(s["date"]),
                        call_time=str(s["call_time"])[:5],
                        end_time=str(s["end_time"])[:5],
                        venue=s["venue"],
                        timezone=s["timezone"],
                    )
                    for s in shift_rows
                ]
                # No shifts recorded (a booking created before
                # syncBookingShifts existed — see booking_shifts.go) is NOT
                # skipped: ical_feed.py's fallback path renders it as one
                # VEVENT spanning the Booking's own start_date/end_date
                # instead of it silently going missing from the feed.
                bookings.append(
                    Booking(
                        id=str(row["id"]),
                        job_name=row["job_name"],
                        client_name=row["client_name"],
                        role=row["role"],
                        status=row["status"],
                        notes=row["notes"],
                        shifts=shifts,
                        start_date=str(row["start_date"]) if row["start_date"] else None,
                        end_date=str(row["end_date"]) if row["end_date"] else None,
                        call_time=str(row["call_time"])[:5] if row["call_time"] else None,
                        venue=row["venue"],
                        timezone=row["timezone"],
                    )
                )

            # Holiday/TOIL only — see ical_feed.AvailabilityBlock's own
            # docstring. Sick/Other/Bank Holiday and plain blanket Unavailable
            # (the common freelancer entry, always type IS NULL) stay excluded
            # by the type filter. The employment_type = 'staff' guard is a
            # second, independent gate: Holiday/TOIL is staff-only by policy,
            # and nothing elsewhere stops one being set on a freelancer, so
            # this feed fails safe (drops it) rather than fails open.
            # status = 'unavailable' is redundant with the type filter in
            # practice (CreateAvailability nulls type on any other status)
            # but kept explicit rather than relying on that invariant.
            cur.execute(
                """
                SELECT a.id, a.start_date, a.end_date, a.type, a.day_portion
                FROM availability a
                JOIN people p ON p.id = a.person_id
                WHERE a.person_id = %s AND a.status = 'unavailable' AND a.type IN ('annual_leave', 'toil')
                      AND p.employment_type = 'staff'
                """,
                (person_row["id"],),
            )
            availability = [
                AvailabilityBlock(
                    id=str(a["id"]),
                    start_date=str(a["start_date"]),
                    end_date=str(a["end_date"]),
                    type=a["type"],
                    day_portion=a["day_portion"],
                )
                for a in cur.fetchall()
            ]
    finally:
        conn.close()

    ics = generate_ics_feed(person, bookings, availability)
    return PlainTextResponse(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="ralto-{token}.ics"'},
    )


@app.get("/feed/dakboard/{token}.ics")
def dakboard_feed(token: str):
    conn = get_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT organisation_id FROM org_settings WHERE dakboard_feed_token = %s",
                (token,),
            )
            org_row = cur.fetchone()
            if not org_row:
                raise HTTPException(status_code=404, detail="Unknown or revoked dakboard feed token")
            organisation_id = org_row["organisation_id"]

            # Booked/firm-commitment, non-cancelled Jobs only. commitment is
            # the job-level commercial-certainty flag (migrations/0004_pencil.sql)
            # — deliberately not a check that every crew slot on the job is
            # individually Confirmed; that distinction is applied per-job
            # below, on the crew list only.
            cur.execute(
                """
                SELECT j.id, j.name, j.start_date, j.end_date,
                       v.name AS venue_name, v.city AS venue_city
                FROM jobs j
                LEFT JOIN venues v ON v.id = j.venue_id
                WHERE j.organisation_id = %s AND j.commitment = 'firm' AND j.status != 'cancelled'
                ORDER BY j.start_date
                """,
                (organisation_id,),
            )
            job_rows = cur.fetchall()

            jobs = []
            for row in job_rows:
                # Only crew individually Confirmed on this job — Offered or
                # pencilled crew are left out, even though the job itself
                # already qualifies as "Booked" at the job level.
                cur.execute(
                    """
                    SELECT p.first_name || ' ' || p.last_name AS name, ro.name AS role
                    FROM bookings b
                    JOIN job_requirements jr ON jr.id = b.job_requirement_id
                    JOIN people p ON p.id = b.person_id
                    JOIN roles ro ON ro.id = jr.role_id
                    WHERE jr.job_id = %s AND b.status = 'confirmed'
                    ORDER BY ro.name, p.first_name
                    """,
                    (row["id"],),
                )
                crew_rows = cur.fetchall()

                location = row["venue_name"]
                if location and row["venue_city"]:
                    location = f'{location}, {row["venue_city"]}'

                jobs.append(
                    JobSummary(
                        id=str(row["id"]),
                        name=row["name"],
                        start_date=str(row["start_date"]),
                        end_date=str(row["end_date"]),
                        location=location,
                        crew=[f'{c["name"]} ({c["role"]})' for c in crew_rows],
                    )
                )

            # Holiday/TOIL, org-wide — same type scope and staff-only guard
            # as the per-person feed (see AvailabilityBlock's docstring),
            # attributed to each person by name since this feed isn't
            # implicitly "whose calendar" the way the per-person one is.
            cur.execute(
                """
                SELECT a.id, a.start_date, a.end_date, a.type, a.day_portion,
                       p.first_name || ' ' || p.last_name AS person_name
                FROM availability a
                JOIN people p ON p.id = a.person_id
                WHERE a.organisation_id = %s AND a.status = 'unavailable' AND a.type IN ('annual_leave', 'toil')
                      AND p.employment_type = 'staff'
                ORDER BY a.start_date
                """,
                (organisation_id,),
            )
            availability = [
                AvailabilityBlock(
                    id=str(a["id"]),
                    start_date=str(a["start_date"]),
                    end_date=str(a["end_date"]),
                    type=a["type"],
                    day_portion=a["day_portion"],
                    person_name=a["person_name"],
                )
                for a in cur.fetchall()
            ]
    finally:
        conn.close()

    ics = generate_dakboard_ics_feed(jobs, availability)
    return PlainTextResponse(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'inline; filename="ralto-dakboard-{token}.ics"'},
    )
