# ComplyTrack — User Guide

A task-oriented guide for the people who use ComplyTrack every day. It is
organised by the five roles in the PRD (§2 and §9):

1. [Administrator](#1-administrator)
2. [Compliance Team](#2-compliance-team)
3. [Department User](#3-department-user)
4. [Management View](#4-management-view)
5. [Auditor / Inspector](#5-auditor--inspector)

Before the role sections, read [Signing in](#signing-in),
[Understanding the RAG colours and the Compliance Index](#understanding-the-rag-colours-and-the-compliance-index)
and [What the reminder and escalation e-mails mean](#what-the-reminder-and-escalation-e-mails-mean)
— every role needs those three.

If a button or screen looks different from what is described here, it is almost
always a **permission** difference: the app hides actions a role cannot perform.
Each screen below carries a permission note.

---

## Signing in

**Screen: Login / SSO** (PRD §15 screen 1)

*What it is for:* getting into the system.

*How to get there:* open the ComplyTrack URL. If you are not signed in you land
on the login screen automatically.

*Key actions:*

1. **Microsoft 365 sign-in (preferred).** Click **Sign in with Microsoft** and
   complete the Entra ID prompt. Your role and unit scope are taken from your
   account.
2. **Local sign-in (fallback).** Enter your work e-mail and password, then the
   6-digit code from your authenticator app if MFA is enabled.
3. If your account is locked out after repeated wrong passwords, wait 15 minutes
   or ask an Administrator to reset it. You will be asked to choose a new
   password on next sign-in after a reset.

*Permission note:* everyone signs in the same way; what you see afterwards
depends on your role and your unit/department scope. A Department User only sees
their own scope; Compliance and Management see all units.

---

## Understanding the RAG colours and the Compliance Index

**RAG colours** appear as a chip on every item and row — always with an icon and
text, so colour-blind users can read them.

| Colour | Meaning | When it is shown |
|---|---|---|
| 🔴 **Red** | **Expired** or **Overdue** — act now | The expiry date has passed, or a deadline (statutory due date or internal target date) has slipped while the item is still Pending |
| 🟠 **Amber** | Due soon or in progress near the line | 30 days or fewer to expiry, or the item is Under Process with 90 days or fewer left |
| 🟢 **Green** | Complied / healthy | Renewed or Closed for the current cycle, or comfortably valid |
| ⚪ **Grey** | Not Applicable | Approved as not applicable, with a recorded justification |

**Compliance Index** is the management KPI on the dashboards. It answers "how
much of what matters is done?" in one number.

- It is **weighted by criticality**: Critical counts 4, High 3, Medium 2, Low 1.
- The formula is: `Index % = (weight of Complied items ÷ total weight of counted items) × 100`.
- "Complied" means a valid, verified certificate/filing for the current cycle,
  or a renewal applied before expiry with the acknowledgement attached
  (*Complied – renewal in process*).
- **Not Applicable** items are excluded from the calculation entirely, so
  correctly marking an obligation N/A improves accuracy rather than the score.
- If there is nothing to count, the Index reads 100%.

A high Index with a red item still on the board means a *critical* item is
slipping — always look at the top-risks table, not the Index alone.

---

## What the reminder and escalation e-mails mean

ComplyTrack sends reminders on a schedule and escalates when nothing happens.
Both use editable templates (Administrator → Reminders & Escalation →
Templates).

### Reminder e-mails

- **Upcoming reminder.** Subject: `[ACTION] {Criticality} | {Item} ({Unit}) expires in {Days Left} days – due {Expiry Date}`.
  This is a normal headsup. It lists the item, reference number, authority,
  expiry date, renewal due date, the owner, and **which required documents are
  still pending**. Buttons open the item, mark it Under Process, or jump to the
  upload screen.
- **Expired / overdue alert.** Subject: `[EXPIRED] {Item} – {Days Overdue} days overdue – Immediate action`.
  Red-themed and serious: the deadline has passed. It includes an exposure note
  (penalty or stop-work risk) from the item's remarks. These repeat **every 2
  days until the item is closed**.
- **Default offsets:** 90, 60, 30, 15, 7, 3 and 1 day before the anchor date,
  on the day, then every 2 days after expiry. An Administrator can change these
  globally, per category or per item.
- **Daily digest** (per person: everything you own) and **weekly management
  digest** (KPIs, top risks, department league table) arrive separately.

### Escalation e-mails

When a reminder is ignored the issue climbs a ladder. Each step notifies more
senior people, and the escalation is recorded on the item's timeline.

| Level | When | Who is notified |
|---|---|---|
| 0 | 90 days before | Owner |
| 1 | 15 days before, still **Pending** | Owner + Department Head |
| 2 | 7 days before, still not **Under Process** | Owner + Department Head + Unit Head + Compliance Team |
| 3 | On expiry, or 1 day overdue | Unit Head + Plant Head + Management |
| 4 | 7 days overdue (critical) | Plant Head + Management + Director/CEO |

The escalation e-mail lists the owner and the history of earlier reminders with
the dates they were sent, so the recipient can see what has already been tried.
Levels, triggers and recipients are configurable in the Admin escalation matrix.

*Permission note:* only an Administrator or the Compliance Team can change
reminder offsets or the escalation ladder. Owners cannot.

---

## 1. Administrator

Typical person: IT / system owner. You configure the system; segregation of
duties means you **cannot verify or close compliance items** (the Compliance
Team does that). Full detail is in [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md).

You share most screens with the other roles; the ones that are primarily yours
are the Admin screens (§15 screen 14) and the Audit Log Viewer (§15 screen 13).
Screens you also use: Dashboard, Compliance Register, Compliance Item, Templates
Library, Calendar, Reports Hub, Notification Centre (all covered in the
Compliance Team section, with your extra rights noted there).

### Admin: Users & Roles

*What it is for:* creating accounts and controlling who can do what.

*How to get there:* **Admin → Users & Roles**.

*Key actions:*

1. Click **New user**, enter name, work e-mail, department, unit(s) and role.
2. To deactivate someone, open their record and set the status to Inactive —
   this **forces an immediate sign-out**. Any items they owned are flagged for
   reassignment (see the orphan list).
3. To reset a password, open the user and click **Reset password**. Copy the
   generated temporary password; the user must change it at next sign-in.
4. Run the **Access review** report (who has which role, for IT audit) from the
   same screen.

*Permission note:* Administrator only. A user can hold different roles for
different units; scope is applied on top of role.

### Admin: Units & Departments, Authorities, Categories

*What it is for:* master data that everything else hangs off.

*How to get there:* **Admin → Units & Departments**, **Authorities**,
**Categories**.

*Key actions:* create/edit units (Yard, Plant, Office, Subsidiary), departments
and their heads, issuing authorities (with default processing days), and the
category/sub-category tree. These feed the item forms and the dashboards.

*Permission note:* Administrator manages; Compliance Team can propose within
scope.

### Admin: Reminder Profiles & Escalation Matrix

*What it is for:* deciding when reminders fire and when issues escalate.

*How to get there:* **Admin → Reminders & Escalation → Profiles** and
**Admin → Reminders & Escalation → Escalation ladder**.

*Key actions:* create or edit a profile — the offsets (e.g. 90/60/30/15/7/3/1/0),
the channels (email / in-app / push), who is notified at each offset, the
post-expiry repeat cadence, and whether reminders anchor on the renewal-due date
or the statutory due date. Edit the escalation levels and their trigger days.
Assign a profile to a template or an individual item.

*Permission note:* Administrator (and Compliance Team within scope).

### Admin: Email Templates

*What it is for:* wording of every outgoing reminder, escalation and digest.

*How to get there:* **Admin → Reminders & Escalation → Templates**.

*Key actions:* edit subject and body using the placeholders `{Item}`,
`{Item Code}`, `{Unit}`, `{Reference No.}`, `{Authority}`, `{Expiry Date}`,
`{Renewal Due Date}`, `{Days Left}`, `{Days Overdue}`, `{Status}`, `{Owner}`,
`{Criticality}`, `{Documents Pending}`, `{Next Escalation Date}`,
`{Next Escalation Level}`, `{Exposure Note}`, `{Greeting}` and `{Link}`. Send a
test to yourself after editing.

### Admin: Holiday Calendars

*What it is for:* working-day targets and "statutory date vs working-day target"
display.

*How to get there:* **Admin → Holiday Calendars**.

*Key actions:* add state-wise holidays (there is a starter national list already
loaded). Holidays are used to show, for example, that a due date falling on a
Sunday means action is really due the previous working day.

### Admin: Settings

*What it is for:* financial-year start, timezone, quiet hours, default lead
times and branding — the key/value configuration the rest of the app reads.

*How to get there:* **Admin → Master data → Settings**. It is the last tab on the
master-data page. (The Entra ID single-sign-on values are **not** here; they are
environment variables, documented in the README and set by whoever deploys the
app.)

*Key actions:* change the working year, timezone and quiet hours without a
redeploy. The **mail relay is not here** — it has its own screen
(**Admin → Reminders & Escalation → E-mail (SMTP)**) with a **Send test e-mail**
button, and the spooled messages it produces are readable on **Admin →
Reminders & Escalation → Outbox**. See the Administrator Guide §3.4 for how the
two interact with the environment.

### Admin: Import / Export

*What it is for:* bulk-loading the register from Excel.

*How to get there:* **Admin → Import/Export**, or the Import button on the
Compliance Register.

*Key actions:* download the **Excel import template**, fill one row per
obligation, upload it, review the **dry-run** row-level report (errors and
warnings), fix and re-upload, then commit. Re-importing updates rows by item
code. Export any grid to Excel/CSV/PDF from the same place.

### Admin: Audit Log Viewer

**Screen: Audit Log Viewer** (PRD §15 screen 13)

*What it is for:* the tamper-evident record of everything that happened.

*How to get there:* **Admin → Audit Log**.

*Key actions:*

1. Filter by user, item, date range or action.
2. Open a row to see old value, new value and the reason for the change.
3. Click **Verify chain** to re-walk the hash chain and prove nothing was
   altered.
4. Click **Export** to download the CSV for an auditor.

*Permission note:* Administrator and Compliance Team only. **No role — not even
Administrator — can edit or delete audit rows.**

### Admin: the daily job dashboard

*What it is for:* confirming the 07:00 IST reminder/escalation run happened.

*How to get there:* **Admin → Reminders & Escalation → Jobs** (or the reminder
engine's job history).

*Key actions:* see last run, counts of reminders sent, duplicates suppressed,
failures, deferrals and escalations. If a run failed, an alert notification is
raised to Administrators. Use **Run now** to trigger a manual run — it is
idempotent, so a second run on the same day will not double-send.

*Permission note:* Administrator; Compliance Team can view.

---

## 2. Compliance Team

Typical people: Factory Compliance Officer, Safety Officer, Legal. This is your
operational system.

### Compliance Officer Dashboard

**Screen: Compliance Officer Dashboard** (PRD §15 screen 3)

*What it is for:* your workbench — everything needing attention, in tabs.

*How to get there:* sign in; if you are Compliance Team this is your landing
page, or choose **Dashboard → Officer** from the menu.

*Key actions:*

1. Work the tabs left to right: **Expired**, **Due for renewal (≤ 30 d)**,
   **Upcoming (31–90 d)**, **Upcoming (91–180 d)**, **Pending submissions**,
   **Awaiting verification**, **Awaiting authority**.
2. Use the row's quick actions: **Reassign**, **Send reminder now**,
   **Open item**, **Upload renewal**, **Escalate**.
3. Check **Today's actions** for what must be dealt with today, and the
   **Calendar** widget for the month's due dates — click a date to list items.

*Permission note:* Compliance Team and Administrator see all units/departments;
a Department User sees the same idea scoped to their own work on the My Work
screen.

### Compliance Register

**Screen: Compliance Register** (PRD §15 screen 5)

*What it is for:* the master grid of every obligation.

*How to get there:* **Register** in the main menu.

*Key actions:*

1. Filter by unit, department, category, criticality, owner, status or date.
2. Search full-text, or open a **saved view** for a recurring filter.
3. Choose your columns; tick rows for **bulk edit** or **bulk reassign**.
4. **Import** or **Export** from the toolbar.
5. Click any row to open the item.

*Permission note:* Compliance sees all; Department Users see only their scope;
Management sees all but read-only.

### Compliance Item — Create/Edit

**Screen: Compliance Item – Create/Edit** (PRD §15 screen 6)

*What it is for:* defining an obligation.

*How to get there:* **Register → New item**, or from a template in the Templates
Library.

*Key actions (tabs: Details, Dates & Validity, Owners, Reminders, Documents,
History):*

1. **Details** — name, category/sub-category, legal reference, unit,
   department, issuing authority, reference number, type, criticality, fee,
   applicability notes and remarks. The form enforces the mandatory fields for
   the type and warns about duplicates (same unit + authority + reference
   number).
2. **Dates & Validity** — enter issue date and validity (days/months/years, end
   of financial year, end of calendar year, fixed date annually, or no expiry);
   the system computes expiry, renewal due date and internal target date. Enter
   an expiry directly to override.
3. **Owners** — set Primary Owner, Delegate, Reviewer (Compliance) and
   Approver.
4. **Reminders** — accept the default schedule or attach a specific reminder
   profile.
5. **Documents** — attach the current certificate/return and mark the required
   document checklist.
6. Save. Editing a date, owner or criticality later requires a **reason**, which
   is written to the audit trail.

*Permission note:* only Administrator and Compliance Team create/edit items.
A Department User can *request* a change via a comment.

### Compliance Item — Detail

**Screen: Compliance Item – Detail** (PRD §15 screen 7)

*What it is for:* the full picture of one obligation.

*How to get there:* click any row in the Register or a dashboard list.

*Key actions:* read the header RAG chip, the status stepper, and the tabs for
**timeline**, **checklist**, **documents**, **comments** and **escalations**.
The timeline is the complete story — status changes, uploads, reminders sent and
escalations. Use the comments box for notes and `@mentions`; use it to log
authority correspondence (for example "Inspector asked for a revised drawing").

*Permission note:* everyone who can see the item can read the detail;
who can *act* on it depends on role and ownership.

### Instance / Renewal Workspace

**Screen: Instance/Renewal Workspace** (PRD §15 screen 8)

*What it is for:* doing the renewal for one cycle.

*How to get there:* from an item, open the current cycle (instance).

*Key actions, in workflow order:*

1. **Pending → Under Process** — click **Start**; enter start date and expected
   filing date.
2. **Under Process → Submitted** — upload the acknowledgement/receipt/challan
   and enter the submission date.
3. **Submitted → Renewed** — upload the renewed certificate, enter the new
   reference number, issue date and new expiry date.
4. **Renewed → Closed** — a **Compliance Team verifier** approves it with a
   remark; the system archives the old certificate as a version and **creates
   the next cycle automatically**. Reminders for the old cycle stop.
5. If the authority raises a query, set **Query Raised** and add the
   correspondence; it returns to Under Process when answered.

*Permission note:* owners and delegates move the early steps; **only the
Compliance Team verifies and closes**. Owners cannot close their own **Critical**
items — maker-checker applies. Any backward move needs a reason.

### Templates Library (and apply-to-unit wizard)

**Screen: Templates Library** (PRD §15 screen 9)

*What it is for:* the reusable library of obligation definitions — the 80
shipyard templates from PRD §4 ship pre-loaded.

*How to get there:* **Templates** in the main menu.

*Key actions:*

1. Browse or filter by category; open a template to see its default validity,
   lead time, authority processing time, owner department, criticality and
   required documents.
2. Click **Apply to unit**, choose the unit(s), run the **dry-run** to see what
   will be created, then commit. This instantiates real items with their cycles.
3. Edit a template or add your own; remember the seeded content **must be
   verified against current Central/State rules before go-live**.

*Permission note:* Compliance Team and Administrator can edit; Department Users
can browse.

### Calendar

**Screen: Calendar** (PRD §15 screen 10)

*What it is for:* a month/week/list view of due and expiry dates.

*How to get there:* **Calendar** in the main menu.

*Key actions:* switch between month, week and list; click a date to see the
items due; colour-coded by RAG. Copy the **iCal link** to subscribe from Outlook
or Google Calendar.

### Reports Hub (and Schedule Reports)

**Screen: Reports Hub** (PRD §15 screen 11)

*What it is for:* the twelve standard reports (R1–R12).

*How to get there:* **Reports** in the main menu.

*Key actions:* open a report, set the filters, view it, then **Export** to
CSV/Excel/PDF or **Schedule** it to be e-mailed daily/weekly/monthly/quarterly.
The Monthly Renewal Calendar (R4) also has its own iCal feed. The Management
Summary (R12) is the one-page PDF designed for leadership.

*Permission note:* Compliance Team runs anything; Department Users are limited
to their own department; Management can view and download summaries.

### Notification Centre

**Screen: Notification Centre** (PRD §15 screen 12)

*What it is for:* your in-app reminders and alerts.

*How to get there:* the bell icon in the header, or **Notifications**.

*Key actions:* read notifications newest-first, click one to jump to the item,
and **Mark all read**. Push notifications (PWA) arrive on your phone if you
allow them.

### Import/Export, Audit Log

See the Administrator section — the Compliance Team shares the Import/Export and
Audit Log screens (read and export rights; audit rows can never be edited).

---

## 3. Department User

Typical people: HR, Safety, Environment, Electrical, Mechanical, Stores, Admin,
Quality, Security, IT — the people who **own** individual obligations.

### My Work Dashboard

**Screen: My Work** (PRD §15 screen 4)

*What it is for:* your personal to-do list. This is your landing page.

*How to get there:* sign in; you land here, or choose **My Work**.

*Key actions:*

1. **My open items**, sorted by urgency (most at risk first).
2. **My upcoming 90 days** — what is coming.
3. **Items awaiting my upload** — where a document is missing.
4. **Items I delegated** — while you are on leave.
5. **Overdue items** with their escalation level, so you can see who has been
   copied.
6. **One-click status update** — start an item, mark it Under Process, or upload
   a renewal without leaving the screen. Drag-and-drop a file to upload.

*Permission note:* Department Users see **only their own department's items**
unless granted more (AC-2). You cannot verify or close items — the Compliance
Team does that.

### Working your items

Everything else a Department User does happens from **My Work** or from the item
you open from it:

- **Compliance Item – Detail** (§15 screen 7): the timeline, checklist,
  documents, comments and escalations for your item.
- **Instance / Renewal Workspace** (§15 screen 8): start the renewal, upload the
  acknowledgement, then the renewed certificate. The Compliance Team verifies
  and closes.
- **Notification Centre** (§15 screen 12): your reminders.

*Permission note:* you can update status, comment, and upload on items **you
own or delegate**; you cannot create items (ask the Compliance Team), reassign
owners, verify closure, delete items, or view the audit log. **You cannot close a
Critical item yourself** — an attempt is refused and logged (AC-4).

### Compliance Register (scoped)

You can open the **Compliance Register** (§15 screen 5), but it shows only your
department's rows. Use the filters and search to find your items quickly.

---

## 4. Management View

Typical people: Unit Head, Plant Head, Director, CEO.

### Management Dashboard

**Screen: Management Dashboard** (PRD §15 screen 2)

*What it is for:* the one-glance picture of compliance health.

*How to get there:* sign in; Management lands here, or choose
**Dashboard → Management**.

*Key actions:*

1. Set the filter bar: **Unit | Department | Category | Criticality | Owner |
   Period (FY/quarter/month)**.
2. Read the KPI cards — Total active obligations, **Complied**, Pending, Under
   Process/Submitted, Due in next 30 days, **Overdue**, **Expired**, and the
   **Compliance Index (%)**. **Every card is clickable and drills down to the
   underlying list** (AC-5), and the counts match the register exactly for the
   same filter.
3. Read the visuals: status doughnut; department-wise and unit-wise stacked
   bars; category-wise compliance%; a 12-month renewal heat map; a 12-month
   Compliance Index trend line.
4. Check **Top 10 Critical risks**, **Escalations active**, the **owner
   leaderboard/backlog**, and renewal fees due next quarter.

*Permission note:* Management View is **read-only** — no editing, no status
changes. Access may be unit-restricted or group-wide depending on your account.

### Reports Hub (summary)

From **Reports** (§15 screen 11) you can view and download the Management
Summary (R12), the Department- and Unit-wise status reports, and the Monthly
Renewal Calendar. You can subscribe to the weekly digest.

### Notification Centre

The **Notification Centre** (§15 screen 12) and the weekly management digest
e-mail keep you informed without logging in.

---

## 5. Auditor / Inspector

An optional, read-only, time-boxed role for internal/external auditors and
statutory inspectors.

- **Compliance Register** (§15 screen 5) and **Compliance Item – Detail**
  (§15 screen 7): view the filtered set you have been given, including the
  evidence documents and their version history.
- **Audit Log Viewer** (§15 screen 13): view and export the audit trail so you
  can see who changed what, when and why.
- **Secure share links:** an auditor can be given a **time-limited, view-only
  link** to specific documents; the document is watermarked with the viewer's
  name and the time, and every download is logged.

*Permission note:* Auditor access is **view and download only** — no edits, no
status changes, no owner reassignment. Access is time-boxed and can be revoked
at any time by an Administrator.

---

## Screen-to-role quick reference

| PRD §15 screen | Administrator | Compliance | Department | Management | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| 1 Login / SSO | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 Management Dashboard | ✅ | ✅ | — | ✅ | — |
| 3 Compliance Officer Dashboard | ✅ | ✅ | — | — | — |
| 4 My Work | — | — | ✅ | — | — |
| 5 Compliance Register | ✅ | ✅ | scoped | read-only | read-only |
| 6 Item Create/Edit | ✅ | ✅ | request only | — | — |
| 7 Item Detail | ✅ | ✅ | own scope | read-only | read-only |
| 8 Renewal Workspace | — (no verify) | ✅ | own items | — | — |
| 9 Templates Library | ✅ | ✅ | browse | — | — |
| 10 Calendar | ✅ | ✅ | — | — | — |
| 11 Reports Hub | ✅ | ✅ | own dept | summaries | — |
| 12 Notification Centre | ✅ | ✅ | ✅ | ✅ | ✅ |
| 13 Audit Log Viewer | ✅ | ✅ | — | — | read/export |
| 14 Admin screens | ✅ | propose | — | — | — |
| 15 Phase-2 screens | — | — | — | — | — |

---

*See also: [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) for configuration and
[`UAT_SCRIPT.md`](UAT_SCRIPT.md) for the acceptance checklist.*
