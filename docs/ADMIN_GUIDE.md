# ComplyTrack — Administrator Guide

For the IT / system owner who configures and operates ComplyTrack. Everything
here requires the **Administrator** role unless stated otherwise. The Compliance
Team can do a subset within its scope; that is noted where it applies.

For day-to-day use of the register, see [`USER_GUIDE.md`](USER_GUIDE.md).

---

## 1. Master data

Master data is what every compliance item hangs off. Get it right before loading
the register. All of it lives under **Admin** in the UI and under
`/api/v1/org/...` in the API.

### 1.1 Units and locations

**Admin → Units & Departments → Units.** Each unit has a code, name, type
(Yard / Plant / Office / Subsidiary), parent (for group structures), address and
state. Units drive scoping, the unit-wise dashboard and the unit filter on every
report. The seed ships four: `YARD`, `DRYDOCK`, `OFFICE`, `PIPAVAV` — rename or
add your real list.

*API:* `GET/POST /api/v1/org/units`, `PATCH /api/v1/org/units/{id}`.

### 1.2 Departments and heads

**Admin → Units & Departments → Departments.** Code, name, optional unit, and a
**head user**. The head matters: the escalation ladder notifies the Department
Head at level 1, so every department that owns obligations needs a real head.
The seed sets the first Department User of each department as its head.

*API:* `GET/POST /api/v1/org/departments`, `PATCH /api/v1/org/departments/{id}`.

### 1.3 Categories and sub-categories

**Admin → Categories.** A parent/child tree (Factory, Labour, Environmental,
Explosives/Fire/Electrical, Maritime/Customs, Defence/Quality, Information
Security) with colours and sort order. Categories drive the category-wise
dashboard, reporting and the ability to attach reminder rules per category.

*API:* `GET /api/v1/org/categories`, `POST`, `PATCH /{id}`.

### 1.4 Issuing authorities

**Admin → Authorities.** Name, level (Central / State / Local / Class / Customer
/ Internal), website, contact and **default processing days**. The default
processing days is what the date engine subtracts from expiry to get the renewal
due date, so a realistic value here prevents late starts across the board. The
seed ships 48 authorities.

*API:* `GET/POST /api/v1/org/authorities`, `PATCH /{id}`.

### 1.5 Legal references

**Admin → Legal References.** The library of Acts/Rules/Sections with
jurisdiction and a description, linked from items. The seed ships 23 entries
including the four Labour Codes, the Factories Act, the environmental Acts and
the DPDP Act 2023. Keep this current — see the legal change tracker concept in
PRD §5.9.

*API:* `GET/POST /api/v1/org/legal-references`.

### 1.6 Holiday calendars

**Admin → Holiday Calendars.** State-wise holidays (plus an `ALL` list). A
starter national list is loaded. Holidays are used to show both the statutory
date and the working-day target when a due date lands on a holiday or weekend.

*API:* `GET/POST /api/v1/org/holidays`, `DELETE /{id}`.

### 1.7 System settings

**Admin → System Settings.** Key/value configuration such as
`financial_year_start_month` (default 4 = April), `timezone` (Asia/Kolkata),
`reminder_schedule_hour_ist` (7), `quiet_hours`, `branding`,
`default_lead_time_days` (90) and `exposure_display`. Values are stored in the
database and can be changed without a redeploy.

*API:* `GET /api/v1/org/settings`, `PUT /api/v1/org/settings/{key}`.

> **One-call form helper.** `GET /api/v1/org/lookups` returns everything a
> create/edit form needs (units, departments, categories, authorities,
> criticalities, statuses) in a single response.

---

## 2. User management and the access-review report

**Admin → Users & Roles.**

### 2.1 Creating and maintaining users

1. **New user** — name, work e-mail, mobile, employee ID, department, unit(s)
   and role (Administrator, Compliance Team, Department User, Management View,
   Auditor). A user may hold different roles for different units; scope is
   applied on top of role.
2. **Deactivating a user** sets the status to Inactive and **forces an immediate
   sign-out**. Their owned items are flagged for reassignment — see the orphan
   report below.
3. **Reset password** generates a strong temporary password (or accepts one you
   supply) that passes the password policy — at least `PASSWORD_MIN_LENGTH`
   characters with an uppercase letter, a lowercase letter, a digit and a
   symbol. The user must change it at next sign-in.
4. **SSO** — when Entra ID is configured (see §10), users sign in with
   Microsoft 365; the local password remains the fallback.
