# ComplyTrack — UAT / Acceptance Script

A printed, testable checklist for the User Acceptance Testing of ComplyTrack.
It can be run by a **compliance officer who is not a developer**: every step is
something you click or type in the application or read in an e-mail.

This script covers:

- **every PRD §5 requirement marked M (mandatory)** — CD, RT, RM, OW, DS, AT,
  RP, AC and EX; and
- **all eight acceptance criteria AC-1 … AC-8** from PRD §17.3.

---

## How to use this script

1. **Set up the test environment** (below) and sign in with the demo accounts.
2. Run the cases **in order** — later cases reuse data created earlier.
3. For each case, record **Pass** or **Fail**, your **initials** and the
   **date**. Add a comment for any failure, including what you expected.
4. A case may cover more than one requirement ID; the **Requirement** line lists
   them all.
5. When you find a failure, raise it with the item code / reference number and a
   screenshot. Re-test after the fix.
6. **Go-live gate (PRD §17.4):** every case must pass, or a failure must have an
   agreed workaround signed off by the Compliance Team.

### Result legend

`☐ Pass` `☐ Fail` — tick one. Use the notes column at the end of each case.

---

## Test environment setup

| Item | Value |
|---|---|
| URL | `http://localhost:8080` (Docker) or `http://127.0.0.1:8000` / `http://localhost:5173` (laptop) |
| Seeded data | 4 units, 16 departments, 48 authorities, 80 templates, demo register |
| Password for all demo users | `Comply@2026!` |

**Demo accounts used below** (all on the *Main Shipyard* unit):

| Name | E-mail | Role | Department |
|---|---|---|---|
| Priya Menon | `compliance@complytrack.local` | Compliance Team | Legal & Compliance |
| Ravi Deshmukh | `safety.owner@complytrack.local` | Department User (and Safety HOD) | Safety |
| Farhan Qureshi | `electrical.owner@complytrack.local` | Department User (and Electrical HOD) | Electrical |
| Meena Iyer | `hr.owner@complytrack.local` | Department User (and HR HOD) | HR & IR |
| Anita Krishnan | `unit.head@complytrack.local` | Management View | Administration |
| Arun Nair | `admin@complytrack.local` | Administrator | IT |
| Leela Thomas | `auditor@complytrack.local` | Auditor | Administration |

**Before you start:** confirm the **Administrator → Jobs** page shows the
scheduler as running, and that `/health` returns `"status": "ok"`.

**Note on e-mail:** if SMTP is not configured, all outgoing mail is written as
`.eml` files under `backend/outbox/`. Open them in any mail client. If SMTP
*is* configured, check the recipient mailbox instead. Cases that say "open the
e-mail" accept either.

---

# Part A — Mandatory requirements (§5)

## A1. Compliance items (CD)

### UAT-01 — Create a compliance item with the full field set
- **Requirement:** CD-01 (M)
- **Role:** Compliance Team (`compliance@complytrack.local`)
- **Preconditions:** signed in.
- **Steps:**
  1. Open **Register → New item**.
  2. Fill every field on the **Details** tab: Name, Category, Sub-category,
     Legal reference, Unit (Main Shipyard), Department (Safety), Issuing
     Authority, Reference Number, Type (Licence), Criticality (High), Fee,
     Applicability notes, Remarks.
  3. On **Dates & Validity**, enter Issue Date **01-Apr-2026**, Validity
     **12 months**, Renewal Lead Time 90 days, Authority processing 15 days.
  4. On **Owners**, set Primary Owner = Ravi Deshmukh, Reviewer = Priya Menon,
     Approver = Anita Krishnan.
  5. Save.
- **Expected result:** the item is created and appears in the Register with a
  reference number, owner, expiry, renewal due date and RAG chip.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-02 — Mandatory-field validation and duplicate detection
- **Requirement:** CD-03 (M)
- **Role:** Compliance Team
- **Preconditions:** the item from UAT-01 exists.
- **Steps:**
  1. Open **Register → New item** and try to save with the Name blank.
  2. Now enter the **same Unit + Issuing Authority + Reference Number** as the
     item from UAT-01, with a different name, and save.
