"""Template library: the seeded obligation catalogue and the apply-to-unit wizard."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select

from app.api.common import (
    context_from,
    CurrentScope, CurrentUser, DbSession, bad_request, conflict, forbidden, not_found,
)
from app.core.deps import Context, require, require_any
from app.core.rbac import Permission
from app.models.auth import User
from app.models.compliance import ComplianceTemplate
from app.schemas.compliance import (
    ApplyTemplateRequest,
    TemplateCreate,
    TemplateUpdate,
)
from app.services import templates as template_service

router = APIRouter(prefix="/templates", tags=["Template library"])


@router.get("", summary="Browse the obligation catalogue")
def list_templates(
    db: DbSession,
    user: User = Depends(require_any(Permission.VIEW_ALL_ITEMS, Permission.VIEW_SCOPED_ITEMS)),
    search: str | None = None,
    category_id: str | None = None,
) -> list[dict]:
    return template_service.list_templates(db, search=search, category_id=category_id)


@router.get("/{template_id}", summary="One template with its required documents")
def get_template(
    template_id: str, db: DbSession,
    user: User = Depends(require_any(Permission.VIEW_ALL_ITEMS, Permission.VIEW_SCOPED_ITEMS)),
) -> dict:
    template = db.get(ComplianceTemplate, template_id)
    if template is None or template.is_deleted:
        raise not_found("Template")
    return {
        "id": template.id, "code": template.code, "name": template.name,
        "type": template.type, "category_id": template.category_id,
        "sub_category_id": template.sub_category_id,
        "authority_id": template.authority_id,
        "default_validity_value": template.default_validity_value,
        "default_validity_unit": template.default_validity_unit,
        "recurrence_rule": template.recurrence_rule,
        "recurrence_day": template.recurrence_day,
        "recurrence_interval_months": template.recurrence_interval_months,
        "lead_time_days": template.lead_time_days,
        "authority_processing_days": template.authority_processing_days,
        "internal_prep_days": template.internal_prep_days,
        "criticality": template.criticality,
        "default_owner_dept_id": template.default_owner_dept_id,
        "required_documents": template.required_documents or [],
        "legal_reference_text": template.legal_reference_text,
        "applicability_notes": template.applicability_notes,
        "allow_direct_close": template.allow_direct_close,
        "anchor_on": template.anchor_on,
        "is_seed": template.is_seed,
    }


@router.post("", status_code=201, summary="Create a template (Compliance Team only)")
def create_template(
    payload: TemplateCreate, request: Request, db: DbSession,
    user: User = Depends(require(Permission.MANAGE_TEMPLATES)),
) -> dict:
    try:
        template = template_service.create_template(db, payload, actor=user, ctx=context_from(request, user))
    except template_service.TemplateError as exc:
        raise conflict(str(exc)) from exc
    return {"id": template.id, "code": template.code, "name": template.name}


@router.patch("/{template_id}", summary="Edit a template")
def update_template(
    template_id: str, payload: TemplateUpdate, request: Request, db: DbSession,
    user: User = Depends(require(Permission.MANAGE_TEMPLATES)),
) -> dict:
    template = db.get(ComplianceTemplate, template_id)
    if template is None or template.is_deleted:
        raise not_found("Template")
    updated = template_service.update_template(
        db, template, payload, actor=user, ctx=context_from(request, user)
    )
    return {"id": updated.id, "code": updated.code, "name": updated.name}


@router.post("/apply", summary="Apply templates to a unit — dry-run first, then commit")
def apply_templates(
    payload: ApplyTemplateRequest, request: Request, db: DbSession, scope: CurrentScope,
    user: User = Depends(require(Permission.MANAGE_ITEMS)),
) -> dict:
    try:
        result = template_service.apply_template(
            db, payload, actor=user, ctx=context_from(request, user), scope=scope
        )
    except PermissionError as exc:
        raise forbidden(str(exc)) from exc
    except template_service.TemplateError as exc:
        raise bad_request(str(exc)) from exc
    return result


@router.get("/categories/tree", summary="Category tree for the browse sidebar")
def category_tree(
    db: DbSession, user: User = Depends(require_any(Permission.VIEW_ALL_ITEMS, Permission.VIEW_SCOPED_ITEMS))
) -> list[dict]:
    from app.models.org import Category

    parents = db.execute(
        select(Category).where(Category.parent_id.is_(None), Category.is_deleted.is_(False))
        .order_by(Category.sort_order, Category.name)
    ).scalars().all()
    children = db.execute(
        select(Category).where(Category.parent_id.is_not(None), Category.is_deleted.is_(False))
        .order_by(Category.sort_order, Category.name)
    ).scalars().all()

    counts = dict(
        db.execute(
            select(ComplianceTemplate.category_id, func.count(ComplianceTemplate.id))
            .where(ComplianceTemplate.is_deleted.is_(False))
            .group_by(ComplianceTemplate.category_id)
        ).all()
    )

    def node(row) -> dict:
        return {
            "id": row.id, "name": row.name, "colour": row.colour,
            "template_count": counts.get(row.id, 0),
        }

    return [
        {
            **node(parent),
            "children": [
                node(c) for c in children if c.parent_id == parent.id
            ],
        }
        for parent in parents
    ]