5. **MFA** — users can enrol TOTP from their profile; an Administrator can
   disable it in practice.

*API:* `GET/POST /api/v1/users`, `PATCH /{id}`,
`POST /api/v1/users/{id}/reset-password`.

### 2.2 Access-review report (AC-07)

**Admin → Users & Roles → Access review.** A flat, exportable list of who holds
which role in which unit/department — exactly what IT audit asks for. Run it at
least quarterly and after every join/leave/transfer.

*API:* `GET /api/v1/users/access-review`.

### 2.3 Orphan (reassignment) report

**Admin → Users & Roles → Orphans**, or `GET /api/v1/users/orphans`. Lists every
item whose owner is inactive or removed. The PRD (§18) treats this as a standing
risk: run it weekly and reassign. Bulk reassignment is available on the
Compliance Register.

### 2.4 Access scoping recap

- **Administrator** — everything except verifying/closing items (segregation of
  duties).
- **Compliance Team** — all units/departments, verify and close, all reports.
- **Department User** — own department/own items only.
- **Management View** — read-only, all or unit-scoped.
- **Auditor** — read-only, time-boxed, filtered.

---

## 3. Reminder and escalation profiles

### 3.1 Reminder profiles

**Admin → Reminder Profiles.** A profile defines:

- **Offsets** — days before the anchor date. Defaults:
  `[90, 60, 30, 15, 7, 3, 1, 0]` (the `0` is "on the day").
- **Channels** — `email`, `in_app`, `push` (and `sms`/`whatsapp`/`teams` are
  modelled for Phase 2).
- **Recipients by offset** — e.g. 90 days = owner only; 15 days = owner + HOD +
  Compliance; 7 days = + Unit Head; 1 and 0 = + Management.
- **Post-expiry frequency** — default every 2 days until closed (AC-8).
- **Anchor** — `renewal_due_date` for licences (leaves processing time) or
  `statutory_due` for filings. This matches PRD business rule 2.
- **Quiet-hours exemption** — critical profiles can bypass quiet hours.

Three profiles ship: *Default (90/60/30/15/7/3/1/0)*, *Critical (accelerated)*
with 120-day start and a 1-day post-expiry cadence, and *Monthly filing (short
lead)* anchored on the statutory due date. Assign a profile to a template or an
individual item.

*API:* `GET/POST /api/v1/reminders/profiles`, `PATCH /{id}`.

### 3.2 Escalation matrix

**Admin → Escalation Matrix.** A ladder of levels; each rule has a trigger
(number of days before/after), a status condition, the roles to notify and the
channels. The default:

| Level | Trigger | Condition | Notifies |
|---|---|---|---|
| 0 | 90 days before | any live status | owner |
| 1 | 15 days before | Pending | owner, department head |
| 2 | 7 days before | Pending, Query Raised | owner, HOD, unit head, compliance |
| 3 | on expiry / after | any | unit head, plant head, management |
| 4 | 7 days after | any | plant head, management, director |

*API:* `GET /api/v1/reminders/escalation-matrix`.

### 3.3 Delivery log and failed-delivery retry

- **Admin → Reminders → Log** shows every reminder with channel, recipient,
  scheduled/sent time and status (Queued / Sent / Delivered / Failed / Read /
  Skipped).
- **Retry failed** re-sends anything that failed (`POST /api/v1/reminders/retry-failed`).
  Failed deliveries also raise an alert notification to Administrators.
- When SMTP is unconfigured, mail is spooled as `.eml` files under
  `MAIL_OUTBOX_DIR` and can be inspected at `GET /api/v1/reminders/outbox`.

---

## 4. Email templates

**Admin → Email Templates.** Five templates ship — `reminder_upcoming`,
`reminder_expired`, `escalation`, `weekly_digest` and `push_short` — covering
the PRD §11 defaults. Edit subject and HTML body using the placeholders:

`{Greeting}`, `{Item}`, `{Item Code}`, `{Unit}`, `{Reference No.}`,
`{Authority}`, `{Expiry Date}`, `{Renewal Due Date}`, `{Days Left}`,
`{Days Overdue}`, `{Status}`, `{Owner}`, `{Criticality}`,
`{Documents Pending}`, `{Next Escalation Date}`, `{Next Escalation Level}`,
`{Exposure Note}`, `{Link}`.

The templates are English now and multi-language ready (RM-10). Send a test
after editing.

*API:* `GET /api/v1/reminders/templates`, `PATCH /api/v1/reminders/templates/{id}`.

---

## 5. Scheduled reports