- **Expected result:** (1) the save is refused and the missing/incorrect fields
  are highlighted with a clear message; (2) a duplicate warning identifies the
  existing item and the save is blocked or requires confirmation.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-03 — Upload an evidence document
- **Requirement:** CD-02 (M)
- **Role:** Department User (`safety.owner@complytrack.local`, or Compliance)
- **Preconditions:** the item from UAT-01 is open.
- **Steps:**
  1. Open the item → **Documents** tab.
  2. Upload a **PDF** under 25 MB. Then upload a **JPG**.
  3. Try to upload a file **larger than 25 MB**.
  4. Try to upload a **.exe** (a disallowed type).
  5. Click the PDF to preview it in the browser.
- **Expected result:** the PDF and JPG upload and preview; the oversized file
  and the `.exe` are both refused with a clear reason; the accepted documents
  appear in the list with type, size, uploader and time.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-04 — All five item types can be created
- **Requirement:** CD-04 (M)
- **Role:** Compliance Team
- **Steps:** create one item of each type — **Licence/Permit**, **Periodic
  Filing**, **Inspection/Test**, **Certificate (Equipment/Person)**,
  **Policy/Approval** — and check the type-specific mandatory fields behave.
- **Expected result:** all five types save successfully, and the form asks for
  the mandatory fields appropriate to each type.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-05 — Search, saved filters, bulk actions and import/export
- **Requirement:** CD-07 (M)
- **Role:** Compliance Team
- **Steps:**
  1. On the **Register**, type part of an item name in search — the list
     filters.
  2. Apply filters (Unit, Category, Criticality), then **Save view**.
  3. Reload the page and re-open the saved view.
  4. Change the visible **columns**.
  5. Tick two rows and use **Bulk edit** to change criticality; then **Bulk
     reassign** one item to a different owner.
  6. Export the register to **Excel**; download the **import template** and
     import it back through the dry-run.
- **Expected result:** search and saved views work; bulk edit/reassign update
  the rows; the Excel export opens; the dry-run reports rows without errors.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-06 — Archive is a soft delete
- **Requirement:** CD-08 (M)
- **Role:** Compliance Team
- **Steps:**
  1. Open an item and choose **Archive**; enter a reason when prompted.
  2. Search the Register for that item.
  3. Restore it.
- **Expected result:** archiving requires a reason, the item disappears from the
  active list but is still searchable as archived with its reason, and it can be
  restored.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A2. Renewal tracking (RT)

### UAT-07 — Expiry is calculated from issue date + validity
- **Requirement:** RT-01 (M)
- **Role:** Compliance Team
- **Steps:** create an item with **Issue Date = 01-Apr-2026** and **Validity =
  12 months**, leaving Expiry blank.
- **Expected result:** the saved **Expiry Date = 31-Mar-2027**. Repeat with
  validity in **days**, in **years**, and the options **end of financial year**,
  **end of calendar year**, **fixed date annually** and **no expiry** — each
  behaves as labelled. Entering an expiry directly overrides the calculation.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-08 — Renewal due date and internal target date
- **Requirement:** RT-02 (M)
- **Role:** Compliance Team
- **Steps:** on an item with Expiry 31-Mar-2027, set **Authority processing = 15
  days** and **Internal preparation = 10 days**.
- **Expected result:** the item shows **Renewal Due Date = 16-Mar-2027**
  (expiry − 15) and **Internal Target Date = 06-Mar-2027** (renewal due − 10),
  both visible on the item and on the dashboard.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-09 — Recurrence generates the next cycle
- **Requirement:** RT-03 (M)
- **Role:** Compliance Team
- **Steps:** create a **monthly filing** item with recurrence "monthly on the
  15th"; close one cycle (through the workflow in UAT-24 / UAT-31).
- **Expected result:** the next cycle (for the following month) is created
  automatically with the correct due date, and reminders are rescheduled for it.
  Test a quarterly, half-yearly and annual item the same way.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-10 — Derived status is correct
