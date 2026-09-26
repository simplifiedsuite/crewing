# Ralto — Schema Addendum v3

Companion to *Ralto — Data Model & Schema v0.1* and Addenda v1–v2. Covers the
freelancer offer/pencil/confirm workflow now that SendGrid is live: how the
ask goes out, how freelancers respond, and how the buyout/invoicing email
and PDF get generated at confirmation.

---

## 1. Freelancer status flow

**Decision:** for a freelancer `Booking`, the existing status enum is used in
this order: `Offered → Pencilled → Confirmed`.

```
Offered     — the ask has gone out. Awaiting a reply. Can take days —
              freelancers commonly need to shuffle other commitments
              before answering.
Pencilled   — the freelancer has said yes. An informal hold: fires a
              "you've been pencilled" notice, but carries no commercial
              commitment yet — no buyout, no invoicing detail.
Confirmed   — the scheduler presses Confirm (or Confirm Everyone), once
              terms are actually settled. Can happen weeks after the
              Pencil. Fires the buyout & invoicing email with PDF attached.
```

**Enforced, not just conventional:** for a freelancer booking, Confirm is
only a legal transition from Pencilled — there's no direct
`Offered → Confirmed`. A scheduler has to record the Pencil step (either
response path) first. Staff bookings are unaffected by this restriction —
they're allocated directly and don't go through Offered at all in the
normal case.

**Correction to Addendum v2 §4:** that addendum stated Pencilled "shouldn't
fire an offer notification." That's still true in spirit but was imprecise —
the distinction is *which* notification, not notification-or-nothing.
Pencilled fires the informal hold notice; it's specifically the buyout/PDF
that waits for Confirmed. Addendum v2's enum ordering (`Pencilled` before
`Offered`) reflects general precedence for holds made without a prior ask
(e.g. an internal/staff hold); the freelancer path above is the specific
transition sequence for that employment type and doesn't require an enum
change.

**Decline**, at either `Offered` or `Pencilled`, notifies the scheduler and
reopens the requirement — no change to the existing decline handling in the
base schema.

---

## 2. Two response paths — both first-class

**Decision:** every stage transition for a freelancer can be reached two
ways, and neither is a fallback for the other:

- **Self-service** — a tokenised link in the email lets the freelancer
  accept/decline (at `Offered`) or the confirmation flows through without
  the freelancer needing to log in.
- **Scheduler-manual** — the scheduler asks by phone/WhatsApp/in person and
  records the outcome directly against the booking. Schedulers value the
  personal relationship with freelancers as part of what gets people to
  take jobs, so this has to be as easy as the self-service path, not a
  backdoor.

**Schema:**

```
Booking
  ...existing fields...
  response_channel   (enum: self_service | scheduler_manual, nullable
                       until responded — set whenever a transition
                       happens as the result of an actual response, not
                       every status write. Also the signal
                       ListMyBookings/GetMyBooking use to distinguish a
                       freelancer's own real Pencilled response
                       (response_channel set — visible to them) from a
                       scheduler's own provisional hold with no ask sent
                       yet (response_channel null — stays hidden, same as
                       before this addendum) — not reporting/audit-only
                       after all.
  confirmed_by        (uuid -> users, nullable — the scheduler who pressed
                       Confirm; populates "Authorised by" on the buyout PDF.
                       References `users`, not `people` — scheduler
                       identity lives in a separate table from crew in
                       this schema.)
```

**Token invalidation:** if a scheduler manually records a response after an
email has already gone out (freelancer called back before clicking the
link), the outstanding token is invalidated. A stale link should land on a
plain "this offer's already been actioned" page — not an error, not a
conflicting write.

**No email sent at all** is a valid path — if a scheduler handles the ask
personally before any `NotificationDelivery` row is created, none is
created retroactively. The written record still arrives at the *next*
stage transition (the Pencil notice, then the buyout email), so nothing is
lost — it just isn't the vehicle for the ask itself.

---

## 3. Notifications — two mails, two triggers

Building on the `Notification` / `NotificationDelivery` split from Addendum
v1 §4 (unchanged):

| Notification type | Fires on | Content |
|---|---|---|
| `booking_pencilled` | `Booking.status → Pencilled` (either response path) | Job, role, dates, venue, call time. Informal "you're pencilled" tone — no rate, no buyout, no PDF. |
| `booking_confirmed` | `Booking.status → Confirmed` (Confirm or Confirm Everyone) | Buyout & invoicing PDF attached (see §5). |

Both are ordinary `Notification` rows with an `email` `NotificationDelivery`
— no new delivery mechanism, just two new `type` values and the PDF
attachment on the second.