**Reports → Schedule Reports**, or `POST /api/v1/reports/schedules`.

A schedule has a report code (R1–R12), a format (`csv`, `xlsx`, `pdf`),
recipients (one or more e-mail addresses), a frequency (`daily`, `weekly`,
`monthly`, `quarterly`) and an active flag. The scheduler's second job
(`scheduled-reports`, daily at **07:15 IST**) picks up everything due, builds the
report and e-mails it as an attachment. Configured schedules are listed at
`GET /api/v1/reports/schedules/list` and removed with `DELETE
/api/v1/reports/schedules/{id}`.

The **Monthly Renewal Calendar (R4)** also exposes an iCal feed so staff can
subscribe from Outlook or Google Calendar.

---

## 6. Audit trail and chain verification

**Admin → Audit Log.** `GET /api/v1/audit` with filters for entity, user, action
and date range; `GET /api/v1/audit/facets` gives the distinct values for the
filter bar.

Every audited event records **who, when (IST and UTC), IP/device, action, old
value, new value and reason** (AT-01). Covered actions include create, update,
delete, status change, document download, permission change, login and export.
Editing dates, owner, criticality, moving status backwards, or archiving
**requires a reason** (AT-04).

**Chain verification (AT-03).** `GET /api/v1/audit/verify` re-walks the
hash chain and confirms nothing has been altered. Run it:

- as a scheduled monthly check,
- immediately before and after any database migration or restore,
- before an inspection, and keep the result with the inspection file.

*API:* `GET /api/v1/audit/export?fmt=csv` (or `xlsx`) produces the auditor export.

**Retention rule.** The audit log is append-only and **no role — including
Administrator — can edit or delete rows**. Retain it for the life of the
establishment's statutory record-keeping obligation; a practical minimum is
**8 years**, aligned with the longest applicable statutory retention period.
Never truncate it. Keep audit exports with the backup set (see §7) and alongside
any matter under inspection until that matter is closed.

---

## 7. The daily job dashboard

**Admin → Jobs** (`GET /api/v1/reminders/jobs`). Shows the heartbeat of the
scheduler:

- **Daily reminders** job — runs at **07:00 IST**; records reminders sent,
  duplicates suppressed, failures, deferrals, escalations raised, instances
  scanned and any errors. A failed run raises an alert notification to
  Administrators (PRD §13 availability requirement).
- **Scheduled reports** job — runs at **07:15 IST**.
- **Run now** (`POST /api/v1/reminders/run`) triggers the reminder job manually
  — it is **idempotent**, so a second run on the same day does not double-send.

If the scheduler shows as `stopped` on `/health`, check `SCHEDULER_ENABLED` and
the container logs.

---

## 8. Backup and restore

Two scripts cover both database engines. Both **refuse to run without an
explicit confirmation argument** and print exactly what they will do.

### 8.1 Backing up

```bash
# Linux / macOS / Git Bash
./scripts/backup.sh --yes [--out DIR]      # or: make backup

# Windows PowerShell
.\scripts\backup.ps1 -Yes [-Out D:\complytrack-backups]
```

They produce a timestamped directory containing:

- `database.sqlite3` (SQLite) **or** `database.dump` (PostgreSQL custom format),
- `storage.tar.gz` (all uploaded evidence),
- `outbox.tar.gz` when spooled mail exists,
- `MANIFEST.txt` with the timestamp, source URLs and **SHA-256 checksums**.

> **Why `.backup` and not `cp`.** Copying a live SQLite file can capture a page
> mid-write and produce a corrupt or torn snapshot. The scripts use SQLite's own
> backup API (`sqlite3 .backup`, or Python's `sqlite3` `backup()` when the CLI
> is absent), which takes a transactionally consistent snapshot while the app
> runs. PostgreSQL uses `pg_dump --format=custom`, also consistent against a
> live server.

### 8.2 Restoring

```bash
./scripts/restore.sh --yes backups/complytrack-20260101T070000Z
./scripts/restore.sh --yes latest          # most recent
# Windows: run the SQLite restore with the Python fallback, or use the .sh
# script under Git Bash; the .ps1 script performs backups.
```

**Stop the application before restoring** — restore overwrites live data. The
SQLite restore keeps a `.pre-restore` copy of the previous database file; the
PostgreSQL restore drops and recreates schema objects with
`pg_restore --clean --if-exists`.

### 8.3 Cadence and retention (PRD §13)

- **Daily** automated database + file backup; **30-day retention**; tested
  restore at least **quarterly**.
