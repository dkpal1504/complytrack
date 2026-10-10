# ComplyTrack

**Statutory compliance, licence & certificate management for a shipyard / heavy-engineering company.**

ComplyTrack is one searchable register of every statutory obligation the
establishment carries — licences, registrations, permits, periodic returns,
equipment tests and person certifications — with automatic due-date maths,
multi-channel reminders, escalation when things slip, an inspection-ready
document vault, and an append-only audit trail.

---

## 1. What it is and who it is for

A shipyard operates under dozens of overlapping regimes: factory and labour
law, environment, explosives and petroleum, pressure equipment, fire and
electrical, ports and customs, defence and quality/class, and information
security. These are usually tracked in spreadsheets, shared drives and
individual memory, which is how renewals get missed and penalties, stop-work
orders or prosecution follow.

ComplyTrack replaces that with a single system of record. It is built for:

| Who | What they get |
|---|---|
| **Compliance Team** (Factory Compliance Officer, Safety Officer, Legal) | The full register, the renewal workflow, verification and closure, every report |
| **Department Users** (HR, Safety, Environment, Electrical, Mechanical, Stores, Quality, Security, IT) | "My Work" — only the obligations they own, with one-click status updates and uploads |
| **Management** (Unit Head, Plant Head, Director, CEO) | Read-only dashboards, risk view, Compliance Index, scheduled summaries |
| **Administrator** (IT / system owner) | Users, roles, master data, reminder/escalation rules, templates, integrations |
| **Auditor / Inspector** (optional, time-boxed) | Read-only access to a filtered set, with watermarked, time-limited links |

The system tracks and evidences compliance. It does **not** file returns on
government portals and it does not process payroll (PRD §1.5).

---

## 2. Features mapped to the requirement groups

The PRD groups requirements as CD (document/item management), RT (renewal
tracking), RM (reminders), OW (ownership/escalation), DS (document
submission), AT (audit trail), RP (reporting), AC (access control) and EX
(additional features). What ships in the MVP:

**CD — Compliance items (PRD §5.1)**
- Create/edit/archive items with legal reference, authority, reference number,
  issue date, validity, renewal lead time, processing time, fee, criticality.
- Five item types: Licence/Permit, Periodic Filing, Inspection/Test,
  Certificate (equipment/person), Policy/Approval.
- Document upload (PDF/JPG/PNG/DOCX/XLSX, 25 MB each) with in-browser preview.
- Duplicate detection (unit + authority + reference number), mandatory-field
  validation by type, tags, full-text search, saved views, bulk edit/reassign,
  Excel import (dry-run then commit) and Excel export.
- Soft delete only — archived items stay searchable with a reason.

**RT — Renewal tracking (PRD §5.2)**
- `Expiry = Issue Date + Validity` (days / months / years / end of financial
  year / end of calendar year / fixed date annually / no expiry).
- `Renewal Due Date = Expiry − Authority Processing Days`;
  `Internal Target Date = Renewal Due Date − Internal Prep Days`.
- Recurrence engine: monthly, quarterly, half-yearly, annual, financial-year
  anchor, and "N months from last done". Closing a cycle generates the next.
- Derived status: Valid, Upcoming, Due for Renewal, Expired, Perpetual,
  Not Applicable.
- Renewal history per item; "Applied, awaiting authority" keeps an item
  *Compliant – renewal in process*.

**RM — Reminders (PRD §5.3)**
- Configurable offsets, default **90/60/30/15/7/3/1/0 days** and every **2
  days after expiry** until closed.
- Channels: e-mail, in-app notifications (bell + banners), web push (PWA).
- Recipients by offset (owner → + HOD → + Unit Head → + Management).
- Daily per-user digest and weekly management digest; delivery log with retry;
  failed-delivery alerts to the Admin.
- Editable e-mail templates with `{Item}`, `{Days Left}`, `{Owner}`, `{Link}`
  placeholders. Daily job at **07:00 IST**, idempotent (re-running a day never
  double-sends).

