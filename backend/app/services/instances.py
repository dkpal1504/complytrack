"""Instance lifecycle: workflow transitions, verification, roll-forward.

Implements PRD Section 8 plus business rules 3, 4 and 5.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.types import utcnow
from app.domain import workflow
from app.domain.dates import add_years, ist_today, to_ist
from app.domain.enums import (
    ChecklistStatus,
    Criticality,
    DocumentType,
    ItemStatus,
    RecurrenceKind,
    UserStatus,
    VerificationStatus,
)
from app.domain.recurrence import cycle_label, next_due_date, period_for
from app.models.auth import User
from app.models.compliance import (
    Comment,
    ComplianceInstance,
    ComplianceItem,
    InstanceChecklist,
)
from app.models.documents import Document
from app.schemas.compliance import StatusChange, VerificationRequest
from app.services import audit, notifications
from app.services.queries import department_head, unit_head

# Fields a verification decision may overwrite on the item.
CARRIED_TO_ITEM = ("reference_number", "issue_date", "expiry_date")


class TransitionError(workflow.WorkflowError):
    pass


def get_instance(db: Session, instance_id: str) -> ComplianceInstance | None:
    instance = db.get(ComplianceInstance, instance_id)
    if instance is None or instance.is_deleted:
        return None
    return instance


def has_evidence(db: Session, instance_id: str, *, renewed: bool = False) -> bool:
    stmt = select(func.count(Document.id)).where(
        Document.instance_id == instance_id, Document.is_deleted.is_(False)
    )
    if renewed:
        stmt = stmt.where(
            Document.doc_type.in_((DocumentType.CERTIFICATE, DocumentType.ACKNOWLEDGEMENT))
        )
    return (db.execute(stmt).scalar_one() or 0) > 0


def apply_transition(
    db: Session,
    instance: ComplianceInstance,
    payload: StatusChange,
    *,
    actor: User,
    ctx: dict,
    fy_start_month: int = 4,
) -> ComplianceInstance:
    """Validate and record one workflow move."""
    item = db.get(ComplianceItem, instance.item_id)
    assert item is not None

    is_critical = item.criticality == Criticality.CRITICAL
    # Maker-checker: the closing verifier must not be the owner who submitted.
    actor_verified = actor.id not in {item.owner_id, item.delegate_id}

    transition = workflow.validate_transition(
        source=instance.status,
        target=payload.target_status,
        role=actor.role,
        payload=payload.model_dump(),
        has_evidence=has_evidence(
            db, instance.id, renewed=payload.target_status == ItemStatus.RENEWED
        ),
        is_critical=is_critical,
        allow_direct_close=bool(item.allow_direct_close),
        user_id=actor.id,
        owner_id=item.owner_id,
        delegate_id=item.delegate_id,
        actor_verified=actor_verified,
    )

    previous_status = instance.status
    now = utcnow()
    instance.status = payload.target_status
    instance.status_changed_at = now
    instance.updated_by = actor.id

    if payload.target_status == ItemStatus.UNDER_PROCESS:
        instance.started_at = instance.started_at or now
        if payload.expected_filing_date:
            instance.expected_filing_date = payload.expected_filing_date
        # Acknowledging the assignment is implicit in starting work (OW-06).
        instance.owner_acknowledged_at = instance.owner_acknowledged_at or now

    elif payload.target_status == ItemStatus.SUBMITTED:
        instance.submitted_at = now
        instance.acknowledgement_no = payload.acknowledgement_no or instance.acknowledgement_no

    elif payload.target_status == ItemStatus.RENEWED:
        instance.renewed_at = now
        instance.new_reference_number = payload.new_reference_number or instance.new_reference_number
        instance.new_issue_date = payload.new_issue_date or instance.new_issue_date
        instance.new_expiry_date = payload.new_expiry_date or instance.new_expiry_date
        if payload.fee_paid is not None:
            instance.fee_paid = payload.fee_paid

    elif payload.target_status == ItemStatus.QUERY_RAISED:
        instance.escalation_level = max(instance.escalation_level, 1)

    elif payload.target_status == ItemStatus.ON_HOLD:
        instance.on_hold_reason = payload.on_hold_reason
        instance.review_date = payload.review_date

    elif payload.target_status == ItemStatus.CLOSED:
        instance.closed_at = now
        instance.closed_by = actor.id
        instance.verification_status = VerificationStatus.APPROVED
        instance.verification_remark = payload.verification_remark
        instance.verified_by = actor.id
        instance.verified_at = now

    # RT-07: an application filed before expiry keeps the item "compliant".
    # Both this and the lateness below are calendar questions, and a calendar
    # day here is an IST one: a filing made at 02:00 IST belongs to that IST
    # day, not to the UTC day it shares with the evening before. Reading the
    # UTC date instead would call a filing that is a day late "on time", which
    # is the one answer a compliance register must not give.
    filed_on = to_ist(now).date()
    if item.expiry_date and filed_on <= item.expiry_date and payload.target_status in (
        ItemStatus.SUBMITTED,
        ItemStatus.RENEWED,
    ):
        instance.renewal_in_process = True

    if payload.delay_days is not None:
        instance.delay_days = payload.delay_days
    elif instance.due_date and payload.target_status in (ItemStatus.SUBMITTED, ItemStatus.RENEWED):
        instance.delay_days = max((filed_on - instance.due_date).days, 0)

    db.add(instance)
    _reopen_item_dates(item, instance)

    audit.write_audit(
        db,
        entity_type="compliance_instance",
        entity_id=instance.id,
        action="status_change",
        field="status",
        old_value=previous_status,
        new_value=transition.target,
        reason=payload.reason or payload.verification_remark or transition.label,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )

    if previous_status in (ItemStatus.PENDING, ItemStatus.QUERY_RAISED, ItemStatus.ON_HOLD):
        notifications.clear_instance_reminders(db, instance.id)

    db.flush()

    if transition.target == ItemStatus.CLOSED:
        roll_forward(db, item, instance, actor=actor, ctx=ctx, fy_start_month=fy_start_month)

    db.commit()
    db.refresh(instance)
    return instance


def _reopen_item_dates(item: ComplianceItem, instance: ComplianceInstance) -> None:
    """Keep the item's headline dates in step with a closed cycle."""
    if instance.status == ItemStatus.CLOSED:
        if instance.new_reference_number:
            item.reference_number = instance.new_reference_number
        if instance.new_issue_date:
            item.issue_date = instance.new_issue_date
        if instance.new_expiry_date:
            item.expiry_date = instance.new_expiry_date
            item.renewal_due_date = instance.new_expiry_date - __import__("datetime").timedelta(
                days=item.authority_processing_days or 0
            )
            item.internal_target_date = item.renewal_due_date - __import__("datetime").timedelta(
                days=item.internal_prep_days or 0
            )
    db_session_marker = None  # no-op; keeps the function obviously pure
    _ = db_session_marker