---

## 4. Rate resolution order

**Decision:** two override mechanisms, resolved in this priority when
calculating what a booking pays:

```
1. Booking.rate_override      — one-off, this-booking-only (e.g. a longer
                                 day warranting a bump)
2. PersonRole.rate             — standing rate tied to a specific role
                                 (e.g. Dan Briney's higher rate when booked
                                 as Vision Mix Director, vs his primary
                                 VT-op rate)
3. Person.standard_rate        — the default
```

**Schema:**

```
PersonRole
  ...existing fields (person_id, role_id, is_primary)...
  rate           (decimal, nullable — overrides Person.standard_rate only
                  when booked into this specific role)
```

`PersonRole.rate` is set once against the role and applies automatically
every time that person is booked into it — no re-entry per booking. It sits
between the one-off `Booking.rate_override` and the person-wide default.

---

## 5. Buyout PDF

**Decision:** system-generated at `Confirmed`, from booking data — same
live-assembly pattern as the call sheet (Addendum v0.1 §7: never a stored
document, always rendered fresh from current data at send time). Modelled
on LDM.tv's existing template.

**Calculation:**

```
TOTAL VALUE = RATE × DAYS
```

The real template carries an unused manual-deduction cell (always blank in
practice) — left out of v1. Can be added back if it turns out to matter.

**Field mapping — all from existing entities, no new booking-level fields
beyond `confirmed_by` (§2):**

| PDF field | Source |
|---|---|
| Name | `Person.first_name` + `last_name` |
| Company | `Person.company_name` (existing field) |
| Role | the `Role` on the `JobRequirement` this booking fills |
| Date(s) | `Booking.start_date`–`end_date` |
| Days | counted from `BookingShift` rows if any exist for the booking (handles a rest day inside the range, e.g. booked Fri–Mon but not paid for the weekend), else `end_date − start_date + 1` |
| Rate | resolved per §4 |
| Total value | computed |
| Job name | `Job.name` |
| Buyout reference | `Job.project_reference` |
| Additional notes | `Booking.notes` |
| Authorised by | `User` at `Booking.confirmed_by` — whoever pressed Confirm |

**Org-level settings** for the boilerplate (invoicing instructions, T&Cs,
billing address, contact emails) — a Crewing-local entity, since this is
crewing-specific and has no use in Equipment or Expenses:

```
OrgBuyoutSettings (one row per org)
  org_id
  company_legal_name         e.g. "LDM.tv Ltd"
  billing_address            multi-line
  invoice_email              e.g. invoice@ldm.tv
  accounts_email             e.g. accounts@ldm.tv
  operations_email           e.g. operations@ldm.tv
  rate_query_contact_name    e.g. "Becca Bracewell"
  rate_query_contact_email
  accident_report_url
  payment_terms_days         default 30
  invoice_window_days        default ~180 (6 months)
  cancellation_notice_hours  default 48
```

The T&Cs paragraphs themselves (cancellation, equipment damage,
professionalism, accident reporting, GDPR) stay as fixed copy in the
template with the fields above interpolated in — the legal wording isn't
freely editable per org in v1, only the contact details and numbers that
actually vary. LDM.tv gets the one populated row now; the next org using
the suite is a new row, not a re-architecture.

---

## 6. Summary of schema changes

| Entity | Change |
|---|---|
| **Booking** | Add `response_channel` (enum: `self_service \| scheduler_manual`, nullable); add `confirmed_by` (uuid → users, nullable) |
| **PersonRole** | Add `rate` (decimal, nullable) — standing rate override for a specific role |
| **Notification** | Add `type` values: `booking_pencilled`, `booking_confirmed` (replacing/refining the earlier generic `booking_offered` for the freelancer path) |
| **OrgBuyoutSettings** | New entity (Crewing-local) — org-level contact details and terms feeding the buyout template |
| **Job, Person, JobRequirement, BookingShift** | No changes — `project_reference`, `company_name`, `Role`, and `BookingShift` day-counting are all already in place |

No changes to `Client`, `Venue`, `Availability`, `AvailabilityRequest`, or
`OperationalAlert`.

---

*This addendum assumes Addenda v1 and v2 as prior context. The token/
magic-link mechanism for self-service response (§2) and the SendGrid
send/webhook integration itself are implementation detail for the Claude
Code prompts, not schema — no further data-model impact expected there
beyond the token needing somewhere to live (likely a short-lived value on
the `Notification` row itself, or a small dedicated table if it needs its
own expiry/audit trail — worth deciding at prompt-writing time rather than
here).*