- **Requirement:** RT-05 (M)
- **Role:** Compliance Team
- **Steps:** view items with, respectively: more than 90 days to expiry; within
  the reminder window; at/past the renewal due date; past expiry; no expiry; and
  marked Not Applicable.
- **Expected result:** they show **Valid**, **Upcoming**, **Due for Renewal**,
  **Expired**, **Perpetual** and **Not Applicable** respectively, with the
  matching RAG chip.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-11 — Renewal history is retained
- **Requirement:** RT-06 (M)
- **Role:** Compliance Team
- **Steps:** roll an item forward through a renewal (UAT-31), then open its
  **History** tab.
- **Expected result:** the previous licence number, dates, fee paid, who
  processed it and the turnaround time are all recorded.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-12 — "Applied, awaiting authority" stays compliant
- **Requirement:** RT-07 (M)
- **Role:** Department User / Compliance Team
- **Preconditions:** an item close to expiry.
- **Steps:** set the item to **Under Process**, upload the acknowledgement
  receipt, and flag "renewal applied, awaiting authority" **before** expiry.
- **Expected result:** the item shows **Compliant – Renewal in Process** (not
  Expired), the acknowledgement is attached, and this is visible in the item's
  timeline for legal defence.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A3. Reminders (RM)

### UAT-13 — Default reminder offsets
- **Requirement:** RM-01 (M)
- **Role:** Administrator
- **Steps:** open **Admin → Reminder Profiles → Default** and inspect the
  offsets; then open an item on the default profile.
- **Expected result:** offsets are **90, 60, 30, 15, 7, 3, 1 and 0 days**, with
  a post-expiry repeat of every **2 days**; the item uses them (or a profile
  overridden per category/criticality/item).
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-14 — All three live channels deliver
- **Requirement:** RM-02 (M — e-mail, in-app, push)
- **Role:** Department User / Administrator
- **Steps:**
  1. Trigger a reminder for an item you own (Admin → **Run now**, or wait for
     the 07:00 IST run).
  2. Open the **e-mail** (or the `.eml` in `outbox/`).
  3. Open the **bell / Notification Centre**.
  4. On a phone, install the PWA and allow notifications, then trigger another.
- **Expected result:** the reminder arrives by **e-mail**, appears **in-app**,
  and arrives as a **push** notification on the installed PWA.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-15 — Recipients change by offset
- **Requirement:** RM-03 (M)
- **Role:** Administrator
- **Steps:** inspect the default profile's recipients at 90, 15, 7 and 0 days,
  and compare with who receives the actual mails when reminders fire.
- **Expected result:** at 90 days only the **owner/delegate** is notified; at 15
  days the **Department Head** is added; at 7 days the **Unit Head and
  Compliance Team** are added; on the due day **Management** is included.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-16 — Reminder content is complete
- **Requirement:** RM-04 (M)
- **Role:** Department User
- **Steps:** open a reminder e-mail and click each action link.
- **Expected result:** the mail shows item, unit, authority, reference number,
  expiry/due date, days remaining, status, the required-documents checklist,
  a working **deep link** to the item, and a one-click **Mark as Under Process**
  action.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-17 — Daily and weekly digests
- **Requirement:** RM-05 (M)
- **Role:** Department User (daily) / Management (weekly)
- **Steps:** run the daily job; open the daily digest for an owner. Trigger or
  wait for the weekly run; open the management digest.
- **Expected result:** the owner receives a daily digest of all their open
  items; Management receives a weekly digest (HTML/PDF) with the KPI strip and
  top risks.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-18 — Reminders stop and resume
- **Requirement:** RM-06 (M)
- **Role:** Compliance Team
- **Steps:** take an item that is receiving reminders, move it to **Submitted**
  (or **Closed**), run the daily job, and confirm no reminder. Then reopen it to
  **Under Process** and run the job again.
- **Expected result:** reminders **stop** on Submitted/Renewed/Closed and
  **resume** when the item is reopened.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-19 — Delivery tracking, retry and failure alert
- **Requirement:** RM-08 (M)
- **Role:** Administrator
- **Steps:** open **Admin → Reminders → Log**; find a reminder's status. Cause a
  failure (e.g. point SMTP at an invalid host in a test environment), run the
  job, then click **Retry failed**.
