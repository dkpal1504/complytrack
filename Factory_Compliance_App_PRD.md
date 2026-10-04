# Product Requirements Document (PRD)
## Statutory Compliance, Licence & Certificate Management System ("ComplyTrack")
**Industry:** Shipbuilding / Heavy Engineering (India) | **Version:** 1.0 (Draft for build) | **Prepared by:** Factory Compliance function

> **How to use this document with a vibe-coding tool:** Section 17 gives a step-by-step build sequence with ready-to-paste prompts. Sections 5 to 10 are the source of truth for behaviour, data and screens. Section 4 is the seed compliance register; **all statutory frequencies, validities and form numbers there must be verified by the Compliance Team against the current Central/State rules before go-live**, because rules and state variations change (notably the transition from the old labour laws to the four Labour Codes).

---

## 1. Purpose and Objectives

### 1.1 Problem statement
A shipyard operates under dozens of overlapping statutory regimes (factory, labour, environment, explosives, pressure equipment, fire, electrical, ports/coastal, defence, class and quality). Today these are tracked in spreadsheets, files and individual memory. Consequences: missed renewals, penalty exposure, stop-work or prosecution risk, audit findings, and no single view of "what is complied and what is pending".

### 1.2 Objectives
1. One centralised, searchable register of every statutory, regulatory, customer/class and internal compliance obligation, with scanned evidence attached.
2. Automatic computation of due and renewal dates, and timely multi-channel reminders (default 90/60/30/15/7/1 days, configurable).
3. Clear ownership for each item, with workflow status and automatic escalation when overdue.
4. Real-time dashboards: Complied vs Pending vs Expired, department-wise, unit-wise, monthly renewal calendar, management summary.
5. Complete revision history and audit trail so the register is inspection-ready (Factory Inspector, Pollution Control Board, PESO, DGQA, class societies, customer and ITAR/CMMC audits).
6. Zero compliance lapses through proactive alerts, not reactive follow-up.

### 1.3 Success metrics
| KPI | Target |
|---|---|
| Licences/certificates lapsed without renewal | 0 |
| Obligations with a named owner | 100% |
| Evidence document attached for completed items | ≥ 98% |
| Renewals initiated on or before the internal target date | ≥ 95% |
| Average time to locate a document during audit | < 2 minutes |
| Dashboard data freshness | Real-time (< 1 minute) |

### 1.4 In scope
Register, renewal tracking, reminders, escalation, workflow, document upload/versioning, audit trail, dashboards, reports, RBAC, Excel import/export, notifications (email, in-app, mobile push/WhatsApp optional).

### 1.5 Out of scope (Phase 1)
Payroll/HR computation, filing returns directly on government portals (the system tracks and evidences filings; it does not file), full permit-to-work/EHS incident management (Phase 3 integration only).

---

## 2. Users and Roles

| Role | Typical person | Main needs |
|---|---|---|
| **Administrator** | IT / system owner | Configure master data, roles, reminder rules, templates, integrations |
| **Compliance Team** | Factory Compliance Officer, Safety Officer, Legal | Create and maintain the register, assign owners, verify submissions, close items, run all reports |
| **Department Users (Owners / Delegates)** | HR, Safety, Environment, Electrical, Mechanical, Stores, Admin, Quality, Security, IT | See assigned items, update status, upload renewed documents, respond to reminders |
| **Management View** | Unit Head, Plant Head, Director, CEO | Read-only dashboards, summaries, risk view, drill-down, scheduled reports |
| *(Optional)* **Auditor / Inspector (read-only, time-boxed)** | Internal/external auditor | View-only access to a filtered set during an audit |

---

## 3. Key Concepts (Domain Model in Plain Language)

- **Compliance Item (Obligation):** A requirement that the organisation must hold or perform. Four behaviours:
  1. **Licence / Registration / Permit** : has issue date and expiry date, needs renewal (e.g. Factory Licence, Consent to Operate, PESO licence).
  2. **Periodic Filing / Return** : recurs on a fixed calendar (monthly, quarterly, half-yearly, annual) (e.g. PF/ESI monthly, Form 4 annual hazardous waste return).
  3. **Inspection / Test / Certification of Equipment or Person** : recurs by interval from last done date, linked to an asset or person (e.g. crane load test every 12 months, welder qualification, boiler inspection).
  4. **One-time / Event-driven Approval or Policy Document** : valid until revoked or changed (e.g. building plan approval, ISO manuals, internal SOPs reviewed annually).
- **Compliance Instance (Cycle):** Each occurrence of an item for a given period (e.g. "Factory Licence FY2026-27 renewal"). Status and evidence belong to the instance. The item is the definition; instances are generated automatically.
- **Owner / Delegate / Reviewer / Approver:** People accountable for the instance.
- **Unit / Location:** Plant, yard, dry dock, office, or subsidiary (multi-entity capable, e.g. Defence yard, Pipavav, other group units).

---

## 4. Seed Compliance Register for a Shipyard (Starter Master Data)

