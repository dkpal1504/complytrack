"""Compliance item lifecycle: create, update, archive, list, derive status."""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.rbac import Scope
from app.db.types import utcnow
from app.domain import status as status_rules
from app.domain.dates import compute_dates, ist_today
from app.domain.enums import (
    Applicability,
    ItemStatus,
    ItemType,
    RecurrenceKind,
    ValidityUnit,
)
from app.domain.recurrence import cycle_label, period_for
from app.models.compliance import ComplianceInstance, ComplianceItem, InstanceChecklist
from app.models.org import Category, Department, IssuingAuthority, OrganisationUnit
from app.models.auth import User
from app.schemas.compliance import ItemCreate, ItemUpdate
from app.services import audit
from app.services.queries import apply_item_scope, current_instance, open_instance_count

AUDITED_FIELDS = tuple(ItemUpdate.model_fields.keys())


class DuplicateItemError(ValueError):
    def __init__(self, existing: ComplianceItem) -> None:
        super().__init__(
            f"An item already exists for this unit and authority with reference "
            f"'{existing.reference_number}' ({existing.item_code} - {existing.name})."
        )
        self.existing = existing


class ValidationError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__(" ".join(errors))
        self.errors = errors


def next_item_code(db: Session, category: Category | None) -> str:
    """Sequential, human-readable code, e.g. FAC-0007."""
    prefix = "CMP"
    if category and category.name:
        letters = re.sub(r"[^A-Za-z]", "", category.name).upper()[:3]
        prefix = letters or "CMP"
    count = db.execute(select(func.count(ComplianceItem.id))).scalar_one()
    return f"{prefix}-{count + 1:04d}"


def validate_item(payload: ItemCreate | dict, *, existing: ComplianceItem | None = None) -> list[str]:
    """CD-03 mandatory-field validation, by item type."""
    get = payload.get if isinstance(payload, dict) else lambda k, d=None: getattr(payload, k, d)
    errors: list[str] = []

    if not (get("name") or "").strip():
        errors.append("Item name is required.")
    if not get("unit_id"):
        errors.append("Unit / Location is required.")
    if not get("owner_id"):
        errors.append("A named owner is required for every obligation.")

    item_type = get("type") or ItemType.LICENCE
    applicability = get("applicability") or Applicability.APPLICABLE

    if item_type in (ItemType.LICENCE, ItemType.CERTIFICATE) and applicability == Applicability.APPLICABLE:
        if not get("issue_date") and not get("expiry_date"):
            errors.append("A licence or certificate needs an issue date or an expiry date.")
        if not get("validity_value") and not get("expiry_date") and not get("is_perpetual"):
            errors.append("Provide a validity period or an explicit expiry date.")

    if item_type == ItemType.FILING and not get("recurrence_rule"):
        errors.append("A periodic filing needs a recurrence rule.")

    if (get("validity_unit") or "") == ValidityUnit.NONE and not get("is_perpetual"):
        errors.append('Validity unit "no expiry" requires the Perpetual flag to be set.')

    if applicability == Applicability.NOT_APPLICABLE and not get("applicability_justification"):
        errors.append("A justification is mandatory when marking an item Not Applicable.")

    return errors


def find_duplicate(
    db: Session, *, unit_id: str | None, authority_id: str | None,
    reference_number: str | None, exclude_id: str | None = None,
) -> ComplianceItem | None:
    """Duplicate detection on unit + authority + reference number (CD-03)."""
    if not (unit_id and reference_number):
        return None
    stmt = select(ComplianceItem).where(
        ComplianceItem.is_deleted.is_(False),
        ComplianceItem.unit_id == unit_id,
        ComplianceItem.reference_number == reference_number,
    )
    if authority_id:
        stmt = stmt.where(ComplianceItem.authority_id == authority_id)
    if exclude_id:
        stmt = stmt.where(ComplianceItem.id != exclude_id)
    return db.execute(stmt.limit(1)).scalar_one_or_none()