**OW — Ownership and escalation (PRD §5.4)**
- Primary Owner, Delegate, Reviewer (Compliance) and Approver on every item.
- Workflow: **Pending → Under Process → Submitted → Renewed → Closed**, plus
  On Hold, Not Applicable and Query Raised side states.
- Five-level escalation matrix (configurable): owner at 90 days, HOD at 15 days
  if still Pending, Unit Head + Compliance at 7 days, Plant Head/Management at
  expiry, CEO/Director at 7 days overdue.
- Escalation records who was notified and when; comments, @mentions, checklists
  and per-stage SLA tracking.

**DS — Document submission (PRD §5.5)**
- Required-document checklist per template (Received / Pending / Not required)
  with owner-wise pending lists.
- Upload of renewed certificate, acknowledgement, challan, inspection report or
  correspondence, each with document type, new reference number and dates.
- Full versioning; older versions read-only and downloadable; every file has a
  SHA-256 shown in version history and re-checkable on demand.
- Compliance Team verification (approve/reject with reason) before closure;
  approval rolls the item forward and creates the next cycle.
- Time-limited, watermarked share links for auditors.

**AT — Audit trail (PRD §5.6)**
- Immutable, append-only, **hash-chained** log of every create/update/delete/
  status change/download/permission change/login/export, with user, IST and UTC
  time, IP/device, old value, new value and reason.
- Per-item timeline combining status changes, comments, uploads, reminders and
  escalations.
- Chain verification endpoint that re-walks the hashes and proves nothing was
  altered; export to CSV for an auditor. No role — Administrator included — can
  edit or delete audit rows.
- Reason mandatory when changing dates, owner, status backwards, or archiving.

**RP — Reporting (PRD §5.7)**
- Twelve standard reports (R1–R12): Compliance Status, Department-wise,
  Unit-wise, Monthly Renewal Calendar, Pending Action (ageing buckets), Expired/
  Expiring, Renewals Completed, Escalation, Submission Monitoring, Audit Trail,
  Quarterly HOD Certificate and the one-page Management Summary.
- Every report exports to CSV, Excel or PDF; the calendar has an iCal feed for
  Outlook/Google; reports can be scheduled by e-mail.

**AC — Access control (PRD §5.8)**
- Roles: Administrator, Compliance Team, Department User, Management View,
  Auditor.
- Server-side RBAC plus Unit/Department data scoping — a Department User only
  sees their own scope (AC-4).
- Microsoft Entra ID (Azure AD) SSO via OIDC, with local e-mail/password + TOTP
  MFA as fallback.
- Account lockout after 5 failed sign-ins, session idle timeout, forced logout
  on deactivation, access-review report for IT audit.

**EX — Additional features (PRD §5.9)**
- **Compliance Index** (M): criticality-weighted score per unit and department.
- **Mobile-first PWA** (M): installable, offline shell, camera upload, push.
- Phase-2 hooks in the data model: Findings & CAPA, contractor compliance, legal
  change tracker, risk-exposure view, asset register and QR codes, HOD
  self-certification, Teams/HRMS/ERP integrations.

---

## 3. Architecture

