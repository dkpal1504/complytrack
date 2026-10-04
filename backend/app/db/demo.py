"""Deterministic demo register for a fresh install.

Instantiated from the seeded template library so a new deployment immediately
has a register, dashboards, reminders and escalations to look at. There is no
randomness anywhere: the same build always produces the same demo data, which
keeps the end-to-end tests stable.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.types import utcnow
from app.domain.dates import IST, ist_today
from app.domain.enums import Applicability, ChecklistStatus, ItemStatus
from app.models.compliance import (
    ComplianceInstance,
    ComplianceItem,
    ComplianceTemplate,
    InstanceChecklist,
)
from app.models.org import Department, OrganisationUnit

# Twenty-cycle status rotation, repeated across the register. Weighted so a
# fresh install opens on a plausible mid-year picture: half the obligations
# already renewed, a working backlog, and a visible problem set.
STATUS_CYCLE: tuple[str, ...] = (
    ItemStatus.CLOSED.value, ItemStatus.PENDING.value, ItemStatus.CLOSED.value,
    ItemStatus.PENDING.value, ItemStatus.CLOSED.value, ItemStatus.UNDER_PROCESS.value,
    ItemStatus.CLOSED.value, ItemStatus.PENDING.value, ItemStatus.CLOSED.value,
    ItemStatus.SUBMITTED.value, ItemStatus.CLOSED.value, ItemStatus.PENDING.value,
    ItemStatus.CLOSED.value, ItemStatus.UNDER_PROCESS.value, ItemStatus.CLOSED.value,
    ItemStatus.PENDING.value, ItemStatus.CLOSED.value, ItemStatus.QUERY_RAISED.value,
    ItemStatus.CLOSED.value, ItemStatus.PENDING.value,
)

# Days from today to expiry, rotated across the register: a long body of
# comfortable items, a cluster due soon, and a handful already overdue.
EXPIRY_SPREAD: tuple[int, ...] = (
    365, 300, 265, 240, 200, 180, 150, 120, 95, 76,
    60, 48, 34, 27, 18, 11, 4, 0, -12, -60,
)

# Where each category's obligations physically live.
UNIT_BY_CATEGORY: dict[str, str] = {
    "Factory, Safety & Occupational Health": "YARD",
    "Labour & Employment": "YARD",
    "Environmental": "YARD",
    "Explosives, Petroleum, Gases, Electrical & Fire": "DRYDOCK",
    "Maritime, Port, Customs, Legal Metrology & Statutory Registration": "PIPAVAV",
    "Defence, Quality, Class & Information Security": "OFFICE",
    "Information Security & Governance": "OFFICE",
}


def _ist_midnight(day: date) -> datetime:
    """A submission stamp for demo data, at that day's IST midnight."""
    return datetime.combine(day, time.min, tzinfo=IST).astimezone(timezone.utc)


# How each cycle state has got on with its documents (DS-01). A fresh install
# should show all three states the checklist offers — Received, Pending and Not
# Required — on the obligations that would really be in that position: a closed
# cycle has everything on file, work in progress has a straggler, and a pending
# cycle has not started.
CHECKLIST_STATE: dict[str, str] = {
    ItemStatus.CLOSED.value: "all_received",
    ItemStatus.SUBMITTED.value: "all_received",
    ItemStatus.UNDER_PROCESS.value: "nearly_done",
    ItemStatus.QUERY_RAISED.value: "started",
    ItemStatus.ON_HOLD.value: "half",
    ItemStatus.PENDING.value: "none",
}

# Notes on a fresh install, so the field the checklist screen offers is not
# empty everywhere. One on the line the template does not ask for this time —
# a note saying *why* a line is not required is what the field is really for —
# and one on the first line that was dealt with, naming the paper trail.
NOT_REQUIRED_NOTE = "Not required this cycle - the authority has not asked for it again."
CHECKLIST_NOTE = "Original seen; photocopy filed with the EHS officer."


def _fallback_receiver(db: Session) -> str | None:
    """Who to name as the receiver when an item has no owner.

    The Compliance Team is the desk that holds the originals for the yard, so
    it is the honest answer for the departments that have no head nominated in
    the seed data. Returns ``None`` only if even that account is missing, in
    which case the checklist records the date alone.
    """
    from app.models.auth import User

    return db.execute(
        select(User.id).where(
            User.email == "compliance@complytrack.local",
            User.is_deleted.is_(False),
        )
    ).scalar_one_or_none()