- **Expected result:** each reminder shows sent/delivered/failed/read where
  available; failed ones can be retried; and a failed delivery raises an alert
  to the Administrator.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-20 — Editable e-mail templates
- **Requirement:** RM-10 (M)
- **Role:** Administrator
- **Steps:** open **Admin → Email Templates**, edit the *Upcoming renewal*
  template to add a sentence and use one new placeholder (e.g. `{Owner}`);
  save and trigger a reminder.
- **Expected result:** the change is accepted and the outgoing mail reflects the
  new wording and the substituted placeholder.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-21 — Scheduler runs daily at 07:00 IST and is idempotent
- **Requirement:** RM-11 (M)
- **Role:** Administrator
- **Steps:**
  1. Open **Admin → Jobs** and note the next run time and today's record.
  2. Click **Run now** twice in a row.
  3. Note the count of reminders sent and the count of duplicates suppressed.
- **Expected result:** the daily job is scheduled for **07:00 IST**; the second
  run on the same day sends **no duplicate** reminders or escalations and
  reports them as suppressed.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A4. Ownership and escalation (OW)

### UAT-22 — Four named roles, and deactivation flags items
- **Requirement:** OW-01 (M)
- **Role:** Administrator
- **Steps:** on an item, confirm **Primary Owner, Delegate, Reviewer, Approver**
  are set to named active users. Then deactivate the owner (Admin → Users) and
  open **Users → Orphans**.
- **Expected result:** all four roles are recorded; deactivating the owner
  **forces their sign-out** and flags their items for reassignment in the orphan
  report.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-23 — Bulk reassignment and auto-assign by department
- **Requirement:** OW-02 (M)
- **Role:** Compliance Team / Administrator
- **Steps:** select several items on the Register and **Bulk reassign** to
  another owner. Then create an item from a template that has a default owner
  department and confirm it is auto-assigned.
- **Expected result:** all selected items move to the new owner in one action;
  new items inherit the department's owner rule.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-24 — The full status workflow
- **Requirement:** OW-03 (M)
- **Role:** Department User then Compliance Team
- **Steps:** walk one item through **Pending → Under Process → Submitted →
  Renewed → Closed**. At each step supply the mandatory data (start and expected
  filing dates; acknowledgement upload; renewed certificate + new reference and
  dates; verification remark as Compliance).
- **Expected result:** each transition is allowed only with its mandatory data;
  side states **On Hold**, **Not Applicable** and **Query Raised** are also
  reachable with a reason/review date.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-25 — Escalation levels fire as configured
- **Requirement:** OW-04 (M)
- **Role:** Administrator / Department Head
- **Steps:** using an item that is still **Pending**, set its due date so that it
  is 15 days away; run the daily job; check who is notified. Repeat at 7 days,
  at expiry, and at 7 days overdue.
- **Expected result:** level 1 notifies the **Department Head** at 15 days;
  level 2 the **Unit Head + Compliance Team** at 7 days; level 3
  **Plant Head/Management** at expiry; level 4 **CEO/Director** at 7 days
  overdue — matching the escalation matrix.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-26 — Escalations are recorded on the timeline
- **Requirement:** OW-05 (M)
- **Role:** Compliance Team
- **Steps:** after UAT-25, open the item's **Timeline** and **Escalations**
  sections.
- **Expected result:** each escalation shows **who** was notified, **when**, and
  the outcome; it is visible in the item timeline.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-27 — Comments, @mentions and query log