```
        ┌─────────────────────────────────────────────────────────────┐
        │  Browser — desktop, tablet, or installed PWA (Android/iOS)   │
        └───────────────────────────┬─────────────────────────────────┘
                                    │ HTTPS (TLS 1.2+)
                                    ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  nginx  (reverse proxy, or the API serving the SPA itself)   │
        │   • serves the built React app from frontend/dist            │
        │   • SPA fallback: try_files ... /index.html                  │
        │   • proxies /api/  ──────────────────────────┐               │
        │   • security headers, gzip, asset caching    │               │
        └──────────────────────────────────────────────┼───────────────┘
                                                       ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  FastAPI (uvicorn, N workers)   backend/app/main.py          │
        │   • REST API under /api/v1  ·  OpenAPI at /api/docs          │
        │   • RBAC + Unit/Department scoping (core/rbac.py)            │
        │   • date engine, recurrence, status machine (domain/)        │
        │   • append-only hash-chained audit trail                     │
        │   • reminder & escalation engine (APScheduler, 07:00 IST)    │
        └───────┬───────────────┬───────────────┬──────────────────────┘
                │               │               │
                ▼               ▼               ▼
        ┌──────────────┐ ┌─────────────┐ ┌───────────────────────────┐
        │ PostgreSQL 16│ │ storage/    │ │ outbox/                   │
        │ (prod)       │ │ evidence    │ │ spooled .eml when SMTP    │
        │ SQLite (dev) │ │ documents,  │ │ is not configured         │
        │              │ │ versioned,  │ └─────────────┬─────────────┘
        │              │ │ SHA-256     │               │
        └──────────────┘ └─────────────┘               ▼
                                                ┌──────────────────┐
                                                │ SMTP relay /     │
                                                │ Microsoft Graph  │
                                                └──────────────────┘
```

- **One origin in production.** The SPA and the API are served together, so
  there is one TLS certificate and no CORS surprises.
- **The backend can serve the SPA itself** when `frontend/dist` exists (see
  `FRONTEND_DIST_DIR`), which is handy for a single-box deployment.
- **The reminder job is idempotent.** Running it twice on the same day produces
  no duplicate reminders or escalations, so a retry or a worker restart is safe.

---

## 4. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript, Vite, Tailwind CSS; PWA (service worker + web push) |
| Backend | Python 3.11, FastAPI 0.115, SQLAlchemy 2.0, Pydantic v2 / pydantic-settings |
| Auth | PyJWT, bcrypt, pyotp (TOTP); Microsoft Entra ID OIDC (optional) |
| Database | PostgreSQL 16 in production; SQLite for laptop development |
| Scheduler | APScheduler 3.11 (in-process, IST cron) |
| Reporting | reportlab (PDF), openpyxl (Excel), CSV |
| HTTP client | httpx (SSO/Graph calls) |
| Files | Local filesystem under `storage/`, SHA-256 integrity, versioning |
| Deployment | Docker / Docker Compose; nginx reverse proxy; optional Kubernetes |
| Tests | pytest + pytest-cov; Playwright for end-to-end (frontend) |

Exact pinned versions are in `backend/requirements.txt` and `frontend/package.json`.

---

## 5. Quick start

There are two supported ways to run ComplyTrack. Start with **Path A** on a
laptop; use **Path B** for a server.

### Path A — no Docker, SQLite (works on any laptop)

Prerequisites: Python 3.11+ and Node.js 22+.

```bash
# 1. Backend virtualenv + dependencies
cd backend
python -m venv .venv
#    Windows:
.venv\Scripts\pip install -r requirements.txt
#    macOS / Linux:
.venv/bin/pip install -r requirements.txt
cd ..

# 2. (Optional) local configuration. The app runs with sane defaults without it.
cp .env.example backend/.env        # Windows: Copy-Item .env.example backend\.env

# 3. Frontend dependencies
cd frontend && npm ci && cd ..

# 4. Run the API (creates backend/complytrack.db and seeds the demo data on first boot)
cd backend && .venv/bin/python -m uvicorn app.main:app --reload --port 8000
#    Windows: .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

Open <http://127.0.0.1:8000/api/docs> for the API, <http://127.0.0.1:8000/health>
for the health probe, and — if the SPA has been built into `frontend/dist` —
<http://127.0.0.1:8000/> for the UI.

In a second terminal, run the Vite dev server with hot reload:

```bash
cd frontend && npm run dev        # http://localhost:5173
```

**Shorter route.** The helper scripts do the same thing:

```bash
./scripts/dev.sh install          # or:  make install
./scripts/dev.sh both             # API + Vite together
# Windows PowerShell:
.\scripts\dev.ps1 install
.\scripts\dev.ps1 both
```

### Path B — Docker Compose, PostgreSQL

Prerequisites: Docker with the Compose plugin.

```bash
cp .env.example .env               # edit SECRET_KEY and POSTGRES_PASSWORD
python -c "import secrets; print(secrets.token_urlsafe(48))"   # paste into SECRET_KEY

