"""Template library and the apply-to-unit wizard (CD/Section 4 seed library)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.rbac import Scope
from app.db.types import utcnow
from app.domain.dates import compute_dates, ist_today
from app.domain.enums import Applicability, ItemType, RecurrenceKind, ValidityUnit
from app.models.auth import User
from app.models.compliance import ComplianceItem, ComplianceTemplate
from app.models.org import Category, Department, IssuingAuthority, OrganisationUnit
from app.schemas.compliance import ApplyTemplateRequest, ItemCreate, TemplateCreate, TemplateUpdate
from app.services import audit, items as items_service
from app.services.queries import lookup_maps


class TemplateError(ValueError):
    pass


def create_template(
    db: Session, payload: TemplateCreate, *, actor: User, ctx: dict
) -> ComplianceTemplate:
    existing = db.execute(
        select(ComplianceTemplate).where(ComplianceTemplate.code == payload.code)
    ).scalar_one_or_none()
    if existing is not None:
        raise TemplateError(f"Template code '{payload.code}' is already in use.")

    template = ComplianceTemplate(**payload.model_dump(), created_by=actor.id)
    db.add(template)
    db.flush()
    audit.write_audit(
        db, entity_type="compliance_template", entity_id=template.id, action="create",
        new_value={"code": template.code, "name": template.name},
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(template)
    return template


def update_template(
    db: Session, template: ComplianceTemplate, payload: TemplateUpdate, *, actor: User, ctx: dict
) -> ComplianceTemplate:
    changes = payload.model_dump(exclude_unset=True)
    reason = changes.pop("reason", None)
    before = {k: getattr(template, k, None) for k in changes}
    for key, value in changes.items():
        setattr(template, key, value)
    template.updated_by = actor.id
    db.add(template)
    audit.write_audit(
        db, entity_type="compliance_template", entity_id=template.id, action="update",
        changes=audit.diff_entity(
            {k: str(v) for k, v in before.items()},
            {k: str(getattr(template, k, None)) for k in changes},
        ),
        reason=reason,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(template)
    return template


def list_templates(db: Session, *, search: str | None = None,
                   category_id: str | None = None) -> list[dict]:
    stmt = select(ComplianceTemplate).where(ComplianceTemplate.is_deleted.is_(False))
    if category_id:
        stmt = stmt.where(ComplianceTemplate.category_id == category_id)
    if search:
        term = f"%{search}%"
        stmt = stmt.where(
            ComplianceTemplate.name.ilike(term) | ComplianceTemplate.code.ilike(term)
        )
    templates = list(db.execute(stmt.order_by(ComplianceTemplate.code)).scalars().all())

    counts = dict(
        db.execute(
            select(ComplianceItem.template_id, func.count(ComplianceItem.id))
            .where(ComplianceItem.is_deleted.is_(False))
            .group_by(ComplianceItem.template_id)
        ).all()
    )
    maps = lookup_maps(db)
    return [
        {
            "id": t.id, "code": t.code, "name": t.name, "type": t.type,
            "category_id": t.category_id, "category_name": maps["category"].get(t.category_id),
            "authority_id": t.authority_id,
            "authority_name": maps["authority"].get(t.authority_id),
            "default_validity_value": t.default_validity_value,
            "default_validity_unit": t.default_validity_unit,
            "recurrence_rule": t.recurrence_rule,
            "lead_time_days": t.lead_time_days,
            "authority_processing_days": t.authority_processing_days,
            "internal_prep_days": t.internal_prep_days,
            "criticality": t.criticality,
            "default_owner_dept_id": t.default_owner_dept_id,
            "department_name": maps["department"].get(t.default_owner_dept_id),
            "required_documents": t.required_documents or [],
            "legal_reference_text": t.legal_reference_text,
            "applicability_notes": t.applicability_notes,
            "is_seed": t.is_seed,
            "item_count": counts.get(t.id, 0),
        }
        for t in templates
    ]


def apply_template(
    db: Session,
    request: ApplyTemplateRequest,
    *,
    actor: User,
    ctx: dict,
    scope: Scope,
    fy_start_month: int = 4,
) -> dict:
    """Instantiate templates against a unit ("apply template to Unit X")."""
    unit = db.get(OrganisationUnit, request.unit_id)
    if unit is None:
        raise TemplateError("Select a valid unit.")
    if not scope.all_units and unit.id not in scope.unit_ids:
        raise PermissionError("You cannot apply templates to a unit outside your scope.")

    stmt = select(ComplianceTemplate).where(ComplianceTemplate.is_deleted.is_(False))
    if request.template_ids:
        stmt = stmt.where(ComplianceTemplate.id.in_(request.template_ids))
    if request.category_ids:
        stmt = stmt.where(ComplianceTemplate.category_id.in_(request.category_ids))
    templates = list(db.execute(stmt.order_by(ComplianceTemplate.code)).scalars().all())

    if not templates:
        raise TemplateError("No templates matched the selection.")

    issue_date = request.issue_date or ist_today()
    created = skipped = 0
    details: list[dict] = []

    for template in templates:
        department_id = request.department_id or template.default_owner_dept_id
        owner_id = request.owner_id

        if owner_id is None and department_id:
            dept = db.get(Department, department_id)
            if dept is not None and dept.head_user_id:
                owner_id = dept.head_user_id

        computed = compute_dates(
            issue_date=issue_date,
            validity_value=template.default_validity_value,
            validity_unit=template.default_validity_unit,
            authority_processing_days=template.authority_processing_days,
            internal_prep_days=template.internal_prep_days,
            fy_start_month=fy_start_month,
        )
        reference = f"{unit.code}/{template.code}/{issue_date.year}"

        existing = items_service.find_duplicate(
            db, unit_id=unit.id, authority_id=template.authority_id,
            reference_number=reference,
        )
        if existing is not None:
            skipped += 1
            details.append({"template": template.name, "status": "already exists",
                            "item_code": existing.item_code})
            continue

        if request.dry_run:
            created += 1
            details.append({
                "template": template.name, "status": "would create",
                "expiry_date": computed["expiry_date"].isoformat()
                if computed["expiry_date"] else None,
            })
            continue

        payload = ItemCreate(
            template_id=template.id,
            name=f"{template.name} — {unit.name}",
            description=template.applicability_notes,
            category_id=template.category_id,
            sub_category_id=template.sub_category_id,
            type=template.type,
            legal_reference_text=template.legal_reference_text,
            unit_id=unit.id,
            department_id=department_id,
            owner_id=owner_id or actor.id,
            authority_id=template.authority_id,
            reference_number=reference,
            issue_date=issue_date,
            validity_value=template.default_validity_value,
            validity_unit=template.default_validity_unit,
            authority_processing_days=template.authority_processing_days,
            internal_prep_days=template.internal_prep_days,
            lead_time_days=template.lead_time_days,
            recurrence_rule=template.recurrence_rule,
            recurrence_day=template.recurrence_day,
            recurrence_interval_months=template.recurrence_interval_months,
            criticality=template.criticality,
            applicability=Applicability.APPLICABLE.value,
            required_documents=list(template.required_documents or []),
            reminder_profile_id=template.reminder_profile_id,
            escalation_profile_id=template.escalation_profile_id,
            allow_direct_close=template.allow_direct_close,
            anchor_on=template.anchor_on,
            create_first_instance=True,
            ignore_duplicate_check=True,
        )
        item = items_service.create_item(
            db, payload, actor=actor, ctx=ctx, scope=scope, fy_start_month=fy_start_month
        )
        created += 1
        details.append({"template": template.name, "status": "created",
                        "item_code": item.item_code, "item_id": item.id})

    db.commit()
    return {"created": created, "skipped": skipped, "details": details}