- Targets: **RPO ≤ 24 h**, **RTO ≤ 8 h**.
- Store backups **off the application host, inside India**, and verify the
  `MANIFEST.txt` checksums before relying on a backup.
- Verify the audit chain (`/api/v1/audit/verify`) after every restore.
- Schedule it, for example, with cron at 02:00 IST:
  `0 2 * * * cd /opt/complytrack && ./scripts/backup.sh --yes >> logs/backup.log 2>&1`

---

## 9. Import and export

- **Import** (`POST /api/v1/items/import/preview` then `/import/commit`): always
  dry-run first and read the row-level error/warning report. Re-importing
  updates rows by `item_code`.
- **Template** — `GET /api/v1/items/export/template` downloads the Excel import
  template.
- **Export** — `GET /api/v1/items/export/register` exports the register; every
  report exports to CSV/Excel/PDF via `GET /api/v1/reports/{code}/export`.
- **Documents** — `GET /api/v1/documents/{id}/download` is audited on every use;
  `GET /api/v1/documents/{id}/verify` re-hashes the stored file and compares it
  to the recorded SHA-256.

---

## 10. Security hardening

### 10.1 Before go-live checklist

- [ ] **`SECRET_KEY` replaced** with a real secret:
      `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Rotating it
      invalidates all existing tokens.
- [ ] **`DEBUG=false`** and `ENVIRONMENT=production`.
- [ ] **`SEED_DEMO_DATA=false`** and the eleven demo accounts deleted or
      changed (their password is public knowledge — see the README).
- [ ] **TLS 1.2+** terminated in front of the app; port 80 redirects to 443;
      HSTS enabled (see `docker-compose.yml` and README §9.1).
- [ ] **Strong database credentials**; PostgreSQL not published to the host.
- [ ] **Entra ID SSO** configured, or local accounts with MFA enforced.
- [ ] **Backups** running daily to India-resident storage, with a tested
      restore.

### 10.2 What the application already does

- Security headers on every response: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy`, and `Cache-Control: no-store` on `/api/`.
- RBAC enforced **server-side** on every endpoint, plus unit/department scoping.
- Strong local password policy (length + complexity) and bcrypt hashing.
- Account lockout after `MAX_FAILED_LOGINS` (5) for `LOCKOUT_MINUTES` (15),
  session idle timeout, forced logout on deactivation.
- Upload allow-list by extension and a 25 MB size cap; SHA-256 integrity on
  every stored document; every download audited.
- Append-only, hash-chained audit trail.
- Secrets read from environment variables (never baked into the image), and the
  container runs as a **non-root** user.

### 10.3 Applied at the reverse proxy

- **Rate limiting** is not implemented in the application; apply it at nginx
  (`limit_req_zone` / `limit_req`) on `/api/auth/login` in particular, and on
  `/api/` generally. This is a PRD §13 (OWASP) requirement — treat it as a
  go-live task.
- **Request size limits** (`client_max_body_size`) and TLS ciphers are set in
  the nginx config.
- **Vulnerability scanning** and periodic dependency updates are an operational
  process; `backend/requirements.txt` and `frontend/package.json` pin versions.

### 10.4 Data protection (DPDP Act 2023)

- Set `SEED_DEMO_DATA=false`; hold only work contact data.
- Define retention per document class and review annually.
- Record any breach and its response; notify the Data Protection Board where
  required.
- Keep everything (database, storage, backups) in India; no third-party
  analytics; no external AI calls on documents.
- Review the access-review report quarterly and deactivate leavers immediately.

---

## 11. Environment and deployment reference

Configuration is read from the environment (or `backend/.env`). The full table
is in [README §6](../README.md#6-environment-variables). The variables an
Administrator changes most often: `SECRET_KEY`, `DATABASE_URL`, `STORAGE_DIR`,
`SMTP_*`, `SCHEDULER_ENABLED`, `SCHEDULER_HOUR_IST`, `SEED_DEMO_DATA`,
`CORS_ORIGINS`, and the Entra ID `ENTRA_*` values.

Health and metadata for monitoring:

- `GET /health` — liveness/readiness: database, scheduler state, SMTP configured.
- `GET /api/v1/meta` — enumerations and limits the UI uses.
- `GET /api/docs` — the OpenAPI console.

---

*See also: [`README.md`](../README.md) ·
[`USER_GUIDE.md`](USER_GUIDE.md) · [`UAT_SCRIPT.md`](UAT_SCRIPT.md).*