def verify(
    db: Session,
    instance: ComplianceInstance,
    payload: VerificationRequest,
    *,
    actor: User,
    ctx: dict,
    fy_start_month: int = 4,
) -> ComplianceInstance:
    """DS-06: the Compliance Team approves or rejects an uploaded renewal."""
    item = db.get(ComplianceItem, instance.item_id)
    assert item is not None

    if actor.id in {item.owner_id, item.delegate_id} and item.criticality == Criticality.CRITICAL:
        raise TransitionError(
            "Maker-checker: the owner cannot verify their own Critical item."
        )

    if payload.decision == "reject":
        instance.verification_status = VerificationStatus.REJECTED
        instance.verification_remark = payload.remark
        instance.verified_by = actor.id
        instance.verified_at = utcnow()
        instance.status = ItemStatus.UNDER_PROCESS
        instance.status_changed_at = utcnow()
        db.add(instance)
        audit.write_audit(
            db, entity_type="compliance_instance", entity_id=instance.id,
            action="verify_reject", new_value=payload.remark,
            reason=payload.remark,
            **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
        )
        db.commit()
        db.refresh(instance)
        return instance

    instance.verification_status = VerificationStatus.APPROVED
    instance.verification_remark = payload.remark
    instance.verified_by = actor.id
    instance.verified_at = utcnow()
    if payload.new_expiry_date:
        instance.new_expiry_date = payload.new_expiry_date
    if payload.new_reference_number:
        instance.new_reference_number = payload.new_reference_number
    if payload.new_issue_date:
        instance.new_issue_date = payload.new_issue_date

    db.add(instance)
    transition = StatusChange(
        target_status=ItemStatus.CLOSED,
        verification_remark=payload.remark,
        reason=payload.remark,
    )
    return apply_transition(
        db, instance, transition, actor=actor, ctx=ctx, fy_start_month=fy_start_month
    )