docker compose up -d --build
docker compose logs -f backend     # watch first-boot seeding
```

- UI: <http://localhost:8080>
- API docs: <http://localhost:8000/api/docs>
- Stop: `docker compose down` (data volumes are kept). `make docker-up` /
  `make docker-down` are shortcuts.

The stack is `db` (PostgreSQL 16) → `backend` (FastAPI) → `frontend` (nginx).
Named volumes keep the database, `storage/` and `outbox/` across rebuilds.

> **PostgreSQL driver.** The production path uses `psycopg` (v3). It is baked
> into `backend/Dockerfile`, and for a non-Docker PostgreSQL install run
> `pip install "psycopg[binary]"` into the virtualenv first.

---

## 6. Environment variables

All variables are read by `backend/app/core/config.py`. Names are
case-insensitive; **list values use JSON syntax**, e.g.
`CORS_ORIGINS=["https://complytrack.example.in"]`. See `.env.example` for a
ready-to-copy template.

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `ComplyTrack` | Product name shown in the API and UI |
| `ENVIRONMENT` | `development` | `development` / `staging` / `production` |
| `DEBUG` | `true` | Verbose errors; **set `false` in production** |
| `DATABASE_URL` | `sqlite:///…/backend/complytrack.db` | Database connection string |
| `STORAGE_DIR` | `backend/storage` | Uploaded evidence files |
| `SECRET_KEY` | dev placeholder | **Signs JWTs — replace in production** |
| `ACCESS_TOKEN_TTL_MINUTES` | `30` | Access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `7` | Refresh-token lifetime |
| `SESSION_IDLE_TIMEOUT_MINUTES` | `60` | Idle session timeout |
| `MAX_FAILED_LOGINS` | `5` | Failures before lockout |
| `LOCKOUT_MINUTES` | `15` | Lockout duration |
| `PASSWORD_MIN_LENGTH` | `12` | Local password policy (upper+lower+digit+symbol also required) |
| `ENTRA_TENANT_ID` / `ENTRA_CLIENT_ID` / `ENTRA_CLIENT_SECRET` | empty | Entra ID SSO; blank = local auth only |
| `ENTRA_REDIRECT_URI` | `http://localhost:8000/api/auth/sso/callback` | SSO redirect URI |
| `SMTP_HOST` | empty | SMTP relay; **blank spools mail to `outbox/`** (see the note below) |
| `SMTP_PORT` | `587` | SMTP port — 587 for STARTTLS, 465 for implicit SSL |
| `SMTP_USER` / `SMTP_PASSWORD` | empty | SMTP credentials |
| `SMTP_FROM` | `complytrack@example.com` | From address |
| `SMTP_USE_TLS` | `true` | STARTTLS — starts plain and upgrades |
| `SMTP_USE_SSL` | `false` | Implicit TLS (SMTPS). Mutually exclusive with `SMTP_USE_TLS`, and wins if both are set |
| `MAIL_OUTBOX_DIR` | `backend/outbox` | Spool directory when SMTP is unset |
| `SCHEDULER_ENABLED` | `true` | Enable the in-process reminder scheduler |
| `SCHEDULER_HOUR_IST` | `7` | Daily run hour (IST) |
| `QUIET_HOURS_START` / `QUIET_HOURS_END` | `21` / `7` | Non-critical reminders defer |
| `DEFAULT_REMINDER_OFFSETS` | `[90, 60, 30, 15, 7, 3, 1, 0]` | Default reminder offsets (days) |
| `POST_EXPIRY_FREQUENCY_DAYS` | `2` | Repeat cadence after expiry |
| `SEED_ON_STARTUP` | `true` | Load reference data on boot (idempotent) |
| `SEED_DEMO_DATA` | `true` | Load demo users + register; **`false` for clean production** |
| `SUPPORT_EMAIL` | `compliance.helpdesk@example.invalid` | Shown in the UI |
| `FRONTEND_DIST_DIR` | `frontend/dist` | Where the API looks for the built SPA |
| `MAX_UPLOAD_MB` / `MAX_UPLOAD_BYTES` | `25` / `26214400` | Upload size limit |
| `ALLOWED_UPLOAD_EXTENSIONS` | `[".pdf",".jpg",".jpeg",".png",".docx",".xlsx",".doc",".xls"]` | Accepted file types |
| `CORS_ORIGINS` | `["http://localhost:5173","http://127.0.0.1:5173","http://localhost:8000"]` | Browser origins allowed to call the API |

