"""Reminder & escalation engine administration (RM-01..RM-11, EX-01..EX-10)."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from app.api.common import CurrentUser, DbSession, context_from, not_found
from app.core.deps import Context, require
from app.core.rbac import Permission
from app.db.types import utcnow
from app.domain import escalation as escalation_rules
from app.models.reminders import (
    EmailTemplate,
    EscalationLog,
    EscalationProfile,
    EscalationRule,
    JobRun,
    ReminderLog,
    ReminderProfile,
)
from app.schemas.reminders import (
    EmailTemplateUpdate,
    ReminderProfileCreate,
    ReminderProfileUpdate,
)
from app.services import audit, notifications, reminders

router = APIRouter(prefix="/reminders", tags=["Reminder engine"])

MANAGE = Permission.CONFIGURE_ENGINE
READ = Permission.VIEW_DASHBOARD_ALL


# --------------------------------------------------------------------------- #
# Profiles
# --------------------------------------------------------------------------- #
@router.get("/profiles", summary="Reminder profiles")
def list_profiles(
    db: DbSession, user: User = Depends(require(READ))
) -> list[dict]:
    rows = db.execute(
        select(ReminderProfile).where(ReminderProfile.is_deleted.is_(False))
        .order_by(ReminderProfile.name)
    ).scalars().all()
    return [_profile(p) for p in rows]


@router.post("/profiles", status_code=201, summary="Create a reminder profile")
def create_profile(
    payload: ReminderProfileCreate, request: Request, db: DbSession,
    user: User = Depends(require(MANAGE)),
) -> dict:
    profile = ReminderProfile(**payload.model_dump())
    profile.offsets = sorted(set(profile.offsets or []), reverse=True)
    profile.created_by = user.id
    db.add(profile)
    audit.write_audit(
        db, entity_type="reminder_profile", entity_id=profile.id, action="create",
        new_value={"name": profile.name, "offsets": profile.offsets},
        **{k: (context_from(request, user)).get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(profile)
    return _profile(profile)


@router.patch("/profiles/{profile_id}", summary="Edit a reminder profile")
def update_profile(
    profile_id: str, payload: ReminderProfileUpdate, request: Request, db: DbSession,
    user: User = Depends(require(MANAGE)),
) -> dict:
    profile = db.get(ReminderProfile, profile_id)
    if profile is None or profile.is_deleted:
        raise not_found("Reminder profile")
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("offsets") is not None:
        changes["offsets"] = sorted(set(changes["offsets"]), reverse=True)
    before = {k: getattr(profile, k, None) for k in changes}
    for key, value in changes.items():
        setattr(profile, key, value)
    profile.updated_by = user.id
    db.add(profile)
    audit.write_audit(
        db, entity_type="reminder_profile", entity_id=profile.id, action="update",
        changes=audit.diff_entity(
            {k: str(v) for k, v in before.items()},
            {k: str(getattr(profile, k, None)) for k in changes},
        ),
        **{k: (context_from(request, user)).get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(profile)
    return _profile(profile)


# --------------------------------------------------------------------------- #
# Escalation matrix
# --------------------------------------------------------------------------- #
@router.get("/escalation-matrix", summary="Escalation ladder with the live rule set (EX-01)")
def escalation_matrix(
    db: DbSession, user: User = Depends(require(READ))
) -> dict:
    profiles = db.execute(
        select(EscalationProfile).where(EscalationProfile.is_deleted.is_(False))
    ).scalars().all()
    out = []
    for profile in profiles:
        rules = db.execute(
            select(EscalationRule)
            .where(EscalationRule.profile_id == profile.id,
                   EscalationRule.is_deleted.is_(False))
            .order_by(EscalationRule.level)
        ).scalars().all()
        out.append({
            "id": profile.id,
            "name": profile.name,
            "criticality": profile.criticality,
            "is_default": profile.is_default,
            "rules": [
                {
                    "id": r.id, "level": r.level,
                    "label": escalation_rules.level_label(r.level),
                    "trigger_days": r.trigger_days,
                    "trigger_direction": r.trigger_direction,
                    "status_condition": r.status_condition or [],
                    "notify_roles": r.notify_roles or [],
                    "notify_extra": r.notify_extra or [],
                    "channels": r.channels or [],
                    "message": r.message,
                }
                for r in rules
            ],
        })
    return {
        "profiles": out,
        "levels": [
            {
                "level": lvl.level,
                "label": lvl.label,
                "trigger_days": lvl.trigger_days,
                "trigger_direction": lvl.trigger_direction,
                "status_condition": list(lvl.status_condition),
                "notify_roles": list(lvl.notify_roles),
            }
            for lvl in escalation_rules.DEFAULT_MATRIX
        ],
    }


# --------------------------------------------------------------------------- #
# Delivery logs
# --------------------------------------------------------------------------- #
@router.get("/log", summary="Reminder delivery log with filters")
def reminder_log(
    db: DbSession,
    user: User = Depends(require(READ)),
    instance_id: str | None = None,
    status_value: str | None = Query(None, alias="status"),
    channel: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = select(ReminderLog)
    if instance_id:
        stmt = stmt.where(ReminderLog.instance_id == instance_id)
    if status_value:
        stmt = stmt.where(ReminderLog.status == status_value)
    if channel:
        stmt = stmt.where(ReminderLog.channel == channel)

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(
        stmt.order_by(ReminderLog.scheduled_at.desc()).limit(limit).offset(offset)
    ).scalars().all()
    return {
        "total": total,
        "rows": [
            {
                "id": r.id, "instance_id": r.instance_id, "item_id": r.item_id,
                "offset": r.offset, "is_post_expiry": r.is_post_expiry,
                "channel": r.channel, "recipient": r.recipient_address,
                "recipient_id": r.recipient_id, "subject": r.subject,
                "status": r.status, "error": r.error, "sent_at": r.sent_at,
                "scheduled_at": r.scheduled_at, "read_at": r.read_at,
                "retry_count": r.retry_count, "dedupe_key": r.dedupe_key,
            }
            for r in rows
        ],
    }


@router.get("/escalation-log", summary="Escalation history (EX-08)")
def escalation_log(
    db: DbSession,
    user: User = Depends(require(READ)),
    instance_id: str | None = None,
    level: int | None = None,
    limit: int = Query(100, ge=1, le=1000),
) -> list[dict]:
    stmt = select(EscalationLog).where(EscalationLog.is_deleted.is_(False))
    if instance_id:
        stmt = stmt.where(EscalationLog.instance_id == instance_id)
    if level is not None:
        stmt = stmt.where(EscalationLog.level == level)
    rows = db.execute(
        stmt.order_by(EscalationLog.triggered_at.desc()).limit(limit)
    ).scalars().all()
    return [
        {
            "id": r.id, "instance_id": r.instance_id, "level": r.level,
            "label": escalation_rules.level_label(r.level),
            "notified_to": r.notified_to or [],
            "triggered_at": r.triggered_at,
            "acknowledged_at": r.acknowledged_at,
            "acknowledged_by": r.acknowledged_by,
            "outcome": r.outcome,
        }
        for r in rows
    ]


@router.post("/escalations/{log_id}/acknowledge", summary="Acknowledge an escalation (EX-08)")
def acknowledge_escalation(
    log_id: str, request: Request, db: DbSession,
    outcome: str = Query(..., min_length=3),
    user: User = Depends(require(READ)),
) -> dict:
    row = db.get(EscalationLog, log_id)
    if row is None:
        raise not_found("Escalation")
    row.acknowledged_at = utcnow()
    row.acknowledged_by = user.id
    row.outcome = outcome
    db.add(row)
    audit.write_audit(
        db, entity_type="escalation_log", entity_id=row.id, action="acknowledge",
        new_value={"outcome": outcome},
        **{k: (context_from(request, user)).get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    return {"detail": "Escalation acknowledged.", "acknowledged_at": row.acknowledged_at}


@router.post("/retry-failed", summary="Re-send reminders that previously failed")
def retry_failed(
    db: DbSession, user: User = Depends(require(MANAGE))
) -> dict:
    sent = reminders.retry_failed(db)
    return {"detail": f"{sent} reminder(s) re-sent.", "sent": sent}


# --------------------------------------------------------------------------- #
# Manual run, jobs and outbox
# --------------------------------------------------------------------------- #
@router.post("/run", summary="Run the daily reminder job now (RM-11 idempotent)")
def run_now(
    db: DbSession,
    user: User = Depends(require(MANAGE)),
    at: datetime | None = None,
) -> dict:
    """Re-running the same day never duplicates a reminder or an escalation."""
    return reminders.run_daily_reminders(db, now=at, commit=True)


@router.get("/jobs", summary="Scheduler job history (heartbeat)")
def job_history(
    db: DbSession,
    user: User = Depends(require(Permission.VIEW_AUDIT)),
    limit: int = Query(50, ge=1, le=500),
) -> list[dict]:
    rows = db.execute(
        select(JobRun).order_by(JobRun.started_at.desc()).limit(limit)
    ).scalars().all()
    return [
        {
            "id": r.id, "job_name": r.job_name, "started_at": r.started_at,
            "finished_at": r.finished_at, "status": r.status, "stats": r.stats or {},
        }
        for r in rows
    ]


@router.get("/outbox", summary="E-mails spooled while SMTP is unconfigured")
def outbox(
    db: DbSession, user: User = Depends(require(Permission.MANAGE_SETTINGS))
) -> dict:
    from app.core.config import settings

    path = settings.mail_outbox_dir
    files = []
    if path.exists():
        for f in sorted(path.glob("*.eml"), reverse=True)[:200]:
            stat = f.stat()
            files.append({
                "name": f.name,
                "size_bytes": stat.st_size,
                "modified_at": datetime.fromtimestamp(stat.st_mtime),
            })
    return {
        "smtp_configured": bool(settings.smtp_host),
        "directory": str(path),
        "count": len(files),
        "files": files,
    }


# --------------------------------------------------------------------------- #
# E-mail templates
# --------------------------------------------------------------------------- #
@router.get("/templates", summary="Reminder and escalation e-mail templates")
def list_email_templates(
    db: DbSession, user: User = Depends(require(Permission.MANAGE_TEMPLATES))
) -> list[dict]:
    rows = db.execute(
        select(EmailTemplate).where(EmailTemplate.is_deleted.is_(False))
        .order_by(EmailTemplate.code)
    ).scalars().all()
    placeholders = sorted(notifications.DEFAULT_PLACEHOLDERS)
    return [
        {
            "id": t.id, "code": t.code, "name": t.name, "subject": t.subject,
            "body_html": t.body_html, "body_text": t.body_text,
            "channel": t.channel, "language": t.language,
            "placeholders": placeholders,
        }
        for t in rows
    ]


@router.patch("/templates/{template_id}", summary="Edit an e-mail template")
def update_email_template(
    template_id: str, payload: EmailTemplateUpdate, request: Request, db: DbSession,
    user: User = Depends(require(Permission.MANAGE_TEMPLATES)),
) -> dict:
    template = db.get(EmailTemplate, template_id)
    if template is None or template.is_deleted:
        raise not_found("E-mail template")
    changes = payload.model_dump(exclude_unset=True)
    before = {k: getattr(template, k, None) for k in changes}
    for key, value in changes.items():
        setattr(template, key, value)
    template.updated_by = user.id
    db.add(template)
    audit.write_audit(
        db, entity_type="email_template", entity_id=template.id, action="update",
        changes=audit.diff_entity(
            {k: str(v) for k, v in before.items()},
            {k: str(getattr(template, k, None)) for k in changes},
        ),
        **{k: (context_from(request, user)).get(k) for k in ("user_id", "user_email", "ip", "user_agent")},
    )
    db.commit()
    db.refresh(template)
    return {
        "id": template.id, "code": template.code, "subject": template.subject,
        "body_html": template.body_html, "body_text": template.body_text,
    }


def _profile(p: ReminderProfile) -> dict:
    return {
        "id": p.id, "name": p.name,
        "offsets": p.offsets or [], "channels": p.channels or [],
        "recipients_by_offset": p.recipients_by_offset or {},
        "post_expiry_frequency_days": p.post_expiry_frequency_days,
        "anchor_on": p.anchor_on, "quiet_hours_exempt": p.quiet_hours_exempt,
        "is_default": p.is_default,
    }