def _seed_checklist(
    db: Session,
    *,
    instance: ComplianceInstance,
    item: ComplianceItem,
    anchor: date,
    fallback_receiver: str | None,
) -> int:
    """Materialise a cycle's required-documents checklist from its item.

    The checklist is what the renewal workflow is actually worked through, and
    the progress meter on the cycle reads from it. Instances created here used
    to skip it, so a fresh install had an empty Checklist tab on every
    obligation and a progress meter with nothing to count.

    Deterministic, like the rest of this seed: the state comes from the cycle's
    own status rather than from a random draw.
    """
    documents = list(item.required_documents or [])
    if not documents:
        return 0

    how = CHECKLIST_STATE.get(instance.status, "none")
    received_count = {
        "all_received": len(documents),
        "nearly_done": max(len(documents) - 1, 0),
        "started": min(2, len(documents)),
        "half": len(documents) // 2,
        "none": 0,
    }[how]

    created = 0
    for order, name in enumerate(documents):
        status = (
            ChecklistStatus.RECEIVED.value
            if order < received_count
            else ChecklistStatus.PENDING.value
        )
        # "Not Required" only on a cycle that is genuinely mid-flight: one
        # demonstration of each state is enough for a fresh install.
        if how == "nearly_done" and order == len(documents) - 1:
            status = ChecklistStatus.NOT_REQUIRED.value

        line = InstanceChecklist(
            instance_id=instance.id,
            item_name=name,
            status=status,
            sort_order=order,
        )
        if status == ChecklistStatus.RECEIVED.value:
            line.received_at = _ist_midnight(anchor - timedelta(days=45 + order * 9))
            # "Who received it" is half of what the PRD's line records. Not
            # every department has a head to name, so an item without an owner
            # falls back to the Compliance Team rather than leaving the pair
            # half-filled with a date and nobody's name against it.
            line.received_by = item.owner_id or fallback_receiver
            # The note describes paper on file, so it belongs to a line that
            # was actually dealt with — a line still pending has nothing to
            # say about it yet.
            if order == 0:
                line.notes = CHECKLIST_NOTE
        elif status == ChecklistStatus.NOT_REQUIRED.value:
            line.notes = NOT_REQUIRED_NOTE
        db.add(line)
        created += 1
    return created