def recalculate_dates(item: ComplianceItem, *, fy_start_month: int = 4) -> None:
    """RT-01/RT-02: keep expiry, renewal-due and internal-target in step."""
    computed = compute_dates(
        issue_date=item.issue_date,
        validity_value=item.validity_value,
        validity_unit=item.validity_unit,
        authority_processing_days=item.authority_processing_days or 0,
        internal_prep_days=item.internal_prep_days or 0,
        explicit_expiry=item.expiry_date,
        fy_start_month=fy_start_month,
    )
    item.expiry_date = computed["expiry_date"]
    item.renewal_due_date = computed["renewal_due_date"]
    item.internal_target_date = computed["internal_target_date"]

    # A closed/renewed cycle supplies the authoritative new expiry; don't
    # overwrite it with an arithmetic guess.
    for instance in item.instances or []:
        if instance.status == ItemStatus.CLOSED and instance.new_expiry_date:
            item.expiry_date = instance.new_expiry_date


def create_item(
    db: Session,
    payload: ItemCreate,
    *,
    actor: User,
    ctx: dict,
    scope: Scope,
    fy_start_month: int = 4,
) -> ComplianceItem:
    errors = validate_item(payload)
    if errors:
        raise ValidationError(errors)

    if not scope.all_units and payload.unit_id not in scope.unit_ids:
        raise PermissionError("You cannot create items for a unit outside your scope.")
    if not scope.all_departments and payload.department_id not in (None, scope.department_id):
        raise PermissionError("You cannot create items for another department.")

    duplicate = find_duplicate(
        db,
        unit_id=payload.unit_id,
        authority_id=payload.authority_id,
        reference_number=payload.reference_number,
    )
    if duplicate and not payload.ignore_duplicate_check:
        raise DuplicateItemError(duplicate)

    category = db.get(Category, payload.category_id) if payload.category_id else None
    data = payload.model_dump(exclude={"create_first_instance", "ignore_duplicate_check"})
    data.pop("reason", None)

    item = ComplianceItem(**data)
    item.item_code = payload.item_code or next_item_code(db, category)
    item.created_by = actor.id
    item.updated_by = actor.id
    recalculate_dates(item, fy_start_month=fy_start_month)

    db.add(item)
    db.flush()

    if payload.create_first_instance:
        create_first_instance(db, item)

    audit.write_audit(
        db,
        entity_type="compliance_item",
        entity_id=item.id,
        action="create",
        changes={"created": {"name": item.name, "code": item.item_code}},
        reason=None,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(item)
    return item


def create_first_instance(db: Session, item: ComplianceItem, *, fy_start_month: int = 4) -> ComplianceInstance:
    """Open cycle 1 for a newly created item."""
    rule = item.recurrence_rule or RecurrenceKind.ANNUAL
    due = item.expiry_date or item.renewal_due_date or item.issue_date
    label = cycle_label(rule, due, fy_start_month=fy_start_month) if due else "Current"
    start, end = period_for(rule, due, fy_start_month=fy_start_month) if due else (None, None)

    instance = ComplianceInstance(
        item_id=item.id,
        cycle_label=label,
        due_date=due,
        period_start=start,
        period_end=end,
        status=ItemStatus.NOT_APPLICABLE
        if item.applicability == Applicability.NOT_APPLICABLE
        else ItemStatus.PENDING,
        status_changed_at=utcnow(),
        verification_status="Not Submitted",
    )
    db.add(instance)
    db.flush()

    for index, doc_name in enumerate(item.required_documents or []):
        db.add(
            InstanceChecklist(
                instance_id=instance.id, item_name=doc_name, status="Pending", sort_order=index
            )
        )
    return instance


def update_item(
    db: Session,
    item: ComplianceItem,
    payload: ItemUpdate,
    *,
    actor: User,
    ctx: dict,
    scope: Scope,
    fy_start_month: int = 4,
) -> ComplianceItem:
    if not scope.all_units and item.unit_id not in scope.unit_ids:
        raise PermissionError("This item is outside your unit scope.")
    if not scope.all_departments and item.department_id != scope.department_id:
        raise PermissionError("This item belongs to another department.")

    changes = payload.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None) or None

    # AT-04: date, owner and applicability edits require a stated reason.
    sensitive = {"issue_date", "expiry_date", "validity_value", "validity_unit",
                 "owner_id", "delegate_id", "applicability", "criticality",
                 "authority_processing_days", "internal_prep_days"}
    touched_sensitive = sensitive & set(changes)
    if touched_sensitive and not reason:
        raise ValidationError(
            ["A reason is mandatory when changing "
             + ", ".join(sorted(f.replace("_", " ") for f in touched_sensitive)) + "."]
        )

    before = {field: getattr(item, field, None) for field in changes}
    for field, value in changes.items():
        setattr(item, field, value)
    item.updated_by = actor.id

    if "validity_unit" in changes and item.validity_unit == ValidityUnit.NONE:
        item.is_perpetual = True

    recalculate_dates(item, fy_start_month=fy_start_month)

    diff = audit.diff_entity(
        {k: _plain(v) for k, v in before.items()},
        {k: _plain(getattr(item, k, None)) for k in changes},
    )
    # Expiry/renewal dates are recomputed, so record those too.
    after_dates = {
        "expiry_date": _plain(item.expiry_date),
        "renewal_due_date": _plain(item.renewal_due_date),
        "internal_target_date": _plain(item.internal_target_date),
    }

    if diff or after_dates:
        audit.write_audit(
            db,
            entity_type="compliance_item",
            entity_id=item.id,
            action="update",
            changes={**diff, **{k: {"new": v} for k, v in after_dates.items()}},
            reason=reason,
            **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
        )

    db.commit()
    db.refresh(item)
    return item