Compose-only variables (not read by the app): `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `BACKEND_PORT`, `FRONTEND_PORT`.

### Mail server settings are also editable in the app

An administrator can set the relay from **Reminders & Escalation → E-mail (SMTP)**
without editing a file on the server. Those values are stored in the `settings`
table, and the same screen carries a **Send test e-mail** button that reports
what the mail server actually answered — the quickest way to tell a wrong
password from a wrong port.

Precedence is **all-or-nothing**: as soon as `SMTP_HOST` is set in the
environment, the environment governs *every* mail variable and the screen turns
read-only. That is deliberate. A half-merged state — an environment host with a
port or sender left over from the settings table — is exactly how mail quietly
goes to the wrong relay. For production, set the `SMTP_*` variables in the
environment and leave the screen alone.

---

## 7. Demo users (seeded)

When `SEED_DEMO_DATA=true` (the default), eleven accounts are created. **Every
account uses the same password.** Change or delete these before any real use.

| Name | E-mail | Role | Department | Unit |
|---|---|---|---|---|
| Arun Nair | `admin@complytrack.local` | Administrator | IT | Main Shipyard |
| Priya Menon | `compliance@complytrack.local` | Compliance Team | Legal & Compliance | Main Shipyard |
| Ravi Deshmukh | `safety.owner@complytrack.local` | Department User (Safety head) | Safety | Main Shipyard |
| Meena Iyer | `hr.owner@complytrack.local` | Department User (HR head) | HR & IR | Main Shipyard |
| Sandeep Rao | `ehs.owner@complytrack.local` | Department User (EHS head) | Environment, Health & Safety | Main Shipyard |
| Farhan Qureshi | `electrical.owner@complytrack.local` | Department User (Electrical head) | Electrical | Main Shipyard |
| Kavita Joshi | `quality.owner@complytrack.local` | Department User (Quality head) | Quality & Welding | Main Shipyard |
| Deepak Sharma | `stores.owner@complytrack.local` | Department User (Stores head) | Stores & Petroleum | Main Shipyard |
| Anita Krishnan | `unit.head@complytrack.local` | Management View | Administration | Main Shipyard |
| Vikram Singh | `ceo@complytrack.local` | Management View | Administration | Main Shipyard |
| Leela Thomas | `auditor@complytrack.local` | Auditor | Administration | Main Shipyard |

**Password for all eleven accounts: `Comply@2026!`**

The first Department User of each department is also set as that department's
head, so the escalation ladder has someone to escalate to out of the box.

Seeding also loads: 4 units (Main Shipyard, Dry Dock Complex, Corporate Office,
Pipavav Unit), 16 departments, 48 issuing authorities, 7 categories with
sub-categories, 23 legal references, 3 reminder profiles, the default escalation
matrix, 5 e-mail templates, a starter holiday calendar and the full 80-template
shipyard compliance library from PRD §4.

---

## 8. How to run tests

```bash
# Backend unit + API tests (pytest)
cd backend
.venv/bin/python -m pytest -q                 # Windows: .venv\Scripts\python.exe -m pytest -q
.venv/bin/python -m pytest --cov=app --cov-report=term-missing