def seed_demo_register(db: Session) -> int:
    """Create one item per template, with a realistic spread of cycle states."""
    today = ist_today()
    units = {u.code: u for u in db.execute(select(OrganisationUnit)).scalars()}
    if not units:
        return 0

    templates = list(
        db.execute(
            select(ComplianceTemplate)
            .where(ComplianceTemplate.is_deleted.is_(False))
            .order_by(ComplianceTemplate.code)
        ).scalars()
    )
    if not templates:
        return 0

    default_unit = units.get("YARD") or next(iter(units.values()))
    fallback_receiver = _fallback_receiver(db)
    created = 0

    for index, template in enumerate(templates):
        already = db.execute(
            select(ComplianceItem).where(
                ComplianceItem.template_id == template.id,
                ComplianceItem.is_deleted.is_(False),
            )
        ).scalars().first()
        if already is not None:
            continue

        status = STATUS_CYCLE[index % len(STATUS_CYCLE)]
        spread = EXPIRY_SPREAD[index % len(EXPIRY_SPREAD)]

        # Resolve unit by category name, then fall back to the default unit.
        category_name = ""
        if template.category_id:
            from app.models.org import Category

            category = db.get(Category, template.category_id)
            category_name = category.name if category else ""
        unit = units.get(UNIT_BY_CATEGORY.get(category_name, ""), default_unit)

        department = (
            db.get(Department, template.default_owner_dept_id)
            if template.default_owner_dept_id
            else None
        )

        if status == ItemStatus.CLOSED.value:
            # Already renewed, so the next expiry is comfortably ahead.
            offset = abs(spread) + 120
        elif status in (
            ItemStatus.UNDER_PROCESS.value, ItemStatus.SUBMITTED.value,
            ItemStatus.QUERY_RAISED.value,
        ):
            # In-flight work is concentrated around the deadline, so some of it
            # is already late - exactly the case the escalation ladder exists for.
            offset = min(spread, 20)
        else:
            offset = spread

        expiry = today + timedelta(days=offset)
        issue = today - timedelta(days=365 + (index * 7) % 210)
        processing_days = template.authority_processing_days or 0
        prep_days = template.internal_prep_days or 0

        item = ComplianceItem(
            template_id=template.id,
            item_code=f"{template.code}-{unit.code}",
            name=f"{template.name} - {unit.name}",
            description=template.applicability_notes,
            category_id=template.category_id,
            sub_category_id=template.sub_category_id,
            type=template.type,
            legal_reference_text=template.legal_reference_text,
            unit_id=unit.id,
            department_id=department.id if department else None,
            owner_id=department.head_user_id if department else None,
            authority_id=template.authority_id,
            reference_number=f"{unit.code}/{template.code}/{issue.year}",
            issue_date=issue,
            expiry_date=expiry,
            validity_value=template.default_validity_value,
            validity_unit=template.default_validity_unit,
            renewal_due_date=expiry - timedelta(days=processing_days),
            internal_target_date=expiry - timedelta(days=processing_days + prep_days),
            recurrence_rule=template.recurrence_rule,
            recurrence_day=template.recurrence_day,
            recurrence_interval_months=template.recurrence_interval_months,
            lead_time_days=template.lead_time_days,
            authority_processing_days=template.authority_processing_days,
            internal_prep_days=template.internal_prep_days,
            criticality=template.criticality,
            applicability=Applicability.APPLICABLE.value,
            required_documents=list(template.required_documents or []),
            reminder_profile_id=template.reminder_profile_id,
            escalation_profile_id=template.escalation_profile_id,
            allow_direct_close=template.allow_direct_close,
            anchor_on=template.anchor_on,
            fee_amount=(2500 + index * 137) if template.type != "Filing" else None,
            penalty_per_day=(
                float(5000 + index * 250)
                if template.criticality in ("Critical", "High") else None
            ),
            exposure_note=(
                "Statutory penalty exposure if this obligation lapses."
                if template.criticality == "Critical" else None
            ),
            tags=["seed", template.code.split("-")[0].lower()],
        )
        db.add(item)
        db.flush()

        instance = ComplianceInstance(
            item_id=item.id,
            cycle_label=f"FY{issue.year}-{str(issue.year + 1)[-2:]}",
            due_date=item.renewal_due_date or expiry,
            period_start=issue,
            period_end=expiry,
            status=status,
            escalation_level=0,
        )
        if status == ItemStatus.CLOSED.value:
            instance.submitted_at = _ist_midnight(expiry - timedelta(days=30))
            instance.acknowledgement_no = f"ACK/{template.code}/{expiry.year}"
            instance.new_issue_date = expiry - timedelta(days=25)
            instance.new_expiry_date = expiry
            instance.new_reference_number = f"{unit.code}/{template.code}/{expiry.year}"
            instance.verification_status = "Approved"
            instance.verification_remark = "Renewed and verified during seeding."
            instance.verified_at = utcnow()
            instance.closed_at = utcnow()
        elif status == ItemStatus.SUBMITTED.value:
            instance.submitted_at = _ist_midnight(expiry - timedelta(days=5))
            instance.acknowledgement_no = f"PENDING/{template.code}"
        elif status == ItemStatus.UNDER_PROCESS.value:
            instance.expected_filing_date = expiry - timedelta(days=10)
        elif status == ItemStatus.ON_HOLD.value:
            instance.on_hold_reason = "Awaiting a joint inspection slot with the authority."
        elif status == ItemStatus.QUERY_RAISED.value:
            instance.on_hold_reason = "Authority raised a query on the fee challan."

        db.add(instance)
        db.flush()
        created += 1

        # The working parts of that cycle: what still has to be gathered.
        _seed_checklist(
            db,
            instance=instance,
            item=item,
            # Documents are gathered before the deadline, and a cycle that has
            # already closed was worked before today.
            anchor=min(expiry, today),
            fallback_receiver=fallback_receiver,
        )

    db.flush()
    return created