def archive_item(
    db: Session, item: ComplianceItem, *, reason: str, actor: User, ctx: dict
) -> ComplianceItem:
    item.is_deleted = True
    item.deleted_at = utcnow()
    item.deleted_by = actor.id
    item.delete_reason = reason
    item.updated_by = actor.id
    db.add(item)

    audit.write_audit(
        db,
        entity_type="compliance_item",
        entity_id=item.id,
        action="archive",
        old_value={"is_deleted": False},
        new_value={"is_deleted": True},
        reason=reason,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(item)
    return item


def restore_item(db: Session, item: ComplianceItem, *, reason: str, actor: User, ctx: dict) -> ComplianceItem:
    item.is_deleted = False
    item.deleted_at = None
    item.deleted_by = None
    item.delete_reason = None
    item.updated_by = actor.id
    db.add(item)
    audit.write_audit(
        db,
        entity_type="compliance_item",
        entity_id=item.id,
        action="restore",
        reason=reason,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(item)
    return item


def bulk_reassign(
    db: Session, items: list[ComplianceItem], *, owner_id: str | None, delegate_id: str | None,
    department_id: str | None, reason: str, actor: User, ctx: dict,
) -> int:
    for item in items:
        before = {"owner_id": item.owner_id, "delegate_id": item.delegate_id,
                  "department_id": item.department_id}
        if owner_id is not None:
            item.owner_id = owner_id
        if delegate_id is not None:
            item.delegate_id = delegate_id
        if department_id is not None:
            item.department_id = department_id
        item.updated_by = actor.id
        db.add(item)
        audit.write_audit(
            db,
            entity_type="compliance_item",
            entity_id=item.id,
            action="reassign",
            changes=audit.diff_entity(
                before,
                {"owner_id": item.owner_id, "delegate_id": item.delegate_id,
                 "department_id": item.department_id},
            ),
            reason=reason,
            **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
        )
    db.commit()
    return len(items)


def bulk_edit(
    db: Session, items: list[ComplianceItem], *, set_criticality: str | None,
    set_department_id: str | None, set_owner_id: str | None, set_tags: list[str] | None,
    add_tags: list[str] | None, reason: str, actor: User, ctx: dict,
) -> int:
    for item in items:
        before = {"criticality": item.criticality, "department_id": item.department_id,
                  "owner_id": item.owner_id, "tags": list(item.tags or [])}
        if set_criticality:
            item.criticality = set_criticality
        if set_department_id:
            item.department_id = set_department_id
        if set_owner_id:
            item.owner_id = set_owner_id
        if set_tags is not None:
            item.tags = set_tags
        if add_tags:
            item.tags = sorted(set(item.tags or []) | set(add_tags))
        item.updated_by = actor.id
        db.add(item)
        audit.write_audit(
            db, entity_type="compliance_item", entity_id=item.id, action="bulk_edit",
            changes=audit.diff_entity(before, {
                "criticality": item.criticality, "department_id": item.department_id,
                "owner_id": item.owner_id, "tags": list(item.tags or [])}),
            reason=reason,
            **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
        )
    db.commit()
    return len(items)


def item_status_input(item: ComplianceItem, instance: ComplianceInstance | None) -> status_rules.StatusInput:
    """Fold the item and its open cycle into the pure status rule input."""
    today_relevant_due = None
    if instance is not None:
        today_relevant_due = instance.due_date

    return status_rules.StatusInput(
        workflow_status=instance.status if instance else ItemStatus.PENDING,
        applicability=item.applicability,
        expiry_date=item.expiry_date,
        renewal_due_date=item.renewal_due_date,
        internal_target_date=item.internal_target_date,
        due_date=today_relevant_due,
        is_perpetual=item.is_perpetual,
        renewal_in_process=bool(instance.renewal_in_process) if instance else False,
        reminder_window_days=item.lead_time_days or 90,
    )


def serialise_item(
    db: Session,
    item: ComplianceItem,
    *,
    today: date | None = None,
    maps: dict | None = None,
    instance: ComplianceInstance | None = None,
    with_instances: bool = True,
) -> dict:
    today = today or ist_today()
    maps = maps or {}

    def name_of(kind: str, key: str | None) -> str | None:
        if not key:
            return None
        return maps.get(kind, {}).get(key)

    if with_instances:
        inst = instance if instance is not None else current_instance(db, item.id)
        open_count = open_instance_count(db, item.id)
    else:
        inst, open_count = None, 0

    state = item_status_input(item, inst)
    derived = status_rules.derive_status(state, today)
    bucket = status_rules.compliance_bucket(state, today)
    rag = status_rules.rag_colour(state, today)

    return {
        "id": item.id,
        "item_code": item.item_code,
        "name": item.name,
        "description": item.description,
        "type": item.type,
        "category_id": item.category_id,
        "category_name": name_of("category", item.category_id),
        "unit_id": item.unit_id,
        "unit_name": name_of("unit", item.unit_id),
        "department_id": item.department_id,
        "department_name": name_of("department", item.department_id),
        "owner_id": item.owner_id,
        "owner_name": name_of("user", item.owner_id),
        "delegate_id": item.delegate_id,
        "authority_id": item.authority_id,
        "authority_name": name_of("authority", item.authority_id),
        "reference_number": item.reference_number,
        "issue_date": item.issue_date,
        "expiry_date": item.expiry_date,
        "renewal_due_date": item.renewal_due_date,
        "internal_target_date": item.internal_target_date,
        "validity_value": item.validity_value,
        "validity_unit": item.validity_unit,
        "criticality": item.criticality,
        "applicability": item.applicability,
        "recurrence_rule": item.recurrence_rule,
        "fee_amount": float(item.fee_amount) if item.fee_amount is not None else None,
        "is_perpetual": item.is_perpetual,
        "tags": item.tags or [],
        "required_documents": item.required_documents or [],
        "current_status": derived.value,
        "bucket": bucket.value if bucket else None,
        "rag": rag.value,
        "days_left": status_rules.countdown(item.expiry_date, today),
        "current_instance": (
            {
                "id": inst.id,
                "cycle_label": inst.cycle_label,
                "status": inst.status,
                "due_date": inst.due_date,
                "period_start": inst.period_start,
                "period_end": inst.period_end,
                "verification_status": inst.verification_status,
                "escalation_level": inst.escalation_level,
                "renewal_in_process": inst.renewal_in_process,
                "delay_days": inst.delay_days,
                "closed_at": inst.closed_at,
                "new_expiry_date": inst.new_expiry_date,
            }
            if inst
            else None
        ),
        "open_instances": open_count,
    }


def list_items(
    db: Session,
    scope: Scope,
    *,
    filters: dict,
    page: int = 1,
    page_size: int = 25,
    sort: str = "expiry_date",
    direction: str = "asc",
    include_archived: bool = False,
) -> tuple[list[ComplianceItem], int]:
    stmt = select(ComplianceItem)
    if not include_archived:
        stmt = stmt.where(ComplianceItem.is_deleted.is_(False))
    stmt = apply_item_scope(stmt, scope)

    if filters.get("unit_id"):
        stmt = stmt.where(ComplianceItem.unit_id == filters["unit_id"])
    if filters.get("department_id"):
        stmt = stmt.where(ComplianceItem.department_id == filters["department_id"])
    if filters.get("category_id"):
        stmt = stmt.where(ComplianceItem.category_id == filters["category_id"])
    if filters.get("criticality"):
        stmt = stmt.where(ComplianceItem.criticality == filters["criticality"])
    if filters.get("owner_id"):
        stmt = stmt.where(ComplianceItem.owner_id == filters["owner_id"])
    if filters.get("type"):
        stmt = stmt.where(ComplianceItem.type == filters["type"])
    if filters.get("applicability"):
        stmt = stmt.where(ComplianceItem.applicability == filters["applicability"])
    if filters.get("expiring_before"):
        stmt = stmt.where(ComplianceItem.expiry_date <= filters["expiring_before"])
    if filters.get("expiring_after"):
        stmt = stmt.where(ComplianceItem.expiry_date >= filters["expiring_after"])
    if filters.get("search"):
        term = f"%{filters['search'].strip()}%"
        stmt = stmt.where(
            or_(
                ComplianceItem.name.ilike(term),
                ComplianceItem.item_code.ilike(term),
                ComplianceItem.reference_number.ilike(term),
                ComplianceItem.description.ilike(term),
                ComplianceItem.legal_reference_text.ilike(term),
            )
        )
    if filters.get("tag"):
        # JSON containment differs per dialect; a LIKE on the serialised list is
        # portable and adequate for a tag chip filter.
        stmt = stmt.where(ComplianceItem.tags.cast(__import__("sqlalchemy").String).like(
            f'%"{filters["tag"]}"%'
        ))

    total = db.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()

    sort_column = {
        "expiry_date": ComplianceItem.expiry_date,
        "name": ComplianceItem.name,
        "criticality": ComplianceItem.criticality,
        "created_at": ComplianceItem.created_at,
        "item_code": ComplianceItem.item_code,
    }.get(sort, ComplianceItem.expiry_date)

    order = sort_column.desc() if direction.lower() == "desc" else sort_column.asc()
    stmt = stmt.order_by(order.nulls_last(), ComplianceItem.name.asc())

    # Derived status, RAG colour and cycle status are computed from dates and the
    # open cycle rather than stored, so SQL cannot filter on them. Narrow the set
    # here — before paging — otherwise the slice would cut into the unfiltered
    # rows and the page count would describe a result the caller never sees.
    refined = _refine_by_derived(db, stmt, filters)
    if refined is not None:
        rows = refined
        total = len(rows)
        start = max(page - 1, 0) * page_size
        return rows[start : start + page_size], total

    stmt = stmt.offset(max(page - 1, 0) * page_size).limit(page_size)

    rows = list(db.execute(stmt).scalars().all())
    return rows, total


def _refine_by_derived(db: Session, stmt, filters: dict) -> list[ComplianceItem] | None:
    """Apply the computed filters to the whole result set, in sort order.

    Returns ``None`` when no computed filter is in play, so the caller can keep
    the plain SQL path.
    """
    wants_derived = filters.get("derived_status")
    wants_rag = filters.get("rag")
    wants_cycle = filters.get("cycle_status")
    wants_bucket = filters.get("bucket")
    if not (wants_derived or wants_rag or wants_cycle or wants_bucket):
        return None

    today = ist_today()
    rows = list(db.execute(stmt).scalars().all())
    kept: list[ComplianceItem] = []
    for item in rows:
        instance = current_instance(db, item.id)
        state = item_status_input(item, instance)
        if wants_derived and status_rules.derive_status(state, today).value != wants_derived:
            continue
        if wants_rag and status_rules.rag_colour(state, today).value != wants_rag:
            continue
        if wants_cycle and (instance.status if instance else None) != wants_cycle:
            continue
        # Through the same rule the KPI card counted with, so the drill-through
        # total equals the number the user clicked (AC-5).
        if wants_bucket and not status_rules.matches_drill(
            status_rules.compliance_bucket(state, today),
            state.expiry_date,
            today,
            wants_bucket,
        ):
            continue
        kept.append(item)
    return kept


def _plain(value):
    if isinstance(value, date):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value