# or from the repo root
make test-backend
```

The backend suite contains **600 tests** covering the date engine, recurrence,
escalation triggers, status derivation, workflow transitions and RBAC scoping —
the rules the PRD flags as must-test. The frontend has its own unit suite
(Vitest, `npm test`) for the formatting, status and session logic the screens
share.

```bash
# End-to-end browser tests (Playwright, owned by the frontend)
cd frontend
npx playwright install        # first time only
npm run e2e
```

`make test` runs the backend suite; `make test-e2e` runs the browser suite.

```bash
# Linting (ESLint: TypeScript, React Hooks and jsx-a11y)
cd frontend
npm run lint
```

`make lint` byte-compiles the backend and runs the frontend linter. Errors fail
the run; the one rule left at warning level is `react-hooks/set-state-in-effect`,
whose remaining sites are the deliberate "push an external change into local
state" effects — why each is acceptable is set out in `frontend/eslint.config.js`.

---

## 9. Production and deployment

### 9.1 TLS (PRD §13)

ComplyTrack must never be exposed over plain HTTP in production. The Compose
stack speaks HTTP only on the internal Docker network; terminate TLS in front of
it. `docker-compose.yml` contains a commented-out `nginx` service and a
ready-to-adapt `server` block that enforces **TLS 1.2/1.3**, redirects port 80
to 443 and sets HSTS. Install your certificate (from your on-premise CA, an
Indian certificate authority, or a managed service) at `deploy/certs/`, which is
git-ignored. If the API serves the SPA itself, terminate TLS at your proxy and
pass `X-Forwarded-Proto`.

### 9.2 India data residency (PRD §13)

- Deploy **on-premise or in an Indian cloud region**. The stack must run without
  public internet except for the e-mail relay and the Entra ID SSO endpoints.
- Keep the database, `storage/` and backups inside India. The Compose volumes
  and the `backups/` directory must live on India-resident storage.
- No third-party analytics and no external AI calls on documents. Defence-related
  material is restricted to the private deployment.
- Set `SEED_DEMO_DATA=false` and delete the demo accounts before go-live.

### 9.3 DPDP Act 2023 obligations

The system is designed to be DPDP-aligned:

- **Purpose limitation & data minimisation.** The personal data held is work
  contact detail (name, work e-mail, mobile, employee ID) plus the identity of
  who did what. Nothing more is collected.
- **Notice and consent** for any personal data of individuals (e.g. welder
  certification records) are the organisation's responsibility; record the
  lawful basis in the item's applicability notes.
- **Retention.** Document retention is per class (statutory retention years);
  set the retention rule for each document class and review annually.
- **Breach logging.** Record breaches and the response in the audit trail and
  the legal change tracker; notify the Data Protection Board as required.
- **Data processor agreements** for any hosted service (e-mail relay, SSO).
- Access is minimised by role and scope, and every download is audited.

### 9.4 Backups, restore and retention

- **Cadence:** daily automated database backup + file backup; **30-day
  retention**; a tested restore at least quarterly. Target **RPO ≤ 24 h**,
  **RTO ≤ 8 h** (PRD §13).
- Use the provided scripts (see `docs/ADMIN_GUIDE.md` for the full procedure):

  ```bash
  ./scripts/backup.sh --yes                 # or: make backup
  ./scripts/restore.sh --yes latest         # or: make restore BACKUP=latest
  # Windows: .\scripts\backup.ps1 -Yes
  ```

- Both scripts refuse to run without `--yes`. SQLite snapshots use the SQLite
  backup API (`.backup`), never a file copy, so a backup taken while the app is
  running is internally consistent.
- Store backups off the application host, in India, and verify the SHA-256
  checksums in each backup's `MANIFEST.txt` before relying on it.

### 9.5 Audit-log retention rule

The audit log is **append-only and hash-chained**. It must be retained for the
life of the establishment's statutory record-keeping obligation — a practical
minimum is **8 years**, aligned with the longest statutory retention period
applied to the underlying records, and it must **never be deleted or truncated
by an application role**. Retain audit exports for any period under inspection
until the matter is closed. Run the audit-chain verification
(`GET /api/v1/audit/verify`) before and after any migration, and keep the CSV
export with the backup set.

### 9.6 Scaling note

The daily job is idempotent, so multiple uvicorn workers are safe. If you run
**more than one backend container**, set `SCHEDULER_ENABLED=false` on all but
one so only a single scheduler exists, and let it own the 07:00 IST run.

---

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `ModuleNotFoundError: app` when starting uvicorn | Run uvicorn **from the `backend/` directory**, or use the venv interpreter explicitly (`.venv/Scripts/python.exe -m uvicorn app.main:app`) |
| Port 8000 already in use | Another process holds it. Start with `--port 8001`, or stop the other process |
| Dashboard shows no data on first run | Seeding runs at startup. Check the log line `Seed complete: {...}`; confirm `SEED_ON_STARTUP=true`. Re-run `make seed` |
| No e-mails arrive | Expected when no mail server is set — messages are written as `.eml` files under `backend/outbox/` and can be opened and read on **Reminders & Escalation → Outbox**. Point the engine at a relay on **Reminders & Escalation → E-mail (SMTP)**, then press *Send test e-mail*, which reports the mail server's own error |
| Reminders did not run at 07:00 | Check `/health` → `"scheduler": "running"`. Confirm `SCHEDULER_ENABLED=true`, and use the Admin job dashboard / `POST /api/v1/reminders/run` to trigger manually |
| `422 Some fields need attention` from the API | Field-level validation failed; the response lists `errors[].field` and `.message` for the UI |
| Upload rejected | Over the 25 MB limit or an extension outside `ALLOWED_UPLOAD_EXTENSIONS`. Adjust the env vars if the policy differs |
| Account locked | Five failed sign-ins. Wait `LOCKOUT_MINUTES` (15), or an Admin resets the password |
| `frontend/dist` not found / blank page at `/` | The SPA has not been built. Run `cd frontend && npm run build`, or run the Vite dev server on :5173 |
| `psycopg` / `ModuleNotFoundError: psycopg` | PostgreSQL needs the driver: `pip install "psycopg[binary]"` (already present in the Docker image) |
| `docker compose` complains `.env` not found | `cp .env.example .env` first |
| Backups fail with "database not found" | Set `DATABASE_URL` correctly, or run the app once so `backend/complytrack.db` exists |

---

## 11. Licence and attribution

ComplyTrack is **proprietary software** for the shipyard / heavy-engineering
group. The API metadata declares `license_info = {"name": "Proprietary"}`
(`backend/app/main.py`); there is no open-source licence grant. Internal use,
modification and deployment are governed by the group's IT policy.

Third-party components retain their own licences — FastAPI, SQLAlchemy,
Pydantic, APScheduler, PyJWT, reportlab, openpyxl, React, Vite, Tailwind CSS and
nginx are used under their respective licences, and their notices must be
preserved. The seeded statutory content (PRD §4) is a starting library only and
**must be verified by the Compliance Team against current Central/State rules
before go-live** — frequencies, validities and form numbers change, notably with
the transition to the four Labour Codes.

---

*Related documents: [`docs/USER_GUIDE.md`](USER_GUIDE.md) (day-to-day use by
role) · [`docs/ADMIN_GUIDE.md`](ADMIN_GUIDE.md) (administration) ·
[`docs/UAT_SCRIPT.md`](UAT_SCRIPT.md) (acceptance checklist) ·
`Factory_Compliance_App_PRD.md` (source requirements).*