- **Requirement:** OW-07 (M)
- **Role:** Department User / Compliance Team
- **Steps:** add a comment to an item, `@mention` a colleague, and add an
  internal note; then log an authority query ("Inspector asked for revised
  drawing") against the item.
- **Expected result:** comments save and appear in the timeline; the mentioned
  user is notified; the query is recorded and the item can move to **Query
  Raised** and back.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A5. Document submission (DS)

### UAT-28 — Required-documents checklist
- **Requirement:** DS-01 (M)
- **Role:** Compliance Team / Department User
- **Steps:** open an item created from a template with required documents and
  mark each one **Received**, **Pending** or **Not required**.
- **Expected result:** the checklist reflects the template's document list and
  each row's state is saved with who received it and when.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-29 — Pending-submission reminders and owner-wise list
- **Requirement:** DS-02 (M)
- **Role:** Department User / Compliance Team
- **Steps:** leave a required document Pending on an item with an approaching
  due date; run the daily job; open the **Pending submissions** tab on the
  Officer dashboard.
- **Expected result:** a pending-submission reminder is sent, and the owner-wise
  pending list shows the outstanding document.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-30 — Upload a renewed certificate with its metadata
- **Requirement:** DS-03 (M)
- **Role:** Department User
- **Steps:** upload a renewed certificate against an item and enter the
  **document type**, **new reference number**, **issue date** and **new expiry
  date**.
- **Expected result:** the upload requires the type and dates; the file is
  stored and listed. Repeat for an application acknowledgement, a payment
  receipt, an inspection report and correspondence.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-31 — Roll-forward on verification
- **Requirement:** DS-04 (M)
- **Role:** Compliance Team
- **Steps:** upload a renewed certificate (UAT-30), then **verify/approve** it as
  the Compliance Team.
- **Expected result:** the item's current licence details are updated, the old
  certificate is kept in history, and the **next cycle is created
  automatically** with the new dates; reminders for the old cycle stop.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-32 — Document versioning
- **Requirement:** DS-05 (M)
- **Role:** Compliance Team / Department User
- **Steps:** upload a second version of the same document (same title and type)
  with a change note, then open **Versions**.
- **Expected result:** each file has a version number, uploader, timestamp and
  change note; older versions are retained, read-only and downloadable.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-33 — Verification (approve / reject) is required before closure
- **Requirement:** DS-06 (M)
- **Role:** Compliance Team
- **Steps:** as a Department User, try to close an item yourself. Then as the
  Compliance Team, **reject** an uploaded renewal with a reason; then **approve**
  it.
- **Expected result:** the Department User **cannot close**; rejection records
  the reason and returns the cycle for correction; approval is what allows the
  closure.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A6. Audit trail (AT)

### UAT-34 — Audit log captures the full event
- **Requirement:** AT-01 (M)
- **Role:** Administrator / Compliance Team
- **Steps:** edit an item's expiry date (give a reason), download a document,
  and sign in from a second browser. Then open **Admin → Audit Log**.
- **Expected result:** each action is recorded with **who, when (IST and UTC),
  IP/device, action, old value, new value and reason** — including downloads,
  logins and permission changes.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-35 — Per-item timeline
- **Requirement:** AT-02 (M)
- **Role:** Compliance Team
- **Steps:** open an item that has had status changes, comments, uploads,
  reminders and escalations.
- **Expected result:** the timeline combines **all** of those events in order,
  each with time and actor.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-36 — Append-only, hash-chained, exportable
- **Requirement:** AT-03 (M)
- **Role:** Administrator (and an attempt as another role)
- **Steps:**
  1. Open **Admin → Audit Log → Verify chain**.
  2. Try to edit or delete any audit row (as Administrator and as any other
     role).
  3. Export the audit trail to CSV.
- **Expected result:** chain verification confirms nothing was altered; **no
  role — including Administrator — can edit or delete** an audit row; the CSV
  exports with a hash for tamper evidence.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-37 — Reason is mandatory for sensitive edits
- **Requirement:** AT-04 (M)
- **Role:** Compliance Team
- **Steps:** try to change an item's **dates**, **owner**, **criticality**, move
  the status **backwards**, and **archive** it — each time leaving the reason
  blank.
- **Expected result:** each attempt is refused until a reason is supplied, and
  the reason is written to the audit trail.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A7. Reporting (RP)

### UAT-38 — Compliance Status Report (R1)
- **Requirement:** RP-01 (M)
- **Role:** Compliance Team
- **Steps:** open **Reports → R1**, filter by unit/category/status, view it.
- **Expected result:** every item is listed with status, owner, due/expiry date
  and days left; filters change the result set.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-39 — Department-wise Status (R2)
- **Requirement:** RP-02 (M)
- **Role:** Compliance Team / Management
- **Steps:** open **Reports → R2**, and click a department to drill down.
- **Expected result:** counts and percentages per status per department, with a
  drill-down list behind each row.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-40 — Unit-wise and Category-wise Status (R3)
- **Requirement:** RP-03 (M)
- **Role:** Compliance Team / Management
- **Steps:** open **Reports → R3**, switch between unit/location and category
  grouping.
- **Expected result:** status counts and percentages by unit and by category
  (Factory, Labour, Environmental, Explosives/Fire/Electrical, Maritime/Customs,
  Defence/Quality, Information Security).
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-41 — Monthly Renewal Calendar (R4) and iCal
- **Requirement:** RP-04 (M)
- **Role:** Compliance Team / Management
- **Steps:** open the **Calendar** (month grid and list) with a 12-month forward
  view; export it; copy the **iCal link** and subscribe from Outlook or Google
  Calendar.
- **Expected result:** the calendar shows due/expiry dates in month grid and
  list; it exports to Excel/PDF; the iCal feed subscribes successfully.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-42 — Pending Action Report (R5) with ageing
- **Requirement:** RP-05 (M)
- **Role:** Compliance Team
- **Steps:** open **Reports → R5**.
- **Expected result:** open instances by owner with ageing buckets **0–7,
  8–15, 16–30, 30+ days**, plus last reminder date and escalation level.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-43 — Expired and Expiring report (R6)
- **Requirement:** RP-06 (M)
- **Role:** Compliance Team / Management
- **Steps:** open **Reports → R6** and choose the next 30 / 60 / 90 / 180 / 365
  days.
- **Expected result:** items sorted by expiry with criticality and potential
  exposure for the selected window.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-44 — Management Summary (R7/R12) auto-emailed
- **Requirement:** RP-07 (M)
- **Role:** Management / Administrator
- **Steps:** open **Reports → R12**, export the one-page PDF; configure a weekly
  schedule for it and confirm it is delivered.
- **Expected result:** the PDF is a single page of KPIs, top risks and trends;
  the scheduled weekly/monthly e-mail arrives with it attached.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-45 — Every report exports and prints
- **Requirement:** RP-11 (M)
- **Role:** Compliance Team
- **Steps:** for a report, export to **Excel**, **PDF** and **CSV**; then print
  one.
- **Expected result:** all three formats download and open correctly; the print
  layout is legible.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A8. Access control (AC)

### UAT-46 — The roles exist and match the matrix
- **Requirement:** AC-01 (M)
- **Role:** Administrator
- **Steps:** create a test user for each role — **Administrator, Compliance
  Team, Department User, Management View, Auditor**.
- **Expected result:** each role can be assigned and each behaves as the PRD §9
  matrix describes.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-47 — Department/Unit data scoping
- **Requirement:** AC-02 (M)
- **Role:** Department User
- **Steps:** sign in as the **Electrical** owner and try to open a **Labour**
  item (by URL or search) and an item in another unit.
- **Expected result:** the Electrical user **cannot see** Labour or other-unit
  items unless granted; the attempt is refused and logged.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-48 — Authentication: SSO, local login and MFA
- **Requirement:** AC-03 (M)
- **Role:** Administrator / any user
- **Steps:**
  1. If Entra ID is configured, sign in with **Microsoft** (SSO).
  2. Sign in with a **local** e-mail and password.
  3. Enrol **TOTP MFA** from the profile, sign out and sign in again with the
     6-digit code.
  4. Try to set a weak password (e.g. `password`) when changing it.
- **Expected result:** SSO works; local sign-in works; the TOTP code is required
  once enrolled; the weak password is refused with the policy explained
  (minimum length, upper, lower, digit, symbol).
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-49 — Session, lockout and forced logout
- **Requirement:** AC-04 (M)
- **Role:** Administrator / any user
- **Steps:**
  1. Enter a wrong password **5 times** and try again.
  2. Sign in, then leave the session idle beyond the timeout.
  3. While a user is signed in, deactivate that account from another session.
- **Expected result:** the account is **locked** after 5 failures for the
  configured window; the idle session expires; deactivation **forces an
  immediate logout** and blocks new sign-ins.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

## A9. Additional features (EX)

### UAT-50 — Compliance Index (EX-04)
- **Requirement:** EX-04 (M)
- **Role:** Management / Compliance Team
- **Steps:** open the Management dashboard and read the **Compliance Index**
  card; compare it with the status counts for the same filter.
- **Expected result:** the Index = (weight of Complied ÷ total counted weight) ×
  100, weighted **Critical 4 / High 3 / Medium 2 / Low 1**, with **Not
  Applicable** excluded. Recompute by hand for one unit and confirm the figure.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-51 — Mobile-first PWA (EX-06)
- **Requirement:** EX-06 (M)
- **Role:** Department User
- **Steps:** on an Android or iOS phone, open the site, **Install** the PWA, sign
  in, use the camera to photograph a certificate and upload it, and update an
  item's status.
- **Expected result:** the app installs to the home screen, works on a phone
  layout, allows a camera upload, and a status update succeeds.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

---

# Part B — Acceptance criteria (§17.3)

### UAT-52 — AC-1: date maths and the reminder schedule from creation
- **Requirement:** AC-1
- **Role:** Compliance Team
- **Preconditions:** default reminder profile in use.
- **Steps:** create an item with **Issue Date 01-Apr-2026**, **Validity 12
  months**, authority processing 15 days.
- **Expected result:** **Expiry = 31-Mar-2027**; **Renewal Due Date = Expiry −
  processing days**; reminders are scheduled at **90/60/30/15/7/3/1 days before
  and on the day**.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-53 — AC-2: escalation at 15 days, once, and visible
- **Requirement:** AC-2
- **Role:** Compliance Team / Department Head
- **Steps:** leave an item **Pending** with its due date 15 days out; run the
  daily job; run it **again the same day**; open the item timeline.
- **Expected result:** the **Department Head is notified once** (no duplicate on
  the re-run), and the escalation is **visible in the item timeline**.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-54 — AC-3: verify-and-close rolls the item forward
- **Requirement:** AC-3
- **Role:** Department User / Compliance Team
- **Steps:** upload a renewed certificate, then approve it in the verification
  panel.
- **Expected result:** the instance **closes**, the old certificate is
  **archived as a version**, the new expiry is set, the **next cycle is created
  automatically**, and reminders for the old cycle **stop**.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-55 — AC-4: scoping and the Critical maker-checker
- **Requirement:** AC-4
- **Role:** Department User (Electrical)
- **Steps:** as the Electrical owner, try to open a **Labour** item and try to
  **close a Critical item** you own.
- **Expected result:** the Labour item is **not visible**; the close attempt is
  **refused and logged**; the Critical item can only be closed by the Compliance
  Team.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-56 — AC-5: dashboard counts equal the register, with drill-down
- **Requirement:** AC-5
- **Role:** Management / Compliance Team
- **Steps:** for several filter combinations (unit × department × category ×
  criticality), compare each dashboard KPI card with the register list for the
  same filter; click each card.
- **Expected result:** counts **match exactly** for every combination, and each
  card **drills down** to the underlying list.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-57 — AC-6: every edit is audited, and the log is immutable
- **Requirement:** AC-6
- **Role:** Administrator / any role
- **Steps:** edit several fields on an item; open the audit log; then try to
  edit or delete an audit record as Administrator and as another role.
- **Expected result:** every edit shows **old/new value, user, time and
  reason**; **no role can edit or delete** audit records.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-58 — AC-7: renewal calendar shows and exports the month
- **Requirement:** AC-7
- **Role:** Compliance Team
- **Steps:** open the Monthly Renewal Calendar, pick a month, list the items due,
  and export.
- **Expected result:** all items due in the selected month appear, and the export
  to **Excel/PDF** works.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

### UAT-59 — AC-8: expired goes red within 1 minute and repeats every 2 days
- **Requirement:** AC-8
- **Role:** Administrator / Compliance Team
- **Steps:** set an item's expiry to **yesterday** (at or just after midnight
  IST), refresh the dashboard within a minute, and check the reminder log over
  the following days.
