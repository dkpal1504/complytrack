"""Reminder & escalation engine administration (RM-01..RM-11, EX-01..EX-10)."""

from __future__ import annotations

from datetime import datetime
from email import policy
from email.parser import BytesParser
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select

from app.api.common import (
    CurrentUser,
    DbSession,
    bad_request,
    conflict,
    context_from,
    not_found,
)
from app.core.config import settings
from app.core.deps import Context, require
from app.core.rbac import Permission
from app.db.types import utcnow
from app.domain import escalation as escalation_rules
from app.models.org import Setting
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
    MailConfigUpdate,
    ReminderProfileCreate,
    ReminderProfileUpdate,
    TestEmailRequest,
)
from app.services import audit, mail_config, notifications, reminders

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
        "smtp_configured": mail_config.resolve(db).configured,
        "directory": str(path),
        "count": len(files),
        "files": files,
    }


# --------------------------------------------------------------------------- #
# Mail configuration (SMTP)
# --------------------------------------------------------------------------- #
#: A spooled message is a small text file. Anything larger is not one of ours.
MAX_OUTBOX_BYTES = 5 * 1024 * 1024

#: Request field name to settings-table key. They differ for the from-address,
#: which the mailer has always called ``smtp_from`` while the screen calls it a
#: sender — the stored key has to stay the one the mailer reads.
MAIL_FIELD_KEYS = {
    "host": "smtp_host",
    "port": "smtp_port",
    "user": "smtp_user",
    "password": "smtp_password",
    "sender": "smtp_from",
    "use_tls": "smtp_use_tls",
    "use_ssl": "smtp_use_ssl",
}


def _mail_dict(cfg: mail_config.MailConfig) -> dict:
    """The mail configuration as the settings screen needs it.

    The password is reported only as a boolean. It is the one value this API
    must never hand back, so there is no code path here that could.
    """
    return {
        "host": cfg.host,
        "port": cfg.port,
        "user": cfg.user,
        "sender": cfg.sender,
        "use_tls": cfg.use_tls,
        "use_ssl": cfg.use_ssl,
        "password_set": cfg.password_set,
        "source": cfg.source,
        "read_only": cfg.read_only,
        "smtp_configured": cfg.configured,
        "outbox_dir": str(settings.mail_outbox_dir),
    }


def _write_setting(db: DbSession, key: str, value: object, user: User) -> bool:
    """Store one settings key. Returns True when the row was newly created."""
    setting = db.execute(select(Setting).where(Setting.key == key)).scalar_one_or_none()
    created = setting is None
    if setting is None:
        setting = Setting(key=key, created_by=user.id)
    else:
        # A key that was soft-deleted comes back rather than colliding with the
        # unique index.
        setting.is_deleted = False
        setting.deleted_at = None
    setting.value = value
    setting.updated_by = user.id
    db.add(setting)
    db.flush()
    return created


@router.get("/mail", summary="Effective SMTP configuration and where it came from")
def read_mail_config(
    db: DbSession, user: User = Depends(require(Permission.MANAGE_SETTINGS))
) -> dict:
    return _mail_dict(mail_config.resolve(db))


@router.put("/mail", summary="Store SMTP settings used when the environment is silent")
def update_mail_config(
    payload: MailConfigUpdate,
    request: Request,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_SETTINGS)),
) -> dict:
    """Save the mail settings the app should use.

    Refused outright when the environment already sets SMTP_HOST: that is a
    deployment decision, and silently shadowing it from a web form is how a
    working relay gets broken without anyone noticing.
    """
    if mail_config.resolve(db).read_only:
        raise conflict(
            "SMTP is configured from the environment (SMTP_HOST), so the stored "
            "settings are ignored. Change it in the deployment configuration."
        )

    fields = payload.model_dump(exclude_unset=True)
    if fields.get("use_ssl") and fields.get("use_tls"):
        raise bad_request(
            "STARTTLS and implicit SSL cannot both be used. Choose one."
        )

    # The password is deliberately kept out of the audit payload. ``changes`` is
    # serialised verbatim — REDACTED_FIELDS only guards field/old_value/new_value
    # — so it must never be given the value in the first place.
    changed: dict[str, object] = {}
    password_changed = False
    for name, value in fields.items():
        if name == "password":
            password_changed = value is not None
            if not password_changed:
                continue
        _write_setting(db, MAIL_FIELD_KEYS[name], value, user)
        changed[name] = "***redacted***" if name == "password" else value

    audit.write_audit(
        db,
        entity_type="setting",
        entity_id="smtp",
        action="update",
        new_value=None,
        changes={**changed, **({"password": "***redacted***"} if password_changed else {})},
        reason="Updated SMTP mail settings.",
        **context_from(request, user),
    )
    db.commit()
    return _mail_dict(mail_config.resolve(db))