def roll_forward(
    db: Session,
    item: ComplianceItem,
    closed_instance: ComplianceInstance,
    *,
    actor: User,
    ctx: dict,
    fy_start_month: int = 4,
) -> ComplianceInstance | None:
    """Business rule 4: on closure, open the next cycle and reschedule reminders."""
    rule = item.recurrence_rule or RecurrenceKind.NONE
    if rule == RecurrenceKind.NONE and not item.expiry_date:
        return None

    base_due = closed_instance.new_expiry_date or closed_instance.due_date or item.expiry_date
    if base_due is None:
        return None

    if rule == RecurrenceKind.NONE:
        # Licence-style: the next cycle is driven purely by the new expiry date.
        next_due = item.expiry_date or base_due
        period_start = closed_instance.period_end or closed_instance.period_start
        period_end = next_due
        label = cycle_label(RecurrenceKind.ANNUAL, next_due, fy_start_month=fy_start_month)
    else:
        next_due = next_due_date(
            rule,
            base_due,
            day=item.recurrence_day,
            interval_months=item.recurrence_interval_months,
            fy_start_month=fy_start_month,
        )
        if next_due is None:
            return None
        period_start, period_end = period_for(rule, next_due, fy_start_month=fy_start_month)
        label = cycle_label(rule, next_due, fy_start_month=fy_start_month)

    # Never create the same cycle twice (idempotent scheduler / double-click).
    existing = db.execute(
        select(ComplianceInstance).where(
            ComplianceInstance.item_id == item.id,
            ComplianceInstance.cycle_label == label,
            ComplianceInstance.is_deleted.is_(False),
        ).limit(1)
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    new_instance = ComplianceInstance(
        item_id=item.id,
        cycle_label=label,
        due_date=next_due,
        period_start=period_start,
        period_end=period_end,
        status=ItemStatus.PENDING,
        status_changed_at=utcnow(),
        verification_status=VerificationStatus.NOT_SUBMITTED,
    )
    db.add(new_instance)
    db.flush()

    for index, doc_name in enumerate(item.required_documents or []):
        db.add(
            InstanceChecklist(
                instance_id=new_instance.id, item_name=doc_name, status="Pending", sort_order=index
            )
        )

    audit.write_audit(
        db,
        entity_type="compliance_instance",
        entity_id=new_instance.id,
        action="rolled_forward",
        new_value={"cycle": label, "due_date": next_due.isoformat()},
        reason=f"Auto-created on closure of {closed_instance.cycle_label}.",
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    return new_instance


def instance_progress(db: Session, instance_id: str) -> dict:
    """OW-09: auto progress % from the checklist."""
    rows = db.execute(
        select(InstanceChecklist).where(
            InstanceChecklist.instance_id == instance_id,
            InstanceChecklist.is_deleted.is_(False),
        )
    ).scalars().all()
    applicable = [r for r in rows if r.status != ChecklistStatus.NOT_REQUIRED]
    received = [r for r in applicable if r.status == ChecklistStatus.RECEIVED]
    percent = round(len(received) / len(applicable) * 100) if applicable else 100
    return {
        "total": len(rows),
        "received": len(received),
        "pending": len(applicable) - len(received),
        "percent": percent,
    }


def set_checklist_status(
    db: Session,
    checklist: InstanceChecklist,
    *,
    status: str,
    actor: User,
    ctx: dict,
    notes: str | None = None,
) -> InstanceChecklist:
    before = checklist.status
    before_notes = checklist.notes
    checklist.status = status
    if status == ChecklistStatus.RECEIVED:
        checklist.received_at = utcnow()
        checklist.received_by = actor.id
    else:
        checklist.received_at = None
        checklist.received_by = None
    # `None` means "leave the note alone" rather than "clear it": the status
    # control sends a note when the user has one, and callers that only care
    # about the status must not wipe a note someone else recorded.
    notes_changed = notes is not None and notes != before_notes
    if notes_changed:
        checklist.notes = notes
    db.add(checklist)
    audit.write_audit(
        db, entity_type="instance_checklist", entity_id=checklist.id,
        action="checklist_update", field="status", old_value=before, new_value=status,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    if notes_changed:
        # Audited as its own row: "who recorded the challan number" is a
        # different question from "who marked the line received", and the trail
        # answers one row per change.
        audit.write_audit(
            db, entity_type="instance_checklist", entity_id=checklist.id,
            action="checklist_update", field="notes",
            old_value=before_notes, new_value=notes,
            **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
        )
    db.commit()
    db.refresh(checklist)
    return checklist


def _known_mentions(db: Session, mentions: list[str]) -> list[str]:
    """The mentioned ids that name a real, reachable account.

    A mention arrives from a client that held its user list at render time, and
    that list goes stale: the account is deactivated, or the id was simply
    malformed. Writing it through would put a non-existent id in the comment's
    mention list and in ``notification.user_id``, which is a NOT NULL foreign
    key — so the comment was rejected outright and the whole conversation lost,
    over an id nobody could have typed. An id that names nobody is dropped from
    both places instead; the comment itself is kept, because the words are the
    part that matters.
    """
    unique = [m for m in dict.fromkeys(mentions) if m]
    if not unique:
        return []
    rows = db.execute(
        select(User.id).where(
            User.id.in_(unique),
            User.is_deleted.is_(False),
            User.status == UserStatus.ACTIVE,
        )
    ).scalars().all()
    known = set(rows)
    # Compared against the requested order so the stored list reads as written.
    return [m for m in unique if m in known]


def add_comment(
    db: Session, *, item_id: str | None, instance_id: str | None, body: str,
    mentions: list[str], kind: str, actor: User, ctx: dict,
) -> Comment:
    mentions = _known_mentions(db, mentions)
    comment = Comment(
        item_id=item_id, instance_id=instance_id, user_id=actor.id,
        body=body, mentions=mentions, kind=kind, created_by=actor.id,
    )
    db.add(comment)
    db.flush()

    for user_id in mentions:
        notifications.notify(
            db, user_id=user_id, title=f"{actor.name} mentioned you",
            body=body[:280], link=f"/items/{item_id}" if item_id else None,
            severity="info", category="mention",
        )

    audit.write_audit(
        db, entity_type="comment", entity_id=comment.id, action="create",
        new_value=body[:500], reason=None,
        **{k: ctx.get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(comment)
    return comment


def build_timeline(db: Session, item_id: str) -> list[dict]:
    """AT-02: status changes, comments, uploads, reminders and escalations in one feed."""
    from app.domain.dates import format_ist
    from app.models.reminders import EscalationLog, ReminderLog

    entries: list[dict] = []

    instance_ids = [
        r for r in db.execute(
            select(ComplianceInstance.id).where(ComplianceInstance.item_id == item_id)
        ).scalars().all()
    ]

    audit_rows = db.execute(
        select(audit.AuditLog).where(
            ((audit.AuditLog.entity_type == "compliance_item")
             & (audit.AuditLog.entity_id == item_id))
            | ((audit.AuditLog.entity_type == "compliance_instance")
               & (audit.AuditLog.entity_id.in_(instance_ids or ["-"]))),
        ).order_by(audit.AuditLog.ts_utc.desc()).limit(200)
    ).scalars().all()

    for row in audit_rows:
        entries.append({
            "ts": row.ts_utc,
            "ts_display": row.ts_ist,
            "kind": row.action,
            "title": _timeline_title(row),
            "detail": row.reason,
            "actor": row.user_email,
            "severity": _severity_for(row.action),
        })

    comments = db.execute(
        select(Comment).where(
            Comment.item_id == item_id, Comment.is_deleted.is_(False)
        ).order_by(Comment.created_at.desc()).limit(100)
    ).scalars().all()
    for comment in comments:
        author = db.get(User, comment.user_id) if comment.user_id else None
        entries.append({
            "ts": comment.created_at,
            "ts_display": format_ist(comment.created_at),
            "kind": "comment",
            "title": f"{author.name if author else 'System'} commented",
            "detail": comment.body,
            "actor": author.email if author else None,
            "severity": "info",
        })

    documents = db.execute(
        select(Document).where(
            Document.item_id == item_id, Document.is_deleted.is_(False)
        ).order_by(Document.created_at.desc()).limit(100)
    ).scalars().all()
    for doc in documents:
        uploader = db.get(User, doc.created_by) if doc.created_by else None
        entries.append({
            "ts": doc.created_at,
            "ts_display": format_ist(doc.created_at),
            "kind": "document",
            "title": f"{doc.doc_type} v{doc.version_no} uploaded — {doc.title}",
            "detail": doc.change_note,
            "actor": uploader.email if uploader else None,
            "severity": "info",
        })

    if instance_ids:
        reminder_rows = db.execute(
            select(ReminderLog).where(ReminderLog.instance_id.in_(instance_ids))
            .order_by(ReminderLog.scheduled_at.desc()).limit(100)
        ).scalars().all()
        for reminder in reminder_rows:
            entries.append({
                "ts": reminder.sent_at or reminder.scheduled_at,
                "ts_display": format_ist(reminder.sent_at or reminder.scheduled_at),
                "kind": "reminder",
                "title": f"Reminder {reminder.offset} ({reminder.channel}) — {reminder.status}",
                "detail": reminder.subject,
                "actor": reminder.recipient_address,
                "severity": "warn" if reminder.is_post_expiry else "info",
            })

        escalation_rows = db.execute(
            select(EscalationLog).where(EscalationLog.instance_id.in_(instance_ids))
            .order_by(EscalationLog.triggered_at.desc()).limit(50)
        ).scalars().all()
        for escalation in escalation_rows:
            entries.append({
                "ts": escalation.triggered_at,
                "ts_display": format_ist(escalation.triggered_at),
                "kind": "escalation",
                "title": f"Escalated to level {escalation.level}",
                "detail": escalation.outcome,
                "actor": None,
                "severity": "danger" if escalation.level >= 3 else "warn",
            })

    entries.sort(key=lambda e: e["ts"], reverse=True)
    return entries


def _timeline_title(row) -> str:
    return {
        "create": "Item created",
        "update": "Details updated",
        "status_change": f"Status changed {row.old_value} → {row.new_value}",
        "archive": "Item archived",
        "restore": "Item restored",
        "reassign": "Owner reassigned",
        "bulk_edit": "Bulk edit applied",
        "rolled_forward": "Next cycle created",
        "verify_approve": "Renewal verified",
        "verify_reject": "Renewal rejected",
        "checklist_update": "Checklist updated",
    }.get(row.action, row.action.replace("_", " ").title())


def _severity_for(action: str) -> str:
    if action in ("archive", "verify_reject"):
        return "danger"
    if action in ("status_change", "reassign", "rolled_forward"):
        return "warn"
    return "info"