The system must ship with this library as **importable seed data** (editable by the Compliance Team). Columns: Category | Obligation | Typical Authority | Type | Typical cycle | Typical Owner dept.
*(Cycles are indicative. The Compliance Team must confirm each against current law, state rules and the unit's licence conditions.)*

### 4.1 Factory, Safety and Occupational Health
| Obligation | Authority | Type | Cycle | Owner |
|---|---|---|---|---|
| Factory Licence / Registration (Factories Act / OSH Code, State Rules) | Directorate of Industrial Safety & Health (DISH) | Licence | Annual / multi-year per state | Safety/HR |
| Approval of Factory Plans / Stability certificate for buildings & sheds | DISH / Competent engineer | One-time / periodic | Per rules | Civil/Projects |
| Annual and half-yearly returns under Factories Act / OSH Code | DISH | Filing | Half-yearly / Annual | HR/Safety |
| Appointment & notification of Safety Officer, Welfare Officer, Factory Manager | DISH | Registration | On change | HR |
| Safety Committee meetings | Statutory / internal | Recurring meeting | Quarterly (or as per rules) | Safety |
| Medical examination of workers in hazardous processes / periodic health checks | Certifying Surgeon / Occupational health | Inspection | Annual | HR/Medical |
| Medical Centre / Ambulance / First-aider requirements | State rules | Check | Annual | HR/Medical |
| Crane, hoist, lifting machine examination & load test (Form as per State Rules) | Competent person | Equipment test | 12 months (lifting tackles typically 6 months) | Mechanical/Heavy Lift |
| Lifts / elevators inspection & licence | Electrical/Lift Inspectorate | Licence | Annual | Electrical/Civil |
| Boiler inspection & certificate; Steam piping | Directorate of Boilers | Licence | Annual | Utilities |
| Pressure vessels, air receivers, compressors | Competent person / SMPV | Inspection | 12-24 months | Utilities |
| Local Exhaust Ventilation / noise / illumination / dust monitoring | Accredited lab | Test | 6-12 months | Safety/EHS |
| Hot work, confined space, work-at-height, gas-free competency certificates | Internal / accredited trainers | Person certification | 1-3 years | Safety |
| Scaffolding inspection & scaffolder certification | Internal / competent person | Inspection | Per use / weekly tags | Safety |
| Dock/Shipbuilding specific safety regulations (e.g. Dock Workers (Safety, Health & Welfare) provisions where applicable) | Labour / DISH | Compliance | As applicable | Safety |

### 4.2 Labour and Employment
| Obligation | Authority | Type | Cycle | Owner |
|---|---|---|---|---|
| Contractor licence (Principal Employer registration) & Contractor labour licences | Labour Dept | Licence | Annual | HR/IR |
| Inter-state migrant workmen registration/licence (or OSH Code equivalent) | Labour Dept | Licence | Annual | HR/IR |
| PF (EPFO) monthly ECR and challan | EPFO | Filing | Monthly (15th) | HR/Payroll |
| ESIC monthly contribution and half-yearly returns | ESIC | Filing | Monthly / Half-yearly | HR/Payroll |
| Professional Tax returns | State | Filing | Monthly/Annual | Finance/HR |
| Labour Welfare Fund | State board | Filing | Half-yearly/Annual | HR |
| Minimum wages, registers (wages, attendance, overtime, leave) | Labour inspector | Records | Ongoing / annual returns | HR |
| Bonus, Gratuity, Maternity benefit, Equal remuneration records/returns | Labour Dept | Filing | Annual | HR |
| Employee Compensation / Group insurance policies (WC, GPA, mediclaim) | Insurer | Policy | Annual | HR/Finance |
| POSH Internal Committee, annual report | District Officer | Filing | Annual | HR |
| Apprentices Act registration/returns | BOAT/NATS | Filing | As applicable | HR/Training |
| Standing orders certification | Labour Dept | One-time/update | On change | HR/IR |

### 4.3 Environmental
| Obligation | Authority | Type | Cycle | Owner |
|---|---|---|---|---|
| Consent to Establish (CTE) and Consent to Operate (CTO) under Water & Air Acts | State Pollution Control Board | Licence | 1-5 years | EHS |
| Hazardous & Other Wastes authorisation | SPCB | Licence | Per authorisation | EHS |
| Hazardous waste annual return (Form 4) | SPCB | Filing | Annual (by 30 June) | EHS |
| Environmental Statement (Form V) | SPCB | Filing | Annual (by 30 Sept) | EHS |
| Environmental monitoring (stack, ambient air, effluent, noise) | NABL/MoEF recognised lab | Test | Monthly/Quarterly | EHS |
| Environmental Clearance & Coastal Regulation Zone (CRZ) clearance, compliance reports | MoEFCC / SEIAA / Coastal Zone Mgmt Authority | Approval + periodic report | Half-yearly reporting | EHS/Projects |
| Biomedical waste authorisation (medical centre), E-waste, Battery, Plastic waste, Used oil rules registrations/returns | SPCB / CPCB | Registration/Filing | Annual | EHS |
| Ground water extraction NOC | CGWA / State | Approval | Per NOC | Utilities/EHS |
| Effluent/Sewage treatment plant operation records | SPCB | Records | Ongoing | EHS |
| Ship recycling not applicable; ballast/blasting/painting waste (blasting grit, paint sludge) disposal manifests | SPCB | Records | Per movement | EHS |

### 4.4 Explosives, Petroleum, Gases, Electrical and Fire
| Obligation | Authority | Type | Cycle | Owner |
|---|---|---|---|---|
| Petroleum storage licence | PESO | Licence | Annual / multi-year | Stores/Safety |
| Explosives licence (if used), Gas cylinder storage (oxygen, acetylene, LPG, argon, CO2) licences | PESO | Licence | Annual / multi-year | Stores/Safety |
| Static & Mobile Pressure Vessel (SMPV) licence, cylinder hydro-test | PESO | Licence/Test | Per rules | Utilities |
| Electrical installation licence, Electrical Inspector approval, CEA safety regulation compliance, earth-resistance tests | Chief Electrical Inspector | Licence/Test | Annual | Electrical |
| Fire NOC and renewal; Fire audit | State Fire Services | Licence | Annual | Safety/Fire |
| Fire extinguisher refilling & hydrostatic testing, hydrant/pump tests, detector/sprinkler tests, mock drills | Internal / vendor | Test | Monthly/Quarterly/Annual | Fire/Safety |
| Lightning arrester inspection | Competent person | Test | Annual | Electrical |
| DG set/Chimney/Transformer approvals | State Pollution Board / Electrical Inspectorate | Approval | As applicable | Electrical |

### 4.5 Maritime, Port, Customs, Legal Metrology and Statutory Registration
| Obligation | Authority | Type | Cycle | Owner |
|---|---|---|---|---|
| Port/Maritime Board lease, jetty and dry-dock permissions, navigational permissions | State Maritime Board / Port Trust | Permission/Lease | Per agreement | Projects/Legal |
| DG Shipping approvals, ship registration related, statutory ship certificates (during build/delivery) | DG Shipping / Class | Certificate | Per vessel milestone | Quality/Design |
| Customs bonding / EOU or SEZ compliance (if applicable), IEC | Customs / DGFT | Registration | Annual returns | Commercial |
| GST registrations, returns, e-invoice/e-way compliance | GST | Filing | Monthly/Annual | Finance |
| Legal Metrology stamping of weighing/measuring instruments | Legal Metrology Dept | Licence/Verification | Annual | Quality/Stores |
| Shops & Establishment (offices, guest houses), Trade licence, Municipal NOCs | Local body | Licence | Annual | Admin |
| CLRA/BOCW registration for construction works at site | Labour Dept | Registration | Per project | HR/Projects |
| Insurance: marine, CAR/EAR, public liability, fire policy | Insurer | Policy | Annual | Finance/Risk |

### 4.6 Defence, Quality, Class and Information Security (Shipbuilding-specific)
| Obligation | Authority | Type | Cycle | Owner |
|---|---|---|---|---|
| Industrial Licence / defence manufacturing permissions | DPIIT / MoD | Licence | Per licence | Legal/Strategy |
| DGQA / DGAQA / Navy quality approvals, vendor registration | MoD | Approval | Per approval | Quality |
| Security clearance, facility security, visitor and personnel clearance | MoD / Navy / Police | Approval | Per rules | Security |
| Class society approvals & surveys (IRS, DNV, LR, BV, ABS) - firm approval, workshop recognition, survey due dates | Class societies | Approval/Survey | Annual/5-year | Quality |
| Welder/welding procedure qualification (WPS/PQR/WPQ), NDT personnel (ISO 9712 / SNT-TC-1A), surface treatment inspector (e.g. NACE/FROSIO) | Class / Accredited bodies | Person/Procedure certification | Typically 1-3 years, continuity logs | Quality/Welding |
| Calibration of instruments & gauges (NABL traceable) | NABL lab | Test | 6-12 months | Quality/Metrology |
| ISO 9001, 14001, 45001, 27001 (and AS9100 / others if applicable) certificates and surveillance audits | Certification body | Certificate | Annual surveillance / 3-year renewal | Quality/EHS/IT |
| ITAR registration (DDTC), CMMC 2.0 level assessment/affirmation, DFARS clauses (where applicable to the defence entity) | US DoS / DoD / C3PAO | Registration/Assessment | Annual (ITAR) / 3-year (CMMC) | Compliance/IT |
| Data protection: DPDP Act 2023 consent, notice, breach-response readiness, data processor agreements | Data Protection Board | Compliance | Ongoing/annual review | IT/Legal |
| Anti-bribery, code of conduct, whistle-blower, internal audit follow-ups, delegation of authority reviews | Internal | Policy review | Annual | Legal/Internal Audit |

### 4.5 Seed data requirement
- Provide an **Excel/CSV import template** (see Section 12) and ship the above as a pre-loaded library of "Compliance Templates" that can be bulk-instantiated per unit ("apply template to Unit X").
- Every template carries: default lead times, default reminder schedule, default owner department, default documents required, recurrence rule.

---

## 5. Functional Requirements

Priority: **M** = Must (MVP), **S** = Should (Phase 2), **C** = Could (Phase 3).

### 5.1 Compliance Document / Item Management (maps to input §1)
| ID | Requirement | Pri |
|---|---|---|
| CD-01 | Create/edit/archive a Compliance Item with: Name, Category, Sub-category, Legal reference (Act/Rule/Section), Unit/Location, Department/Owner, Issuing Authority, Licence/Certificate/Reference Number, Issue Date, Expiry/Renewal Date, Validity Period (value + unit), Renewal Lead Time (days), Authority processing time (days), Fee/Cost, Criticality (Critical/High/Medium/Low), Applicability notes, Remarks | M |
| CD-02 | Upload scanned copy (PDF/JPG/PNG/DOCX/XLSX, up to 25 MB each, multiple attachments). Virus scan on upload; preview in browser. | M |
| CD-03 | Mandatory-field validation by item type; duplicate detection (same unit + authority + reference number) | M |
| CD-04 | Item types: Licence/Permit, Periodic Filing, Inspection/Test, Certificate (Equipment/Person), Policy/Approval | M |
| CD-05 | Link item to an **Asset** (crane, boiler, vessel, DG set, lift) or **Person** (welder, safety officer) where applicable | S |
| CD-06 | Link related items (e.g. CTO depends on Hazardous waste authorisation; contractor licence depends on principal employer registration) and show dependency warnings | C |
| CD-07 | Tags, full-text search, saved filters, column chooser, bulk edit and bulk import/export (Excel/CSV) | M |
| CD-08 | Soft delete only; archived items retained and searchable with reason | M |
| CD-09 | Legal register view: maintain applicable Acts/Rules library with applicability matrix per unit (Applicable / Not applicable with justification) | S |
| CD-10 | Custom fields configurable by Administrator | S |

### 5.2 Licence and Certificate Renewal Tracking (input §2)
| ID | Requirement | Pri |
|---|---|---|
| RT-01 | **Auto-calculate** Expiry Date = Issue Date + Validity Period (supports days/months/years, "until end of financial year/calendar year", "fixed date every year") unless expiry is directly entered | M |
| RT-02 | **Auto-calculate dates:** *Renewal Due Date* = Expiry − Authority processing time; *Internal Target Date (Start renewal by)* = Renewal Due Date − Internal preparation time. Both visible on item and dashboard. | M |
| RT-03 | **Recurrence engine** for periodic items: monthly (specific day), quarterly, half-yearly, annual, fixed financial-year dates, "N months from last done". On closure of an instance the next instance is generated automatically. | M |
| RT-04 | Calendar-rule exceptions: if due date falls on weekend/holiday, show both "statutory date" and "working-day target" (holiday list per state configurable) | S |
| RT-05 | **Derived status:** *Valid* (>90 days), *Upcoming* (≤ highest reminder window), *Due for renewal* (≤ renewal due date), *Expired* (past expiry), *Perpetual / No expiry*, *Not applicable* | M |
| RT-06 | Renewal history for each item (previous licence numbers, dates, fee paid, who processed, turnaround time) | M |
| RT-07 | "Deemed renewal / Applied, awaiting authority" flag: if renewal was applied before expiry, item remains *Compliant – Renewal in Process* with acknowledgement receipt attached (important for legal defence) | M |
| RT-08 | Grace-period / penalty-window fields (late fee, penalty per day) with exposure estimate on dashboard | C |

### 5.3 Automated Reminder System (input §3)
| ID | Requirement | Pri |
|---|---|---|
| RM-01 | Reminder schedule configurable **globally, per category, per criticality and per item**. Default offsets: **90, 60, 30, 15, 7, 3, 1 days before** due/expiry, **on the day**, then **every 2 days after expiry** until closed | M |
| RM-02 | Channels: **Email**, **In-app notification (bell + dashboard banners)**, **Mobile push (PWA/FCM)**, optional **WhatsApp/SMS** (Phase 2) and **Microsoft Teams message/Adaptive Card** (Phase 2) | M (email, in-app, push), S (others) |
| RM-03 | Recipients: Owner, Delegate, Department Head, Compliance Team; configurable per offset (e.g. 90-day = owner only, 15-day = owner + HOD, expired = + Unit Head + Management) | M |
| RM-04 | Reminder content: item, unit, authority, reference number, expiry/due date, days remaining, current status, required documents checklist, direct deep-link to update the item, "Mark as Under Process" one-click action | M |
| RM-05 | **Daily digest** per user (all their open items) and **weekly management digest** (PDF/HTML) | M |
| RM-06 | Reminders **stop automatically** when item status becomes Submitted/Renewed/Closed; resume on re-open | M |
| RM-07 | Snooze (limited, e.g. max 2 times by 3 days, reason mandatory, logged) | S |
| RM-08 | Delivery tracking: sent / delivered / failed / read (where available) with retry on failure; failed-delivery alert to Admin | M |
| RM-09 | Quiet hours and working-day-only sending (configurable); critical items bypass quiet hours | S |
| RM-10 | Email templates editable by Admin with placeholders ({item_name}, {days_left}, {owner}, {link} etc.), English now, multi-language ready | M |
| RM-11 | Scheduler runs at least daily (default 07:00 IST) and is idempotent (no duplicate reminders if rerun) | M |

### 5.4 Compliance Owner Responsibility and Escalation (input §4)
| ID | Requirement | Pri |
|---|---|---|
| OW-01 | Each item has **Primary Owner, Delegate (alternate), Reviewer (Compliance Team), Approver (HOD/Unit Head)**. Owner must be a named active user; when a user is deactivated, items are flagged for reassignment | M |
| OW-02 | Bulk reassignment, auto-assign by department rule | M |
| OW-03 | **Status workflow:** *Pending → Under Process → Submitted → Renewed → Closed* (full rules in Section 8). Additional system states: *Overdue*, *Expired*, *On Hold*, *Not Applicable*, *Rejected/Query raised by authority* | M |
| OW-04 | **Escalation matrix** (configurable per criticality). Default: Level 0 reminder to Owner; Level 1 at due-date minus 15 days if still *Pending* → Department Head; Level 2 at due-date minus 7 days if not *Under Process* → Unit Head and Compliance Team; Level 3 at expiry or overdue ≥ 1 day → Plant Head/Management; Level 4 overdue ≥ 7 days (critical) → CEO/Director | M |
| OW-05 | Escalation records who was notified, when, and outcome; visible in item timeline | M |
| OW-06 | Owner acknowledgement: owner must accept assignment; non-acknowledgement triggers reminder | S |
| OW-07 | Comments, @mentions, internal notes, query-response log with authority (e.g. "Inspector asked for revised drawing") | M |
| OW-08 | SLA tracking: days taken per status stage, turnaround time by authority | S |
| OW-09 | Task checklist inside each instance (e.g. Form filled, fee paid, challan uploaded, site inspection scheduled) with auto progress % | S |

### 5.5 Document Submission Monitoring (input §6)
| ID | Requirement | Pri |
|---|---|---|
| DS-01 | Required-documents checklist per template (e.g. for CTO renewal: application form, fee challan, site plan, previous consent, monitoring reports). Items can be marked Received / Pending / Not required | M |
| DS-02 | Reminders for **pending submission** (instance-level and checklist-level), with owner-wise pending list | M |
| DS-03 | Upload facility for **renewed certificate**, application acknowledgement, payment receipt, inspection report, correspondence. Each upload requires document type, new reference number, issue and new expiry date | M |
| DS-04 | On upload of renewed certificate and Compliance Team verification, the system **rolls the item forward** (updates current licence details, stores the old one in history, creates next cycle) | M |
| DS-05 | **Versioning:** every file has version number, uploaded by/at, change note; older versions retained, read-only, downloadable | M |
| DS-06 | **Verification step:** Compliance Team verifies uploaded renewal (approve / reject with reason) before closure | M |
| DS-07 | Document expiry date OCR assist (suggest issue/expiry date from scanned certificate, user confirms) | C |
| DS-08 | Retention policy per document class (e.g. statutory retention years), legal-hold flag | S |
| DS-09 | Secure sharing: time-limited link for auditors/inspectors (view only, watermark with user and time) | S |

### 5.6 Audit Trail and Revision History (input §6)
| ID | Requirement | Pri |
|---|---|---|
| AT-01 | **Immutable audit log** for every create/update/delete/status change/download/permission change/login/export: who, when (IST + UTC), IP/device, old value, new value, reason | M |
| AT-02 | Per-item **timeline** combining status changes, comments, uploads, reminders sent, escalations | M |
| AT-03 | Audit log is append-only, not editable by any role including Administrator; export to CSV/PDF with hash for tamper evidence | M |
| AT-04 | Mandatory "reason for change" when editing dates, owner, status backward, or deleting/archiving | M |
| AT-05 | Document integrity: store SHA-256 of each file, show on version history | S |

### 5.7 Reporting and Dashboards (input §5, §2)
Detailed in Section 7. Requirements:
| ID | Requirement | Pri |
|---|---|---|
| RP-01 | Compliance Status Report (Complied / Pending / Under Process / Overdue / Expired) with filters | M |
| RP-02 | Department-wise compliance status | M |
| RP-03 | Unit/Location-wise and Category-wise (Factory, Labour, Environmental...) status | M |
| RP-04 | **Monthly renewal calendar** (month grid + list; 12-month forward view; iCal/Outlook feed) | M |
| RP-05 | Pending Action Report (owner-wise, ageing buckets 0-7, 8-15, 16-30, 30+ days) | M |
| RP-06 | Expired and Expiring report (next 30/60/90/180/365 days) | M |
| RP-07 | Management Summary (one-page PDF, auto-emailed weekly/monthly) | M |
| RP-08 | Escalation report, Renewal turnaround report, Authority-wise performance, Cost of compliance (fees) report | S |
| RP-09 | Audit-ready pack: pick Unit + Category → export index + all current certificates as ZIP/PDF bundle | S |
| RP-10 | Scheduled reports by email (PDF/Excel), saved report definitions | S |
| RP-11 | All reports exportable to Excel/PDF/CSV; print-friendly | M |

### 5.8 User Access Control (input §7)
Detailed matrix in Section 9. Requirements:
| ID | Requirement | Pri |
|---|---|---|
| AC-01 | Roles: **Administrator, Compliance Team, Department User, Management View** (+ optional Auditor) | M |
| AC-02 | **Data scoping** by Unit and Department (Department Users only see their department's items unless granted more) | M |
| AC-03 | Authentication: SSO with **Microsoft Entra ID (Azure AD / Office 365)** via OIDC/SAML as primary; local login with strong password policy and TOTP MFA as fallback | M |
| AC-04 | Session timeout, device/session management, account lockout, forced logout on deactivation | M |
| AC-05 | Field-level restrictions (e.g. fees/penalty visible to Compliance and Management only) | S |
| AC-06 | Delegation during leave (temporary owner substitution with start/end dates) | S |
| AC-07 | Access review report (who has what role) for IT audit | S |

### 5.9 Additional Features Recommended by the Compliance Officer
| ID | Feature | Why | Pri |
|---|---|---|---|
| EX-01 | **Inspection / Audit findings and CAPA tracker** (observations by Factory Inspector, PCB, PESO, class, customer, internal audit; action, owner, due date, closure evidence) | Findings are compliance items too | S |
| EX-02 | **Contractor compliance** (each contractor's labour licence, PF/ESI code, insurance, safety induction, expiry) | Principal-employer liability | S |
| EX-03 | **Legal change tracker** (log of new Acts/amendments, impact assessment, action owner) | Labour Codes transition etc. | S |
| EX-04 | **Compliance Score / Index** per unit and department | Management KPI | M |
| EX-05 | **Risk exposure view** (criticality x days overdue x potential penalty/stop-work impact) | Prioritisation | S |
| EX-06 | **Mobile-first PWA** for site staff: scan a certificate with camera, upload, update status | Yard-floor usability | M |
| EX-07 | **Self-certification / quarterly compliance certificate** by each HOD (sign-off workflow feeding management reports) | Accountability | S |
| EX-08 | **Asset register link** and QR codes on equipment (crane, boiler, extinguisher) showing last/next test date | Inspection readiness | C |
| EX-09 | Integration hooks: Microsoft Teams/Outlook calendar, HRMS (user and org sync), ERP/SAP (vendor/asset), SharePoint document library | Adoption | S |
| EX-10 | AI assistant (Phase 3): natural-language search ("Which PESO licences expire in the next 120 days at the yard?"), certificate data extraction, draft renewal letters | Productivity | C |

---

## 6. Business Rules

1. **Compliance status (what the dashboard counts as "Complied")**
   - *Complied:* item has a valid, verified certificate/filing on record for the current cycle (or renewal applied within time with acknowledgement, flagged "Complied – renewal in process").
   - *Pending:* cycle open and not yet at *Submitted*, but not yet overdue.
   - *Under Process:* owner has started; application in preparation or filed and awaiting authority.
   - *Overdue:* due date passed without Submitted/Renewed/Closed (for filings), or internal target date passed.
   - *Expired:* certificate/licence expiry date passed without valid renewal or acknowledged application. **Highest severity.**
   - *Not Applicable:* approved by Compliance Team with justification; reviewed annually.
2. **Date logic:** `Expiry = IssueDate + Validity` (unless entered). `RenewalDueDate = Expiry − AuthorityProcessingDays`. `InternalTargetDate = RenewalDueDate − InternalPrepDays`. Reminder dates are computed from **RenewalDueDate** for licences (so that "30 days before" leaves time to renew) and from **statutory due date** for filings. The Admin can switch the anchor to Expiry per category.
3. **Closure rule:** An instance can be *Closed* only if (a) evidence is uploaded, (b) new expiry/next due date is captured (if applicable), (c) Compliance Team has verified. Owners cannot close their own item for **Critical** items (maker-checker).
4. **Roll-forward:** On Closed, next cycle auto-created with next due date; reminders re-scheduled.
5. **Back-dated entries** need reason and Compliance Team approval.
6. **Escalation timers** run on calendar days (configurable to working days).
7. **Reminders never fire for** Closed, Not Applicable or On Hold items; *On Hold* requires reason and review date.
8. **Financial year** configurable (April-March default).
9. **Time zone:** IST; store UTC.

---

## 7. Dashboards and Reports (Detailed Specification)

### 7.1 Management Summary Dashboard (landing page for Management View)
Top filter bar: **Unit/Location | Department | Category | Criticality | Owner | Period (FY/quarter/month)**.

**KPI cards (click to drill-down):**
1. Total active obligations
2. **Complied** (count and %)
3. **Pending** (not yet started)
4. **Under Process / Submitted**
5. **Due in next 30 days**
6. **Overdue** (count; red)
7. **Expired licences/certificates** (count; red, pulsing)
8. **Compliance Index (%)** = Complied / (Complied + Pending + Under Process + Overdue + Expired), weighted by criticality (Critical x4, High x3, Medium x2, Low x1)

**Visuals:**
- Doughnut: overall status split (Complied / Under Process / Pending / Overdue / Expired)
- Stacked bar: **Department-wise** status
- Stacked bar: **Unit-wise** status (for multi-yard)
- Bar: **Category-wise** (Factory, Labour, Environmental, Explosives/Fire/Electrical, Maritime/Customs, Defence/Quality, Info-Security) compliance %
- Timeline/heat map: **Renewals by month** for the next 12 months (colour-coded)
- Trend line: Compliance Index month-by-month (last 12 months)
- **Top 10 Critical risks** table (item, unit, owner, days overdue/left, status)
- **Escalations active** (level, since when)
- **Owner leaderboard / backlog** (items pending per owner, ageing)
- Cost: renewal fees due in next quarter (Compliance/Management only)

### 7.2 Compliance Officer Operational Dashboard
- Tabs: **Expired | Due for renewal (≤ 30d) | Upcoming (31-90d) | Upcoming (91-180d) | Pending submissions | Awaiting verification | Awaiting authority**
- Each tab: table with colour-coded **RAG** (Red = Expired/Overdue, Amber = ≤ 30 days or Under Process near due, Green = valid/complied, Grey = N/A), quick actions (Reassign, Send reminder now, Open item, Upload renewal, Escalate)
- "Today's actions" widget: items needing attention today
- Calendar widget: month view with due dates; click a date to list items

### 7.3 Department User "My Work" Dashboard
- My open items sorted by urgency; My upcoming 90 days; Items awaiting my upload; Items I delegated; Overdue items with escalation level; one-click status update; file upload drag-and-drop.

### 7.4 Standard Reports (all with filters, export, schedule)
| # | Report | Content |
|---|---|---|
| R1 | Compliance Status Report | Every item with status, owner, due/expiry date, days left |
| R2 | Department-wise Status | Counts and % per status per department, drill-down list |
| R3 | Unit/Location-wise Status | Same by unit |
| R4 | **Monthly Renewal Calendar** | Month-by-month list and grid of due/expiry dates, 12 months forward; downloadable as Excel/PDF; subscribe via iCal |
| R5 | Pending Action Report | Open instances by owner with ageing, last reminder date, escalation level |
| R6 | Expired / Expiring Licences | Sorted by expiry with criticality and potential exposure |
| R7 | Renewals Completed | By period; turnaround days; on-time vs late |
| R8 | Escalation Report | Who was escalated to, when, outcome |
| R9 | Submission Monitoring | Required documents pending vs received |
| R10 | Audit Trail Report | Filter by user/item/date/action |
| R11 | Compliance Certificate (quarterly HOD sign-off) | Per department |
| R12 | Management Summary (PDF) | KPIs, top risks, trends; auto-emailed |

---

## 8. Workflow and State Machine

```
        (auto-created from recurrence/renewal rule)
                     |
                 [PENDING] --(owner starts / acknowledges)--> [UNDER PROCESS]
                     |                                             |
                     |                       (application/return filed, ack uploaded)
                     |                                             v
                     |                                       [SUBMITTED]
                     |                                             |
                     |                       (authority issues renewed licence/ certificate uploaded)
                     |                                             v
                     |                                        [RENEWED]
                     |                                             |
                     |                   (Compliance Team verifies evidence & next dates)
                     |                                             v
                     +------------------------------------->  [CLOSED]  --> next cycle auto-created

Side states: ON HOLD (reason + review date) | NOT APPLICABLE (approval) | QUERY RAISED BY AUTHORITY (returns to UNDER PROCESS)
System-derived flags (not manual): OVERDUE, EXPIRED, RENEWAL-IN-PROCESS (applied before expiry)
```

**Transition rules**
| From → To | Who | Mandatory |
|---|---|---|
| Pending → Under Process | Owner/Delegate | Start date, expected filing date |
| Under Process → Submitted | Owner/Delegate | Acknowledgement/receipt/challan upload, submission date |
| Submitted → Renewed | Owner/Delegate or Compliance Team | Renewed certificate upload, new reference no., issue and expiry dates |
| Renewed → Closed | **Compliance Team (verifier)** | Verification remark; auto-roll to next cycle |
| Any → On Hold / Not Applicable | Compliance Team | Reason, review date / approver |
| Backward moves | Compliance Team | Reason (audit logged) |

For **periodic filings** (e.g. PF challan), "Submitted" can be followed directly by "Closed" (no renewal certificate), configurable per template.

---

## 9. Role-Based Access Matrix

| Capability | Administrator | Compliance Team | Department User | Management View |
|---|:--:|:--:|:--:|:--:|
| Manage users, roles, units, departments | ✅ | ❌ | ❌ | ❌ |
| Configure reminder rules, escalation matrix, templates | ✅ | ✅ (propose / edit within scope) | ❌ | ❌ |
| Create/edit compliance items & templates | ✅ | ✅ | ❌ (can request) | ❌ |
| View all items (all units/depts) | ✅ | ✅ | ❌ (own dept/own items) | ✅ (read-only) |
| Update status, add comments, upload documents on assigned items | ✅ | ✅ | ✅ | ❌ |
| Verify and close items | ❌ (segregation of duties) | ✅ | ❌ | ❌ |
| Delete/archive items | ✅ (with reason) | ✅ (with reason) | ❌ | ❌ |
| Reassign owners | ✅ | ✅ | ❌ (can request) | ❌ |
| View dashboards | ✅ | ✅ (all) | Dept-scoped | ✅ (all, or unit-scoped) |
| Run/export/schedule reports | ✅ | ✅ | Own dept | ✅ (view/download summary) |
| View audit logs | ✅ | ✅ | ❌ | ❌ |
| Download documents | ✅ | ✅ | ✅ (own scope) | ✅ (configurable) |
| Manage integrations/email/SMTP/SSO settings | ✅ | ❌ | ❌ | ❌ |

Notes: scope by **Unit** and **Department** is applied on top of role. A user can hold multiple roles for different units.

---

## 10. Data Model (Entities and Key Fields)

> Use PostgreSQL. UUID primary keys, `created_at/by`, `updated_at/by`, `is_deleted` on all tables.

**organisation_unit**: id, code, name, type (Yard / Plant / Office / Subsidiary), parent_id, address, state, GSTIN (optional), active
**department**: id, code, name, head_user_id, unit_id (optional)
**user**: id, name, email, mobile, employee_id, department_id, unit_ids[], role, entra_object_id, status, mfa_enabled, device_tokens[]
**issuing_authority**: id, name, level (Central/State/Local/Class/Customer/Internal), website, contact, default_processing_days
**category / sub_category**: id, name, parent_id
**legal_reference**: id, act_rule_name, section, jurisdiction, description
**compliance_template**: id, name, category_id, type, authority_id, default_validity_value/unit, recurrence_rule, lead_time_days, authority_processing_days, internal_prep_days, default_owner_dept_id, criticality, required_documents[], reminder_profile_id, escalation_profile_id, legal_reference_ids[]
**compliance_item**: id, template_id, item_code, name, category_id, type, unit_id, department_id, owner_id, delegate_id, reviewer_id, approver_id, authority_id, reference_number, issue_date, validity_value/unit, expiry_date, renewal_due_date, internal_target_date, criticality, applicability (Applicable/NA), asset_id, person_ref, fee_amount, remarks, current_status (derived), is_perpetual
**compliance_instance (cycle)**: id, item_id, cycle_label (e.g. FY2026-27), period_start, period_end, due_date, status, started_at, submitted_at, renewed_at, closed_at, closed_by, acknowledgement_no, new_reference_number, new_issue_date, new_expiry_date, delay_days, verification_status, verification_remark
**instance_checklist**: id, instance_id, item_name, status (Pending/Received/NA), received_by/at
**document**: id, item_id, instance_id, doc_type (Certificate/Application/Acknowledgement/Challan/Report/Correspondence), title, file_name, mime, size, storage_key, sha256, version_no, is_current, uploaded_by/at, change_note, retention_until
**reminder_profile**: id, name, offsets[] (days), channels[], recipients_by_offset, post_expiry_frequency_days
**reminder_log**: id, instance_id, offset, channel, recipient_id, scheduled_at, sent_at, status (Queued/Sent/Delivered/Failed/Read), error, template_id
**escalation_profile / escalation_rule**: id, profile_id, level, trigger (days_before/after, status_condition), notify_roles/users, channels
**escalation_log**: id, instance_id, level, notified_to[], triggered_at, acknowledged_at
**comment**: id, instance_id/item_id, user_id, body, mentions[], created_at
**audit_log**: id, entity_type, entity_id, action, field, old_value, new_value, reason, user_id, ip, user_agent, ts_utc, prev_hash, hash (hash chain)
**notification (in-app)**: id, user_id, title, body, link, read_at
**holiday_calendar**: id, state, date, name
**asset** (Phase 2): id, tag, name, type, location, unit_id, owner_dept_id
**contractor** (Phase 2): id, name, licence_no, PF/ESI codes, valid_till, unit_id
**finding_capa** (Phase 2): id, source, observation, severity, owner_id, target_date, status, evidence_ids[]
**settings**: key-value (SMTP/Graph, SSO, FY start, quiet hours, default lead times, branding)

---

## 11. Notification Templates (Defaults)

**Email – Upcoming renewal (offset reminder)**
Subject: `[ACTION] {criticality} | {item_name} ({unit}) expires in {days_left} days – due {due_date}`
Body: Greeting; summary table (Item, Reference No., Authority, Expiry, Renewal Due Date, Status, Owner); required documents checklist with pending items highlighted; buttons: **Open Item**, **Mark Under Process**, **Upload Renewal**; footer: escalation notice ("If no action by {next_escalation_date}, this will be escalated to {next_level}").

**Email – Expired/Overdue (red theme)**: Subject `[EXPIRED] {item_name} – {days_overdue} days overdue – Immediate action`. Includes exposure note (penalty/stop-work risk) from the item's remarks.

**Escalation email**: lists the owner, history of earlier reminders and the date they were sent.

**Weekly Management Digest**: KPI strip, top 10 risks, items expiring in next 30 days, expired list, department league table.

**Push/in-app**: short text: `{item_name} – {days_left} d left – tap to update`.

---

## 12. Import / Export

- **Excel import template** with columns: Unit, Department, Category, Item Name, Type, Authority, Reference No., Issue Date, Validity (value), Validity (unit), Expiry Date, Owner Email, Delegate Email, Criticality, Lead Time Days, Authority Processing Days, Recurrence, Reminder Profile, File Name (optional, attachments uploaded as ZIP and matched by file name).
- Import dry-run with row-level validation report (errors/warnings), then commit. Re-import updates by `item_code`.
- Export any grid to Excel/CSV/PDF.
- Backup/export of all documents as a ZIP with index (audit pack).

---

## 13. Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Availability** | 99.5% during business hours; scheduler monitored with heartbeat and alert to Admin if the daily run fails |
| **Performance** | Dashboard loads < 3 s for 10,000 items; search < 1 s; 100 concurrent users |
| **Scalability** | Multi-unit, up to 50,000 items and 500,000 documents without redesign |
| **Security** | TLS 1.2+; encryption at rest for DB and files; OWASP Top-10 hardening; RBAC enforced server-side; rate limiting; CSRF/XSS protections; secrets in vault; periodic vulnerability scan |
| **Data protection** | DPDP Act 2023 aligned: purpose limitation, minimal personal data (mostly work emails/phones), retention rules, breach logging. For defence-related documents: hosting in India, restricted access, no third-party analytics, no external AI calls on sensitive documents unless approved |
| **Hosting** | Deployable **on-premise / private cloud in India** (Docker/Kubernetes) with option for Indian cloud region. Must run without public internet except for email/SSO endpoints |
| **Audit & integrity** | Append-only hash-chained audit log, file hashes, time-stamped evidence |
| **Backup/DR** | Daily DB and file backups, 30-day retention, tested restore, RPO ≤ 24 h, RTO ≤ 8 h |
| **Usability** | Responsive web + installable PWA (Android/iOS), English UI (Hindi/Gujarati/Marathi-ready i18n), WCAG 2.1 AA basics, keyboard navigation |
| **Compatibility** | Latest Chrome/Edge/Safari/Firefox; Android 10+, iOS 15+ |
| **Maintainability** | Modular code, API-first, automated tests (≥ 70% coverage on business rules: dates, recurrence, reminders, escalation), CI pipeline, migrations versioned |
| **Observability** | Structured logs, error tracking, job-queue dashboard, health endpoint |
| **Time/Locale** | IST, DD-MMM-YYYY display, Indian number format |

---

## 14. Recommended Technical Approach (for the vibe-coding tool)

*(Replace with the Group's approved stack if different.)*
- **Frontend:** React + TypeScript (Next.js or Vite), Tailwind CSS, shadcn/ui or Ant Design, TanStack Table, Recharts/ECharts for charts, FullCalendar for calendar. PWA with service worker and Web Push.
- **Backend:** Python FastAPI (or Node NestJS), REST + OpenAPI, Pydantic validation, SQLAlchemy/Alembic (or Prisma).
- **Database:** PostgreSQL 15+.
- **Job scheduler/queue:** Celery + Redis (or BullMQ/pg-boss) for reminders, escalations, recurrence generation, digest emails.
- **File storage:** MinIO/S3-compatible, or SharePoint/OneDrive via Microsoft Graph if the Group prefers its Microsoft 365 tenant. Antivirus scanning (ClamAV).
- **Auth:** Microsoft Entra ID OIDC (MSAL) + local fallback with TOTP.
- **Email:** Microsoft Graph `sendMail` or SMTP relay; optional Teams webhook/Adaptive Cards.
- **Mobile push:** Web Push (VAPID) / FCM.
- **Deployment:** Docker Compose for MVP; Kubernetes optional. Nginx reverse proxy.
- **Reporting/PDF:** server-side HTML-to-PDF (Playwright/WeasyPrint); Excel via openpyxl/ExcelJS.

**Key logic that must be unit-tested:** validity/expiry calculation, recurrence generation (month-end, leap year, FY boundaries), reminder scheduling idempotency, escalation triggers, status derivation, roll-forward on closure, RBAC scoping.

---

## 15. Screen Inventory

1. Login / SSO
2. **Management Dashboard**
3. **Compliance Officer Dashboard** (tabs)
4. **My Work** (Department user)
5. Compliance Register (grid with filters, saved views, bulk actions)
6. Compliance Item – Create/Edit (tabs: Details, Dates & Validity, Owners, Reminders, Documents, History)
7. Compliance Item – Detail (header with RAG status chip, timeline, checklist, documents, comments, escalations)
8. Instance/Renewal Workspace (status stepper, checklist, upload renewal, verification panel)
9. Templates Library (and apply-to-unit wizard)
10. Calendar (month/week/list; iCal link)
11. Reports Hub (R1-R12) and Schedule Reports
12. Notification Centre
13. Audit Log Viewer
14. Admin: Users & Roles, Units & Departments, Authorities, Categories, Reminder Profiles, Escalation Matrix, Email Templates, Holiday Calendars, System Settings, Integration Settings, Import/Export
15. Phase 2: Findings & CAPA, Contractors, Assets, Legal Register & Change Tracker

**UI guidance:** clean, enterprise look; RAG colours (Red/Amber/Green/Grey) with icons and text for colour-blind safety; sticky filters; breadcrumb; empty states with guidance; mobile-first layouts for My Work, upload and status update.

---

## 16. API Outline (REST)

```
POST   /auth/sso/callback            GET /me
GET/POST/PUT/DELETE  /units, /departments, /authorities, /categories, /users
GET/POST             /templates ; POST /templates/{id}/apply {unit_id}
GET/POST/PUT         /items ; GET /items/{id} ; POST /items/import ; GET /items/export
GET/POST             /items/{id}/instances ; PUT /instances/{id}/status
POST                 /instances/{id}/documents (multipart) ; GET /documents/{id}/download ; GET /documents/{id}/versions
POST                 /instances/{id}/verify {approve|reject, remark}
GET/POST             /instances/{id}/comments ; /instances/{id}/checklist
GET/PUT              /reminder-profiles ; /escalation-profiles ; /email-templates
POST                 /reminders/run (admin/manual trigger) ; GET /reminders/log
GET                  /dashboard/summary?unit=&dept=&category=&period=
GET                  /dashboard/department-status ; /dashboard/renewal-calendar ; /dashboard/top-risks
GET                  /reports/{code}?filters... ; POST /reports/{code}/schedule
GET                  /audit-logs?entity=&user=&from=&to=
GET                  /notifications ; POST /notifications/{id}/read ; POST /push/subscribe
GET                  /calendar.ics?token=
```

---

## 17. Delivery Plan and Vibe-Coding Build Sequence

### 17.1 Phases
| Phase | Scope | Indicative duration |
|---|---|---|
| **Phase 1 (MVP)** | Auth + RBAC, master data, register, templates + seed library, date engine, instances/workflow, uploads/versioning, reminders (email + in-app + push), escalation, dashboards (Management, Officer, My Work), core reports R1-R7 & R12, audit trail, Excel import | 8-10 weeks |
| **Phase 2** | Checklists, verification maker-checker polish, HOD certificates, CAPA/findings, contractor compliance, assets & QR, Teams/WhatsApp/SMS, scheduled reports, audit pack, legal change tracker, risk exposure | 6-8 weeks |
| **Phase 3** | OCR/AI extraction and assistant, ERP/HRMS integrations, advanced analytics | As prioritised |

### 17.2 Step-by-step prompts (paste in order; verify each step before continuing)
1. *"Scaffold the project with the stack in Section 14: repo structure, Docker Compose (api, web, postgres, redis, minio, worker), environment config, CI. Add health checks."*
2. *"Implement the database schema from Section 10 with migrations and seed data for roles, departments, units, authorities and the seed compliance templates from Section 4."*
3. *"Implement authentication (Entra ID OIDC + local login with TOTP) and server-side RBAC and Unit/Department data scoping exactly as per the matrix in Section 9. Add tests."*
4. *"Implement the date engine and business rules in Section 6 (expiry, renewal due date, internal target date, recurrence, derived status) as a pure, heavily unit-tested module. Include edge cases: month-end, leap year, financial-year anchors, holiday adjustment."*
5. *"Build Compliance Item and Instance CRUD, state machine from Section 8 with transition rules and mandatory fields, comments, checklist, and audit logging with hash chain."*
6. *"Build document upload with versioning, SHA-256, antivirus hook, preview and download; implement the renewal roll-forward on verification."*
7. *"Build the reminder and escalation engine (Section 5.3 and 5.4): daily scheduler at 07:00 IST, idempotent reminder_log, channels email/in-app/push, templates from Section 11, escalation levels, stop/resume rules, failure retry, admin job dashboard."*
8. *"Build the UI: Register grid, Item detail with timeline, Renewal workspace, Templates library and Apply-to-unit wizard, Notification centre."*
9. *"Build dashboards per Section 7 (Management, Officer, My Work) with all KPI cards, charts, RAG, drill-downs, filters and the Compliance Index formula."*
10. *"Build the Reports Hub R1-R12 with filters, Excel/PDF export, monthly renewal calendar and iCal feed, and scheduled weekly management digest."*
11. *"Build Excel import with dry-run validation and the downloadable template from Section 12."*
12. *"Harden: security headers, rate limits, input validation, backup scripts, logs, load test with 10,000 items, accessibility pass, PWA install and push."*
13. *"Write the user guide (by role), admin guide, and a UAT script covering every ID in Section 5 marked M."*

### 17.3 Acceptance criteria (sample, MVP)
- **AC-1:** Creating an item with Issue Date 01-Apr-2026 and Validity 12 months sets Expiry 31-Mar-2027, Renewal Due Date = Expiry − processing days, and schedules reminders at 90/60/30/15/7/3/1 days and on the day.
- **AC-2:** If status remains *Pending* 15 days before the due date, Department Head is notified once (no duplicates on scheduler re-run) and the escalation is visible in the item timeline.
- **AC-3:** Uploading a renewed certificate and approving it in verification closes the instance, archives the old certificate version, sets new expiry and creates the next cycle automatically; reminders for the old cycle stop.
- **AC-4:** A Department User from Electrical cannot see Labour items, and cannot close a Critical item; attempts are logged.
- **AC-5:** Management dashboard counts match the register list exactly for every filter combination; each card drills to the underlying list.
- **AC-6:** Every field edit on an item shows in the audit log with old/new value, user, time and reason; no role can edit or delete audit records.
- **AC-7:** Monthly renewal calendar shows all items due in the selected month and exports to Excel/PDF.
- **AC-8:** Expired items appear in red on the dashboard within 1 minute of the expiry date passing (at midnight IST), and expired-item reminders repeat every 2 days until closed.

### 17.4 UAT and rollout
Pilot with 2 departments (Safety/EHS and HR) in one unit for 4 weeks, load all their current licences, run in parallel with the existing tracker, then roll out to all units and migrate remaining items by Excel import. Train owners by role (1-hour session + quick-reference card). Go-live gate: all Critical items loaded with owners and valid evidence.

---

## 18. Risks and Assumptions

| Risk / Assumption | Mitigation |
|---|---|
| Incomplete or outdated master data at start | Data-collection drive per department with sign-off; import dry-run; Compliance Team verification sprint |
| Statutory rules/frequencies vary by state and are changing (Labour Codes transition) | Template library is editable; Legal Change Tracker; annual applicability review |
| Owners ignore alerts | Escalation matrix, management digest, owner backlog on dashboard, KPI in performance reviews |
| Email deliverability / mobile push limitations | Multiple channels, delivery logging, Admin alert on failure |
| Sensitive defence documents | India-hosted, restricted RBAC, no external sharing, audit of downloads |
| User deactivation leaves orphan items | Mandatory reassignment flag and weekly orphan report |
| **Assumption:** SSO via Microsoft 365 is available; SMTP/Graph mailbox for notifications is provided by IT | Confirm at kickoff |

---

## 19. Open Points for Business Confirmation

1. List of all units/locations and which statutes apply to each (state-wise).
2. Final reminder offsets and escalation matrix per criticality (defaults given above).
3. Does Management View need unit-restricted access or group-wide?
4. Preferred storage: on-prem MinIO or SharePoint/OneDrive?
5. Do we need WhatsApp/SMS in Phase 1?
6. Maker-checker required for all items or only Critical?
7. Existing trackers/Excel to migrate (provide samples).
8. Data residency and approval needed for any cloud component for the defence entity (ITAR/CMMC/DFARS considerations).
9. Named Compliance Team members, department heads and backups for escalation.
10. Penalty/exposure values to be captured per item (yes/no).

---

## 20. Glossary
**CTE/CTO** Consent to Establish/Operate · **SPCB** State Pollution Control Board · **PESO** Petroleum & Explosives Safety Organisation · **DISH** Directorate of Industrial Safety & Health · **NOC** No Objection Certificate · **CAPA** Corrective and Preventive Action · **RAG** Red-Amber-Green · **PWA** Progressive Web App · **RBAC** Role-Based Access Control · **SSO** Single Sign-On · **DGQA** Directorate General of Quality Assurance · **WPS/PQR/WPQ** Welding Procedure Specification / Procedure Qualification Record / Welder Performance Qualification · **ITAR/CMMC/DFARS** US export-control and defence cybersecurity/contract regimes · **DPDP** Digital Personal Data Protection Act, 2023.

*End of document.*
