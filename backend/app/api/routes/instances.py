"""Renewal workflow: status transitions, verification, roll-forward, commentary."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.common import (
    CurrentScope,
    CurrentUser,
    DbSession,
    context_from,
    forbidden,
    not_found,
)
from app.core.deps import require, require_writable
from app.core.rbac import Permission
from app.models.compliance import ComplianceItem, ComplianceInstance, InstanceChecklist
from app.schemas.compliance import (
    ChecklistUpdate,
    CommentCreate,
    StatusChange,
    VerificationRequest,
)
from app.services import instances as instance_service

router = APIRouter(prefix="/instances", tags=["Renewal workflow"])


def _load(db, instance_id: str) -> tuple[ComplianceInstance, ComplianceItem]:
    instance = instance_service.get_instance(db, instance_id)
    if instance is None:
        raise not_found("Compliance cycle")
    item = db.get(ComplianceItem, instance.item_id)
    if item is None:
        raise not_found("Compliance item")
    return instance, item


def _guard(item: ComplianceItem, scope) -> None:
    if not scope.all_units and item.unit_id not in scope.unit_ids:
        raise forbidden("This cycle is outside your unit scope.")
    if not scope.all_departments and item.department_id != scope.department_id:
        raise forbidden("This cycle belongs to another department.")


@router.get("/{instance_id}", summary="One cycle with its checklist and progress")
def get_instance(instance_id: str, db: DbSession, scope: CurrentScope, user: CurrentUser) -> dict:
    instance, item = _load(db, instance_id)
    _guard(item, scope)
    checklists = db.query(InstanceChecklist).filter(
        InstanceChecklist.instance_id == instance.id,
        InstanceChecklist.is_deleted.is_(False),
    ).order_by(InstanceChecklist.sort_order).all()
    return {
        "id": instance.id,
        "item_id": item.id,
        "item_code": item.item_code,
        "item_name": item.name,
        "criticality": item.criticality,
        "cycle_label": instance.cycle_label,
        "status": instance.status,
        "due_date": instance.due_date,
        "period_start": instance.period_start,
        "period_end": instance.period_end,
        "expected_filing_date": instance.expected_filing_date,
        "submission_date": instance.submitted_at,
        "acknowledgement_no": instance.acknowledgement_no,
        "new_reference_number": instance.new_reference_number,
        "new_issue_date": instance.new_issue_date,
        "new_expiry_date": instance.new_expiry_date,
        "fee_paid": instance.fee_paid,
        "verification_status": instance.verification_status,
        "verification_remark": instance.verification_remark,
        "verified_at": instance.verified_at,
        "escalation_level": instance.escalation_level,
        "delay_days": instance.delay_days,
        "on_hold_reason": instance.on_hold_reason,
        "review_date": instance.review_date,
        "renewal_in_process": instance.renewal_in_process,
        "closed_at": instance.closed_at,
        "progress": instance_service.instance_progress(db, instance.id),
        "checklist": [
            {
                # Exactly the fields the PRD's data model gives a checklist line
                # (Section 10): name, status, who received it and when, plus the
                # note the line carries. `is_mandatory` used to be listed here as
                # well; no column ever backed it and nothing could set it, so it
                # raised AttributeError and failed the whole response as soon as a
                # cycle had one checklist line.
                "id": c.id,
                "item_name": c.item_name,
                "status": c.status,
                "sort_order": c.sort_order,
                "received_at": c.received_at,
                "notes": c.notes,
            }
            for c in checklists
        ],
    }


@router.post("/{instance_id}/transition", summary="Move a cycle through the status machine")
def transition(
    instance_id: str,
    payload: StatusChange,
    request: Request,
    db: DbSession,
    user: User = Depends(require_writable),
) -> dict:
    instance, item = _load(db, instance_id)
    try:
        instance_service.apply_transition(
            db, instance, payload, actor=user, ctx=context_from(request, user)
        )
    except instance_service.TransitionError as exc:
        raise _workflow_error(exc) from exc
    except PermissionError as exc:
        raise forbidden(str(exc)) from exc
    return {
        "id": instance.id,
        "status": instance.status,
        "delay_days": instance.delay_days,
        "closed_at": instance.closed_at,
        "detail": f"{item.item_code} moved to {instance.status}.",
    }


@router.post("/{instance_id}/verify", summary="Compliance Team approves or rejects the evidence")
def verify(
    instance_id: str,
    payload: VerificationRequest,
    request: Request,
    db: DbSession,
    user: User = Depends(require(Permission.VERIFY_CLOSE)),
) -> dict:
    instance, item = _load(db, instance_id)
    try:
        instance_service.verify(
            db, instance, payload, actor=user, ctx=context_from(request, user)
        )
    except instance_service.TransitionError as exc:
        raise _workflow_error(exc) from exc
    return {
        "id": instance.id,
        "verification_status": instance.verification_status,
        "status": instance.status,
        "closed_at": instance.closed_at,
        "detail": (
            "Renewal approved." if payload.decision == "approve" else "Renewal sent back."
        ),
    }


@router.post("/{instance_id}/roll-forward", summary="Open the next cycle for this item")
def roll_forward(
    instance_id: str,
    request: Request,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ITEMS)),
) -> dict:
    instance, item = _load(db, instance_id)
    new_instance = instance_service.roll_forward(
        db, item, instance, actor=user, ctx=context_from(request, user)
    )
    if new_instance is None:
        return {"detail": "This obligation has no further cycle.", "created": False}
    return {
        "detail": f"Opened {new_instance.cycle_label}.",
        "created": True,
        "id": new_instance.id,
        "cycle_label": new_instance.cycle_label,
        "due_date": new_instance.due_date,
    }


@router.patch("/{instance_id}/checklist/{checklist_id}", summary="Tick a checklist document off")
def checklist_status(
    instance_id: str,
    checklist_id: str,
    payload: ChecklistUpdate,
    request: Request,
    db: DbSession,
    user: User = Depends(require_writable),
) -> dict:
    instance, item = _load(db, instance_id)
    checklist = db.get(InstanceChecklist, checklist_id)
    if checklist is None or checklist.instance_id != instance.id:
        raise not_found("Checklist line")
    instance_service.set_checklist_status(
        db,
        checklist,
        status=payload.status,
        actor=user,
        ctx=context_from(request, user),
        notes=payload.note,
    )
    return {
        "id": checklist.id,
        "status": checklist.status,
        "received_at": checklist.received_at,
        "notes": checklist.notes,
        "progress": instance_service.instance_progress(db, instance.id),
    }


@router.post("/{instance_id}/comments", status_code=201, summary="Add a comment or @mention")
def add_comment(
    instance_id: str,
    payload: CommentCreate,
    request: Request,
    db: DbSession,
    user: User = Depends(require_writable),
) -> dict:
    instance, item = _load(db, instance_id)
    comment = instance_service.add_comment(
        db, item_id=item.id, instance_id=instance.id, body=payload.body,
        mentions=payload.mentions, kind=payload.kind, actor=user,
        ctx=context_from(request, user),
    )
    return {"id": comment.id, "body": comment.body, "created_at": comment.created_at}


@router.get("/{instance_id}/timeline", summary="Full audit timeline for the parent item (AT-02)")
def timeline(instance_id: str, db: DbSession, scope: CurrentScope, user: CurrentUser) -> list[dict]:
    instance, item = _load(db, instance_id)
    _guard(item, scope)
    return instance_service.build_timeline(db, item.id)



def _workflow_error(exc) -> Exception:
    """The HTTP answer for a move the state machine refused.

    The two refusals are different questions and get different answers. A move
    whose required fields are absent is a **bad request**: the payload was
    incomplete, and the caller can complete it and send the same call again. A
    move the state machine forbids — the item is already Closed, the target is
    not reachable from the current status, the caller's role cannot make it — is
    a **conflict** with the resource as it stands: resending it unchanged will
    never work, and here the usual cause is a screen loaded before somebody else
    moved the cycle, which "Bad Request" would blame on the wrong person.

    ``WorkflowError.missing`` is what separates the two, and it is also what the
    application-level handler in ``main.py`` keys off — the same condition must
    not answer 400 down one path and 409 down the other.
    """
    from app.api.common import bad_request, conflict

    missing = getattr(exc, "missing", None)
    if missing:
        pretty = ", ".join(str(m).replace("_", " ") for m in missing)
        return bad_request(f"{exc} Required: {pretty}.")
    return conflict(str(exc))