def _test_email_html(cfg: mail_config.MailConfig) -> str:
    if cfg.configured:
        detail = (
            f"Delivered through <strong>{cfg.host}:{cfg.port}</strong> using "
            f"{'implicit TLS' if cfg.use_ssl else ('STARTTLS' if cfg.use_tls else 'no encryption')}."
        )
    else:
        detail = (
            "No mail server is configured, so this message was written to the "
            "outbox on the server instead of being sent."
        )
    return (
        "<p>This is a test message from ComplyTrack.</p>"
        f"<p>{detail}</p>"
        "<p>If you are reading it, reminder e-mails will reach their recipients "
        "the same way.</p>"
    )


@router.post("/test-email", summary="Send one test message and report what happened")
def send_test_email(
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_SETTINGS)),
    payload: TestEmailRequest | None = None,
) -> dict:
    """Prove the mail settings, rather than waiting for a reminder to fail.

    Answers 200 either way and carries the outcome, because a refused password
    is an ordinary result to show the operator, not a server fault.
    """
    cfg = mail_config.resolve(db)
    recipient = (payload.to if payload and payload.to else None) or user.email
    if not recipient:
        raise bad_request("Your account has no e-mail address to send the test to.")

    result = notifications.deliver_email(
        to=recipient,
        subject="[ComplyTrack] Test e-mail",
        html=_test_email_html(cfg),
        db=db,
    )
    return {
        "ok": result.ok,
        "detail": result.detail,
        "mode": cfg.mode,
        "to": recipient,
    }


def _safe_outbox_file(name: str) -> Path:
    """Resolve one spooled message, refusing anything outside the outbox.

    ``name`` arrives from the URL, so it is untrusted. Rejecting any name that is
    not already a bare filename disposes of ``..``, sub-paths, drive letters and
    UNC paths in one test; resolving both sides then also defeats a symlink
    planted inside the outbox.
    """
    if (
        not name
        or name != Path(name).name
        or Path(name).is_absolute()
        or name.startswith(".")
        or not name.lower().endswith(".eml")
    ):
        raise not_found("Outbox message")

    root = settings.mail_outbox_dir.resolve()
    candidate = (root / name).resolve()
    if candidate.parent != root or not candidate.is_file():
        raise not_found("Outbox message")
    if candidate.stat().st_size > MAX_OUTBOX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That outbox message is too large to display.",
        )
    return candidate


@router.get("/outbox/{name}", summary="Read one spooled e-mail")
def read_outbox_message(
    name: str, db: DbSession, user: User = Depends(require(Permission.MANAGE_SETTINGS))
) -> dict:
    """The message the engine would have sent, so a tester can read it.

    Declared after ``/outbox`` on purpose: FastAPI matches routes in order, and
    this path segment would otherwise swallow the listing.
    """
    path = _safe_outbox_file(name)
    try:
        # policy.default decodes the headers and splits the MIME parts for us.
        message = BytesParser(policy=policy.default).parsebytes(path.read_bytes())
    except Exception as exc:  # noqa: BLE001 — a corrupt spool file is not a crash
        raise bad_request(f"That outbox message could not be read: {exc}") from exc

    def body(subtype: str) -> str | None:
        part = message.get_body(preferencelist=(subtype,))
        if part is None:
            return None
        try:
            return part.get_content()
        except Exception:  # noqa: BLE001 — fall back to the raw payload
            return part.get_payload(decode=True).decode("utf-8", "replace")

    stat = path.stat()
    return {
        "name": path.name,
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime),
        "to": message.get("To"),
        "from": message.get("From"),
        "subject": message.get("Subject"),
        "date": message.get("Date"),
        "text": body("plain"),
        "html": body("html"),
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
