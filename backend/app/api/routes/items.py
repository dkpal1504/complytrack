"""Compliance register routes: CRUD, search, bulk actions, import/export."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from sqlalchemy import select

from app.api.common import (
    CurrentScope, CurrentUser, DbSession, bad_request, conflict, context_from, forbidden,
    not_found,
)
from app.core.deps import require, require_any
from app.core.rbac import Permission
from app.domain.enums import BucketDrill, Criticality, ItemStatus, ItemType
from app.domain.workflow import available_transitions
from app.models.auth import User
from app.models.compliance import ComplianceItem
from app.schemas.compliance import (
    ArchiveRequest,
    BulkEdit,
    BulkReassign,
    ItemCreate,
    ItemUpdate,
)
from app.services import imports as import_service
from app.services import items as items_service
from app.services import instances as instance_service
from app.services.queries import lookup_maps

router = APIRouter(prefix="/items", tags=["Compliance register"])


@router.get("", summary="Search and filter the register")
def list_items(
    db: DbSession,
    scope: CurrentScope,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500),
    sort: str = "expiry_date",
    direction: str = "asc",
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
    criticality: str | None = None,
    owner_id: str | None = None,
    status_value: str | None = Query(None, alias="status"),
    item_type: str | None = Query(None, alias="type"),
    tag: str | None = None,
    search: str | None = None,
    expiring_before: date | None = None,
    expiring_after: date | None = None,
    include_archived: bool = False,
    derived_status: str | None = None,
    rag: str | None = None,
    bucket: BucketDrill | None = None,
) -> dict:
    """Scoped, filtered, sorted and paginated register rows (CD-07)."""
    filters = {
        "unit_id": unit_id, "department_id": department_id, "category_id": category_id,
        "criticality": criticality, "owner_id": owner_id, "type": item_type,
        "tag": tag, "search": search,
        "expiring_before": expiring_before, "expiring_after": expiring_after,
        # Computed filters: the service narrows the set before paging so the
        # counts describe the rows the caller actually receives.
        "derived_status": derived_status, "rag": rag, "cycle_status": status_value,
        # What the management dashboards drill into (AC-5).
        "bucket": bucket,
    }
    rows, total = items_service.list_items(
        db, scope, filters=filters, page=page, page_size=page_size,
        sort=sort, direction=direction, include_archived=include_archived,
    )
    maps = lookup_maps(db)
    payload = [items_service.serialise_item(db, row, maps=maps) for row in rows]

    return {
        "items": payload,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max((total + page_size - 1) // page_size, 1),
    }


@router.get("/saved-views", summary="Column and filter presets for the grid")
def saved_views(user: CurrentUser) -> list[dict]:
    common_columns = [
        "item_code", "name", "category_name", "unit_name", "department_name", "owner_name",
        "authority_name", "reference_number", "issue_date", "expiry_date", "renewal_due_date",
        "internal_target_date", "criticality", "current_status", "days_left",
    ]
    return [
        {"key": "all", "name": "All obligations", "columns": common_columns, "filters": {}},
        {"key": "expired", "name": "Expired only", "columns": common_columns,
         "filters": {"derived_status": "Expired"}},
        {"key": "due30", "name": "Due for renewal (30 days)", "columns": common_columns,
         "filters": {"derived_status": "Due for Renewal"}},
        {"key": "critical", "name": "Critical items", "columns": common_columns,
         "filters": {"criticality": Criticality.CRITICAL.value}},
        {"key": "mine", "name": "My items", "columns": common_columns, "filters": {"mine": True}},
        {"key": "filings", "name": "Periodic filings", "columns": common_columns,
         "filters": {"type": ItemType.FILING.value}},
        {"key": "archived", "name": "Archived", "columns": common_columns,
         "filters": {"include_archived": True}},
    ]


@router.get("/status-options", summary="Workflow states and the legal transitions from each")
def status_options() -> dict:
    statuses = [s.value for s in ItemStatus]
    transitions = {
        s.value: [
            {
                "target": t.target,
                "label": t.label,
                "roles": list(t.roles),
                "requires": list(t.required_fields),
                "requires_reason": t.requires_reason,
            }
            for t in available_transitions(s.value)
        ]
        for s in ItemStatus
    }
    return {"statuses": statuses, "transitions": transitions}


@router.post("", status_code=201, summary="Create a compliance item")
def create_item(
    payload: ItemCreate,
    request: Request,
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require(Permission.MANAGE_ITEMS)),
) -> dict:
    try:
        item = items_service.create_item(db, payload, actor=user, ctx=context_from(request, user), scope=scope)
    except items_service.ValidationError as exc:
        raise bad_request(str(exc)) from exc
    except items_service.DuplicateItemError as exc:
        raise conflict(str(exc)) from exc
    except PermissionError as exc:
        raise forbidden(str(exc)) from exc
    return items_service.serialise_item(db, item, maps=lookup_maps(db))


@router.get("/{item_id}", summary="One item with its cycles, checklist and derived status")
def get_item(item_id: str, db: DbSession, scope: CurrentScope, user: CurrentUser) -> dict:
    item = db.get(ComplianceItem, item_id)
    if item is None or item.is_deleted:
        raise not_found("Compliance item")
    if not scope.all_units and item.unit_id not in scope.unit_ids:
        raise forbidden("This item is outside your unit scope.")
    if not scope.all_departments and item.department_id != scope.department_id:
        raise forbidden("This item belongs to another department.")

    payload = items_service.serialise_item(db, item, maps=lookup_maps(db))
    payload.update({
        "description": item.description,
        "legal_reference_text": item.legal_reference_text,
        "sub_category_id": item.sub_category_id,
        "reviewer_id": item.reviewer_id,
        "approver_id": item.approver_id,
        "delegate_id": item.delegate_id,
        "penalty_per_day": (
            float(item.penalty_per_day) if item.penalty_per_day is not None else None
        ),
        "grace_period_days": item.grace_period_days,
        "applicability_justification": item.applicability_justification,
        "asset_id": item.asset_id,
        "person_ref": item.person_ref,
        "remarks": item.remarks,
        "exposure_note": item.exposure_note,
        "template_id": item.template_id,
        "allow_direct_close": item.allow_direct_close,
        "anchor_on": item.anchor_on,
        "reminder_profile_id": item.reminder_profile_id,
        "escalation_profile_id": item.escalation_profile_id,
        "delete_reason": item.delete_reason,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    })

    cycles = db.execute(
        select(instance_service.ComplianceInstance)
        .where(
            instance_service.ComplianceInstance.item_id == item.id,
            instance_service.ComplianceInstance.is_deleted.is_(False),
        )
        .order_by(instance_service.ComplianceInstance.created_at.desc())
    ).scalars().all()

    payload["instances"] = [
        {
            "id": c.id, "cycle_label": c.cycle_label, "status": c.status,
            "due_date": c.due_date, "period_start": c.period_start, "period_end": c.period_end,
            "verification_status": c.verification_status, "escalation_level": c.escalation_level,
            "delay_days": c.delay_days, "closed_at": c.closed_at,
            "new_reference_number": c.new_reference_number,
            "new_issue_date": c.new_issue_date, "new_expiry_date": c.new_expiry_date,
            "acknowledgement_no": c.acknowledgement_no, "fee_paid": c.fee_paid,
            "renewal_in_process": c.renewal_in_process,
            "progress": instance_service.instance_progress(db, c.id),
        }
        for c in cycles
    ]
    return payload


@router.patch("/{item_id}", summary="Update an item (dates, owners and criticality need a reason)")
def update_item(
    item_id: str, payload: ItemUpdate, request: Request, db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require(Permission.MANAGE_ITEMS)),
) -> dict:
    item = db.get(ComplianceItem, item_id)
    if item is None or item.is_deleted:
        raise not_found("Compliance item")
    try:
        items_service.update_item(db, item, payload, actor=user, ctx=context_from(request, user), scope=scope)
    except items_service.ValidationError as exc:
        raise bad_request(str(exc)) from exc
    except PermissionError as exc:
        raise forbidden(str(exc)) from exc
    return items_service.serialise_item(db, item, maps=lookup_maps(db))


@router.post("/{item_id}/archive", summary="Soft-delete an item with a reason (CD-08)")
def archive_item(
    item_id: str, payload: ArchiveRequest, request: Request, db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require(Permission.DELETE_ARCHIVE)),
) -> dict:
    item = db.get(ComplianceItem, item_id)
    if item is None:
        raise not_found("Compliance item")
    if not scope.all_units and item.unit_id not in scope.unit_ids:
        raise forbidden("This item is outside your unit scope.")
    items_service.archive_item(db, item, reason=payload.reason, actor=user, ctx=context_from(request, user))
    return {"detail": f"{item.item_code} archived.", "ok": True}


@router.post("/{item_id}/restore", summary="Restore an archived item")
def restore_item(
    item_id: str, payload: ArchiveRequest, request: Request, db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require(Permission.DELETE_ARCHIVE)),
) -> dict:
    item = db.get(ComplianceItem, item_id)
    if item is None:
        raise not_found("Compliance item")
    items_service.restore_item(db, item, reason=payload.reason, actor=user, ctx=context_from(request, user))
    return {"detail": f"{item.item_code} restored.", "ok": True}


@router.post("/bulk/reassign", summary="Reassign owners or departments in bulk (OW-02)")
def bulk_reassign(
    payload: BulkReassign, request: Request, db: DbSession, scope: CurrentScope,
    user: User = Depends(require(Permission.REASSIGN)),
) -> dict:
    items = _load_scoped(db, payload.item_ids, scope)
    count = items_service.bulk_reassign(
        db, items, owner_id=payload.owner_id, delegate_id=payload.delegate_id,
        department_id=payload.department_id, reason=payload.reason, actor=user, ctx=context_from(request, user),
    )
    return {"detail": f"{count} item(s) reassigned.", "updated": count}


@router.post("/bulk/edit", summary="Bulk edit criticality, department, owner or tags")
def bulk_edit(
    payload: BulkEdit, request: Request, db: DbSession, scope: CurrentScope,
    user: User = Depends(require(Permission.MANAGE_ITEMS)),
) -> dict:
    items = _load_scoped(db, payload.item_ids, scope)
    count = items_service.bulk_edit(
        db, items, set_criticality=payload.set_criticality,
        set_department_id=payload.set_department_id, set_owner_id=payload.set_owner_id,
        set_tags=payload.set_tags, add_tags=payload.add_tags, reason=payload.reason,
        actor=user, ctx=context_from(request, user),
    )
    return {"detail": f"{count} item(s) updated.", "updated": count}


def _load_scoped(db, item_ids: list[str], scope) -> list[ComplianceItem]:
    if not item_ids:
        raise bad_request("Select at least one item.")
    rows = db.execute(
        select(ComplianceItem).where(
            ComplianceItem.id.in_(item_ids), ComplianceItem.is_deleted.is_(False)
        )
    ).scalars().all()
    out = []
    for item in rows:
        if not scope.all_units and item.unit_id not in scope.unit_ids:
            continue
        if not scope.all_departments and item.department_id != scope.department_id:
            continue
        out.append(item)
    if not out:
        raise forbidden("None of the selected items fall within your scope.")
    return out


# --------------------------------------------------------------------------- #
# Import / export (Section 12)
# --------------------------------------------------------------------------- #
@router.get("/export/template", summary="Download the Excel import template")
def download_template(user: User = Depends(require(Permission.MANAGE_ITEMS))) -> Response:
    return Response(
        content=import_service.template_workbook(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="ComplyTrack_Import_Template.xlsx"'},
    )


@router.post("/import/preview", summary="Dry-run an import with a row-level report")
async def import_preview(
    db: DbSession, scope: CurrentScope,
    file: UploadFile = File(...),
    user: User = Depends(require(Permission.MANAGE_ITEMS)),
) -> dict:
    data = await file.read()
    records = _parse_upload(file.filename or "", data)
    return import_service.preview_import(db, records, scope)


@router.post("/import/commit", summary="Commit a validated import")
async def import_commit(
    request: Request, db: DbSession, scope: CurrentScope,
    file: UploadFile = File(...),
    user: User = Depends(require(Permission.MANAGE_ITEMS)),
) -> dict:
    data = await file.read()
    records = _parse_upload(file.filename or "", data)
    try:
        return import_service.commit_import(db, records, actor=user, ctx=context_from(request, user), scope=scope)
    except import_service.ImportError_ as exc:
        raise bad_request(str(exc)) from exc


def _parse_upload(filename: str, data: bytes) -> list[dict]:
    try:
        if filename.lower().endswith(".csv"):
            return import_service.parse_csv(data)
        return import_service.parse_workbook(data)
    except import_service.ImportError_ as exc:
        raise bad_request(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise bad_request(f"Could not read the file: {exc}") from exc


@router.get("/export/register", summary="Export the register to Excel")
def export_register(
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED)),
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
    criticality: str | None = None,
    owner_id: str | None = None,
    status_value: str | None = Query(None, alias="status"),
    item_type: str | None = Query(None, alias="type"),
    tag: str | None = None,
    search: str | None = None,
    expiring_before: date | None = None,
    expiring_after: date | None = None,
    derived_status: str | None = None,
    rag: str | None = None,
    bucket: BucketDrill | None = None,
    include_archived: bool = False,
) -> Response:
    """The register as an Excel workbook, honouring the grid's current filters.

    What the user filtered on screen is what lands in the file — an export that
    silently widened back to every obligation would be worse than no filter at
    all, since the counts in the workbook would not describe the rows.
    """
    from app.services import dashboards

    filters = {
        "unit_id": unit_id, "department_id": department_id, "category_id": category_id,
        "criticality": criticality, "owner_id": owner_id, "type": item_type,
        "tag": tag, "search": search,
        # `build_rows` names these differently; map rather than rename, so the
        # query string stays identical to the grid's.
        "period_from": expiring_after, "period_to": expiring_before,
        "status": derived_status, "rag": rag, "cycle_status": status_value,
        "bucket": bucket,
    }
    rows = dashboards.build_rows(
        db, scope, filters=filters, include_archived=include_archived
    )
    return Response(
        content=import_service.export_items_xlsx(rows),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="Compliance_Register.xlsx"'},
    )