- **Expected result:** the item appears **red** on the dashboard within **1
  minute** of the expiry date passing (midnight IST), and expired-item reminders
  **repeat every 2 days until the item is closed**.
- **Result:** ☐ Pass ☐ Fail — Tester: ______ Date: ______ Notes:

---

## Coverage matrix

Every mandatory (§5 M) requirement and every acceptance criterion maps to at
least one case above.

| Requirement | Case(s) | | Requirement | Case(s) |
|---|---|---|---|---|
| CD-01 | UAT-01 | | DS-06 | UAT-33, UAT-54 |
| CD-02 | UAT-03 | | AT-01 | UAT-34, UAT-57 |
| CD-03 | UAT-02 | | AT-02 | UAT-35 |
| CD-04 | UAT-04 | | AT-03 | UAT-36 |
| CD-07 | UAT-05 | | AT-04 | UAT-37 |
| CD-08 | UAT-06 | | RP-01 | UAT-38 |
| RT-01 | UAT-07, UAT-52 | | RP-02 | UAT-39 |
| RT-02 | UAT-08 | | RP-03 | UAT-40 |
| RT-03 | UAT-09 | | RP-04 | UAT-41, UAT-58 |
| RT-05 | UAT-10 | | RP-05 | UAT-42 |
| RT-06 | UAT-11 | | RP-06 | UAT-43 |
| RT-07 | UAT-12 | | RP-07 | UAT-44 |
| RM-01 | UAT-13 | | RP-11 | UAT-45 |
| RM-02 | UAT-14 | | AC-01 | UAT-46 |
| RM-03 | UAT-15 | | AC-02 | UAT-47 |
| RM-04 | UAT-16 | | AC-03 | UAT-48 |
| RM-05 | UAT-17 | | AC-04 | UAT-49 |
| RM-06 | UAT-18 | | EX-04 | UAT-50 |
| RM-08 | UAT-19 | | EX-06 | UAT-51 |
| RM-10 | UAT-20 | | AC-1 | UAT-52 |
| RM-11 | UAT-21 | | AC-2 | UAT-53 |
| OW-01 | UAT-22 | | AC-3 | UAT-54 |
| OW-02 | UAT-23 | | AC-4 | UAT-55 |
| OW-03 | UAT-24 | | AC-5 | UAT-56 |
| OW-04 | UAT-25 | | AC-6 | UAT-57 |
| OW-05 | UAT-26 | | AC-7 | UAT-58 |
| OW-07 | UAT-27 | | AC-8 | UAT-59 |
| DS-01 | UAT-28 | | | |
| DS-02 | UAT-29 | | | |
| DS-03 | UAT-30 | | | |
| DS-04 | UAT-31 | | | |
| DS-05 | UAT-32 | | | |

**Mandatory §5 requirements covered:** CD-01, CD-02, CD-03, CD-04, CD-07,
CD-08, RT-01, RT-02, RT-03, RT-05, RT-06, RT-07, RM-01, RM-02, RM-03, RM-04,
RM-05, RM-06, RM-08, RM-10, RM-11, OW-01, OW-02, OW-03, OW-04, OW-05, OW-07,
DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, AT-01, AT-02, AT-03, AT-04, RP-01,
RP-02, RP-03, RP-04, RP-05, RP-06, RP-07, RP-11, AC-01, AC-02, AC-03, AC-04,
EX-04, EX-06 — **all 51**.

**Acceptance criteria covered:** AC-1 … AC-8 — **all 8**.

---

## Sign-off

| | Name | Role | Signature | Date |
|---|---|---|---|---|
| Tester | | | | |
| Compliance Officer | | | | |
| IT / Administrator | | | | |
| Business owner (Go-live gate) | | | | |

**Go-live gate (PRD §17.4):** every Critical item loaded with an owner and valid
evidence, all UAT cases passed (or failures formally waived), pilot run for four
weeks with the Safety/EHS and HR departments in one unit.
