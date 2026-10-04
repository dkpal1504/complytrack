"""Seed the reference data: units, departments, authorities, categories,
reminder/escalation profiles, email templates and the Section 4 template library.

Idempotent — safe to run on every boot. Existing rows are matched by their
natural key (code / name) and left alone.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.db.types import utcnow
from app.domain.enums import (
    AuthorityLevel,
    Criticality,
    ItemType,
    RecurrenceKind,
    Role,
    UnitType,
    ValidityUnit,
)
from app.models.auth import User
from app.models.compliance import ComplianceTemplate
from app.models.org import (
    Category,
    Department,
    HolidayCalendar,
    IssuingAuthority,
    LegalReference,
    OrganisationUnit,
    Setting,
)
from app.models.reminders import (
    EmailTemplate,
    EscalationProfile,
    EscalationRule,
    ReminderProfile,
)
from app.seed_data.templates import SEED_AUTHORITIES, SEED_CATEGORIES, SEED_TEMPLATES

DEFAULT_PASSWORD = "Comply@2026!"

UNITS = [
    {"code": "YARD", "name": "Main Shipyard", "type": UnitType.YARD,
     "state": "Gujarat", "address": "Marine Yard Road, Gujarat"},
    {"code": "DRYDOCK", "name": "Dry Dock Complex", "type": UnitType.PLANT,
     "state": "Gujarat", "address": "Dry Dock Complex, Gujarat"},
    {"code": "OFFICE", "name": "Corporate Office", "type": UnitType.OFFICE,
     "state": "Gujarat", "address": "Corporate Park, Gujarat"},
    {"code": "PIPAVAV", "name": "Pipavav Unit", "type": UnitType.SUBSIDIARY,
     "state": "Gujarat", "address": "Pipavav, Gujarat"},
]

DEPARTMENTS = [
    ("HR", "Human Resources & Industrial Relations"),
    ("SAFETY", "Safety"),
    ("EHS", "Environment, Health & Safety"),
    ("ELECTRICAL", "Electrical"),
    ("MECHANICAL", "Mechanical & Heavy Lift"),
    ("UTILITIES", "Utilities"),
    ("CIVIL", "Civil & Projects"),
    ("STORES", "Stores & Petroleum"),
    ("QUALITY", "Quality & Welding"),
    ("SECURITY", "Security"),
    ("IT", "Information Technology"),
    ("FINANCE", "Finance & Accounts"),
    ("LEGAL", "Legal & Compliance"),
    ("COMMERCIAL", "Commercial & Customs"),
    ("ADMIN", "Administration"),
    ("TRAINING", "Training & Competency"),
]

# Users seeded so the app is usable and demonstrable immediately.
SEED_USERS = [
    ("Arun Nair", "admin@complytrack.local", Role.ADMIN, "IT", "Critical"),
    ("Priya Menon", "compliance@complytrack.local", Role.COMPLIANCE, "LEGAL", None),
    ("Ravi Deshmukh", "safety.owner@complytrack.local", Role.DEPARTMENT, "SAFETY", None),
    ("Meena Iyer", "hr.owner@complytrack.local", Role.DEPARTMENT, "HR", None),
    ("Sandeep Rao", "ehs.owner@complytrack.local", Role.DEPARTMENT, "EHS", None),
    ("Farhan Qureshi", "electrical.owner@complytrack.local", Role.DEPARTMENT, "ELECTRICAL", None),
    ("Kavita Joshi", "quality.owner@complytrack.local", Role.DEPARTMENT, "QUALITY", None),
    ("Deepak Sharma", "stores.owner@complytrack.local", Role.DEPARTMENT, "STORES", None),
    ("Anita Krishnan", "unit.head@complytrack.local", Role.MANAGEMENT, "ADMIN", None),
    ("Vikram Singh", "ceo@complytrack.local", Role.MANAGEMENT, "ADMIN", None),
    ("Leela Thomas", "auditor@complytrack.local", Role.AUDITOR, "ADMIN", None),
]

EMAIL_TEMPLATES = [
    {
        "code": "reminder_upcoming",
        "name": "Upcoming renewal reminder",
        "subject": "[ACTION] {Criticality} | {Item} ({Unit}) expires in {Days Left} days - due {Expiry Date}",
        "body_html": (
            "<p>{Greeting}</p><p><strong>{Item}</strong> ({Item Code}) at {Unit} — "
            "{Reference No.} issued by {Authority} — expires on <strong>{Expiry Date}</strong>, "
            "so the renewal is due by <strong>{Renewal Due Date}</strong>.</p>"
            "<p>Status: {Status} · Owner: {Owner} · Criticality: {Criticality}</p>"
            "<p>Required documents still pending: {Documents Pending}</p>"
            "<p><a href=\"{Link}\">Open Item</a> · <a href=\"{Link}?action=under_process\">"
            "Mark Under Process</a> · <a href=\"{Link}?action=upload\">Upload Renewal</a></p>"
            "<p>If no action is taken by {Next Escalation Date}, this will be escalated to "
            "{Next Escalation Level}.</p>"
        ),
        "channel": "email",
    },
    {
        "code": "reminder_expired",
        "name": "Expired / overdue alert",
        "subject": "[EXPIRED] {Item} - {Days Overdue} days overdue - Immediate action",
        "body_html": (
            "<p>{Greeting}</p><p style=\"color:#b91c1c\"><strong>{Item}</strong> at {Unit} is "
            "<strong>{Days Overdue} days overdue</strong> (expired {Expiry Date}).</p>"
            "<p>Owner: {Owner} · Authority: {Authority} · Reference: {Reference No.}</p>"
            "<p>Exposure: {Exposure Note}</p><p><a href=\"{Link}\">Open Item</a></p>"
        ),
        "channel": "email",
    },
    {
        "code": "escalation",
        "name": "Escalation notification",
        "subject": "[ESCALATION] {Item} - {Status} - {Days Overdue} days overdue",
        "body_html": (
            "<p>{Greeting}</p><p><strong>{Item}</strong> at {Unit} has escalated to "
            "{Next Escalation Level}.</p><p>Owner: {Owner} · Status: {Status} · "
            "Criticality: {Criticality}</p><p><a href=\"{Link}\">Open Item</a></p>"
        ),
        "channel": "email",
    },
    {
        "code": "weekly_digest",
        "name": "Weekly management digest",
        "subject": "ComplyTrack weekly digest - {Item} portfolio update",
        "body_html": (
            "<p>{Greeting}</p><p>Your weekly compliance digest is attached.</p>"
            "<p><a href=\"{Link}\">Open the dashboard</a></p>"
        ),
        "channel": "email",
    },
    {
        "code": "push_short",
        "name": "Push notification (short)",
        "subject": "{Item} - {Days Left} d left",
        "body_html": "{Item} - {Days Left} d left - tap to update",
        "channel": "push",
    },
]

SETTINGS = [
    ("financial_year_start_month", 4, "Indian financial year starts in April."),
    ("timezone", "Asia/Kolkata", "All display times are IST; storage is UTC."),
    ("reminder_schedule_hour_ist", 7, "Daily reminder job runs at 07:00 IST."),
    ("quiet_hours", {"start": 21, "end": 7}, "Non-critical reminders defer during these hours."),
    ("branding", {"name": "ComplyTrack", "primary": "#1d4ed8",
                  "organisation": "Shipyard & Heavy Engineering"},
     "White-label branding for the UI and e-mails."),
    ("default_lead_time_days", 90, "Default renewal lead time."),
    ("exposure_display", True, "Show penalty exposure figures to Compliance and Management only."),
]


def seed_all(db: Session, *, with_demo_data: bool = True) -> dict:
    stats: dict[str, int] = {}

    stats["units"] = _seed_units(db)
    stats["departments"] = _seed_departments(db)
    stats["authorities"] = _seed_authorities(db)
    stats["categories"] = _seed_categories(db)
    stats["legal_references"] = _seed_legal_references(db)
    stats["reminder_profiles"] = _seed_reminder_profile(db)
    stats["escalation_profiles"] = _seed_escalation_profile(db)
    stats["email_templates"] = _seed_email_templates(db)
    stats["settings"] = _seed_settings(db)
    stats["holidays"] = _seed_holidays(db)
    stats["templates"] = _seed_templates(db)
    if with_demo_data:
        stats["users"] = _seed_users(db)
        from app.db.demo import seed_demo_register

        stats["demo_items"] = seed_demo_register(db)

    db.commit()
    return stats


def _get_or_create(db: Session, model, key_field: str, key_value, defaults: dict):
    row = db.execute(
        select(model).where(getattr(model, key_field) == key_value)
    ).scalar_one_or_none()
    if row is not None:
        return row, False
    row = model(**{key_field: key_value, **defaults})
    db.add(row)
    db.flush()
    return row, True


def _seed_units(db: Session) -> int:
    created = 0
    for unit in UNITS:
        _, made = _get_or_create(db, OrganisationUnit, "code", unit["code"], unit)
        created += int(made)
    return created


def _seed_departments(db: Session) -> int:
    created = 0
    for code, name in DEPARTMENTS:
        _, made = _get_or_create(db, Department, "code", code, {"name": name})
        created += int(made)
    return created


def _seed_authorities(db: Session) -> int:
    created = 0
    for authority in SEED_AUTHORITIES:
        defaults = {
            "level": authority.get("level", AuthorityLevel.STATE),
            "website": authority.get("website") or None,
            "contact": authority.get("contact") or None,
            "default_processing_days": authority.get("default_processing_days", 15),
        }
        _, made = _get_or_create(db, IssuingAuthority, "name", authority["name"], defaults)
        created += int(made)
    return created


def _seed_categories(db: Session) -> int:
    created = 0
    for order, entry in enumerate(SEED_CATEGORIES):
        parent, made = _get_or_create(
            db, Category, "name", entry["name"],
            {"colour": entry.get("colour"), "sort_order": order * 10},
        )
        created += int(made)
        for child_order, child_name in enumerate(entry.get("children", [])):
            existing = db.execute(
                select(Category).where(
                    Category.name == child_name, Category.parent_id == parent.id
                )
            ).scalar_one_or_none()
            if existing is None:
                db.add(Category(name=child_name, parent_id=parent.id,
                                sort_order=child_order, colour=entry.get("colour")))
                db.flush()
                created += 1
    return created


LEGAL_REFERENCES = [
    ("Factories Act, 1948", "Chapter III", "Central",
     "Registration and licensing of factories; superseded in application by the OSH Code."),
    ("Occupational Safety, Health and Working Conditions Code, 2020", "—", "Central",
     "Consolidates factory, dock workers, contract labour and inter-state migrant worker law."),
    ("Code on Wages, 2019", "—", "Central", "Wages, bonus, equal remuneration."),
    ("Industrial Relations Code, 2020", "—", "Central", "Standing orders, retrenchment, grievance."),
    ("Code on Social Security, 2020", "—", "Central", "PF, ESI, gratuity, maternity benefit."),
    ("Water (Prevention and Control of Pollution) Act, 1974", "Sec. 25/26", "Central",
     "Consent to establish and operate."),
    ("Air (Prevention and Control of Pollution) Act, 1981", "Sec. 21", "Central",
     "Consent to operate for emission sources."),
    ("Environment Protection Act, 1986", "—", "Central",
     "Umbrella legislation; EIA notification and waste rules."),
    ("Hazardous and Other Wastes (Management and Transboundary Movement) Rules, 2016",
     "Rule 6 / Form 4", "Central", "Authorisation and annual returns."),
    ("Petroleum Rules, 2002", "—", "Central", "PESO licence for petroleum storage."),
    ("Explosives Rules, 2008", "—", "Central", "Licence for explosives and gas cylinder storage."),
    ("Static and Mobile Pressure Vessels (Unfired) Rules, 2016", "—", "Central",
     "SMPV licence and cylinder hydro-testing."),
    ("Central Electricity Authority (Measures relating to Safety and Electric Supply) Regulations, 2010",
     "—", "Central", "Electrical installation safety and inspection."),
    ("Boilers Act, 1923", "—", "Central", "Boiler registration, inspection and certification."),
    ("Digital Personal Data Protection Act, 2023", "—", "Central",
     "Consent, notice, breach response and data processor obligations."),
    ("Dock Workers (Safety, Health and Welfare) Act, 1986", "—", "Central",
     "Shipyard and dock operations safety."),
    ("Coastal Regulation Zone Notification, 2019", "—", "Central",
     "CRZ clearance and half-yearly compliance reporting."),
    ("Contract Labour (Regulation and Abolition) Act, 1970", "Sec. 7/12", "Central",
     "Principal employer registration and contractor licensing."),
    ("Employees' Provident Funds and Miscellaneous Provisions Act, 1952", "—", "Central",
     "Monthly ECR and challan."),
    ("Employees' State Insurance Act, 1948", "—", "Central", "Monthly contribution and returns."),
    ("Sexual Harassment of Women at Workplace Act, 2013", "Sec. 21", "Central",
     "Internal committee and annual report."),
    ("Legal Metrology Act, 2009", "—", "Central", "Stamping and verification of weighing instruments."),
    ("ISO 9001:2015 / 14001:2015 / 45001:2018 / 27001:2022", "—", "Internal",
     "Management system certification and surveillance."),
]


def _seed_legal_references(db: Session) -> int:
    created = 0
    for act, section, jurisdiction, description in LEGAL_REFERENCES:
        existing = db.execute(
            select(LegalReference).where(
                LegalReference.act_rule_name == act, LegalReference.section == section
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(LegalReference(act_rule_name=act, section=section,
                                  jurisdiction=jurisdiction, description=description))
            created += 1
    db.flush()
    return created


def _seed_reminder_profile(db: Session) -> int:
    _, made = _get_or_create(
        db, ReminderProfile, "name", "Default (90/60/30/15/7/3/1/0)",
        {
            "offsets": [90, 60, 30, 15, 7, 3, 1, 0],
            "channels": ["email", "in_app", "push"],
            "recipients_by_offset": {
                "90": ["owner", "delegate"],
                "60": ["owner", "delegate", "compliance"],
                "30": ["owner", "delegate", "compliance"],
                "15": ["owner", "delegate", "department_head", "compliance"],
                "7": ["owner", "delegate", "department_head", "unit_head", "compliance"],
                "3": ["owner", "delegate", "department_head", "unit_head", "compliance"],
                "1": ["owner", "delegate", "department_head", "unit_head", "compliance", "management"],
                "0": ["owner", "delegate", "department_head", "unit_head", "compliance", "management"],
            },
            "post_expiry_frequency_days": 2,
            "anchor_on": "renewal_due_date",
            "is_default": True,
        },
    )
    _get_or_create(
        db, ReminderProfile, "name", "Critical (accelerated)",
        {
            "offsets": [120, 90, 60, 45, 30, 15, 7, 3, 1, 0],
            "channels": ["email", "in_app", "push"],
            "recipients_by_offset": {
                "15": ["owner", "delegate", "department_head", "unit_head", "compliance", "management"],
            },
            "post_expiry_frequency_days": 1,
            "anchor_on": "renewal_due_date",
            "quiet_hours_exempt": True,
        },
    )
    _get_or_create(
        db, ReminderProfile, "name", "Monthly filing (short lead)",
        {
            "offsets": [15, 7, 3, 1, 0],
            "channels": ["email", "in_app"],
            "recipients_by_offset": {
                "7": ["owner", "delegate", "department_head"],
                "0": ["owner", "delegate", "department_head", "compliance"],
            },
            "post_expiry_frequency_days": 2,
            "anchor_on": "statutory_due",
        },
    )
    return int(made)


ESCALATION_RULES = [
    (0, 90, "before", [], ["owner"], ["email", "in_app"]),
    (1, 15, "before", ["Pending"], ["owner", "department_head"], ["email", "in_app"]),
    (2, 7, "before", ["Pending", "Query Raised"],
     ["owner", "department_head", "unit_head", "compliance"], ["email", "in_app", "push"]),
    (3, 0, "after", [], ["unit_head", "plant_head", "management"], ["email", "in_app"]),
    (4, 7, "after", [], ["plant_head", "management", "director"], ["email", "in_app"]),
]


def _seed_escalation_profile(db: Session) -> int:
    profile, made = _get_or_create(
        db, EscalationProfile, "name", "Default escalation matrix",
        {"is_default": True, "criticality": None},
    )
    for level, days, direction, condition, roles, channels in ESCALATION_RULES:
        existing = db.execute(
            select(EscalationRule).where(
                EscalationRule.profile_id == profile.id, EscalationRule.level == level
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(EscalationRule(
                profile_id=profile.id, level=level, trigger_days=days,
                trigger_direction=direction, status_condition=condition,
                notify_roles=roles, channels=channels,
            ))
    db.flush()
    return int(made)


def _seed_email_templates(db: Session) -> int:
    created = 0
    for entry in EMAIL_TEMPLATES:
        _, made = _get_or_create(
            db, EmailTemplate, "code", entry["code"],
            {k: v for k, v in entry.items() if k != "code"},
        )
        created += int(made)
    return created


def _seed_settings(db: Session) -> int:
    created = 0
    for key, value, description in SETTINGS:
        _, made = _get_or_create(
            db, Setting, "key", key, {"value": value, "description": description}
        )
        created += int(made)
    return created


def _seed_holidays(db: Session) -> int:
    """A starter national holiday list; the Admin extends it per state."""
    entries = [
        ("2026-01-26", "Republic Day"), ("2026-03-04", "Holi"),
        ("2026-05-01", "Maharashtra Day / Labour Day"), ("2026-08-15", "Independence Day"),
        ("2026-10-02", "Gandhi Jayanti"), ("2026-10-20", "Dussehra"),
        ("2026-11-08", "Diwali"), ("2026-12-25", "Christmas"),
        ("2027-01-26", "Republic Day"), ("2027-03-22", "Holi"),
        ("2027-05-01", "Maharashtra Day / Labour Day"), ("2027-08-15", "Independence Day"),
        ("2027-10-02", "Gandhi Jayanti"), ("2027-12-25", "Christmas"),
    ]
    from datetime import date

    created = 0
    for iso, name in entries:
        parsed = date.fromisoformat(iso)
        existing = db.execute(
            select(HolidayCalendar).where(
                HolidayCalendar.date == parsed, HolidayCalendar.state == "ALL"
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(HolidayCalendar(state="ALL", date=parsed, name=name))
            created += 1
    db.flush()
    return created


def _seed_templates(db: Session) -> int:
    """Load the Section 4 shipyard register as an importable template library."""
    units = {u.code: u for u in db.execute(select(OrganisationUnit)).scalars()}
    departments = {d.code: d for d in db.execute(select(Department)).scalars()}
    authorities = {a.name: a for a in db.execute(select(IssuingAuthority)).scalars()}
    categories = {c.name: c for c in db.execute(select(Category)).scalars()}
    reminder, _ = _get_or_create(
        db, ReminderProfile, "name", "Default (90/60/30/15/7/3/1/0)", {}
    )
    escalation, _ = _get_or_create(
        db, EscalationProfile, "name", "Default escalation matrix", {}
    )

    created = 0
    for entry in SEED_TEMPLATES:
        existing = db.execute(
            select(ComplianceTemplate).where(ComplianceTemplate.code == entry["code"])
        ).scalar_one_or_none()
        if existing is not None:
            continue

        parent = categories.get(entry.get("category") or "")
        sub = None
        if parent is not None and entry.get("sub_category"):
            sub = db.execute(
                select(Category).where(
                    Category.name == entry["sub_category"], Category.parent_id == parent.id
                )
            ).scalar_one_or_none()
            if sub is None:
                sub = Category(name=entry["sub_category"], parent_id=parent.id)
                db.add(sub)
                db.flush()
                categories[entry["sub_category"]] = sub

        authority = authorities.get(entry.get("authority") or "")
        department = departments.get(entry.get("owner_department_code") or "")

        db.add(ComplianceTemplate(
            code=entry["code"],
            name=entry["name"],
            category_id=parent.id if parent else None,
            sub_category_id=sub.id if sub else None,
            type=entry.get("type", ItemType.LICENCE.value),
            authority_id=authority.id if authority else None,
            default_validity_value=entry.get("default_validity_value"),
            default_validity_unit=entry.get("default_validity_unit", ValidityUnit.MONTHS.value),
            recurrence_rule=entry.get("recurrence_rule", RecurrenceKind.ANNUAL.value),
            recurrence_day=entry.get("recurrence_day"),
            recurrence_interval_months=entry.get("recurrence_interval_months"),
            lead_time_days=entry.get("lead_time_days", 90),
            authority_processing_days=entry.get("authority_processing_days", 15),
            internal_prep_days=entry.get("internal_prep_days", 15),
            default_owner_dept_id=department.id if department else None,
            criticality=entry.get("criticality", Criticality.MEDIUM.value),
            required_documents=list(entry.get("required_documents") or []),
            reminder_profile_id=reminder.id,
            escalation_profile_id=escalation.id,
            allow_direct_close=bool(entry.get("allow_direct_close")),
            anchor_on=entry.get("anchor_on", "renewal_due_date"),
            applicability_notes=entry.get("applicability_notes"),
            legal_reference_text=entry.get("legal_reference_text"),
            is_seed=True,
        ))
        created += 1
    db.flush()
    return created


def _seed_users(db: Session) -> int:
    departments = {d.code: d for d in db.execute(select(Department)).scalars()}
    units = {u.code: u for u in db.execute(select(OrganisationUnit)).scalars()}
    yard = units.get("YARD")

    created = 0
    for name, email, role, dept_code, _marker in SEED_USERS:
        existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if existing is not None:
            continue
        department = departments.get(dept_code)
        user = User(
            name=name,
            email=email,
            role=role,
            department_id=department.id if department else None,
            unit_ids=[yard.id] if yard else [],
            status="Active",
            password_hash=hash_password(DEFAULT_PASSWORD),
            mobile=f"+91-98{abs(hash(email)) % 100000000:08d}",
            employee_id=f"EMP{abs(hash(email)) % 10000:04d}",
        )
        db.add(user)
        db.flush()
        created += 1

        # Nominate the first Department User of each department as its head, so
        # the escalation ladder has someone to escalate to out of the box.
        if role == Role.DEPARTMENT and department is not None and department.head_user_id is None:
            department.head_user_id = user.id
            db.add(department)

    db.flush()
    return created


def reset_demo_data(db: Session) -> dict:
    """Wipe business data but keep master data — used by the demo/test harness."""
    from app.models.compliance import Comment, ComplianceInstance, ComplianceItem, InstanceChecklist
    from app.models.documents import Document
    from app.models.reminders import EscalationLog, Notification, ReminderLog

    counts = {}
    for model in (ReminderLog, EscalationLog, InstanceChecklist, Comment, Document,
                  Notification, ComplianceInstance, ComplianceItem):
        rows = db.execute(select(model)).scalars().all()
        counts[model.__tablename__] = len(rows)
        for row in rows:
            db.delete(row)
    db.commit()
    return counts
