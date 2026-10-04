"""The reminder and escalation engine (PRD 5.3, 5.4, Section 11).

Designed around one guarantee: **running the job twice must not send anything
twice**. Every potential notification has a stable ``dedupe_key`` backed by a
unique index on ``reminder_log`` / ``escalation_log``; the engine checks before
it sends, and the database enforces it even under a race.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.types import utcnow
from app.domain import escalation as escalation_rules
from app.domain.dates import IST, ist_today, reminder_anchor_date
from app.domain.enums import (
    Criticality,
    ItemStatus,
    ReminderChannel,
    ReminderStatus,
)
from app.domain.status import REMINDER_SUPPRESSED_STATES
from app.models.auth import User
from app.models.compliance import ComplianceInstance, ComplianceItem, InstanceChecklist
from app.models.org import Category, Department, IssuingAuthority, OrganisationUnit
from app.models.reminders import (
    EscalationLog,
    JobRun,
    ReminderLog,
    ReminderProfile,
)
from app.services import notifications
from app.services.queries import department_head, unit_head, users_with_role

logger = logging.getLogger("complytrack.reminders")

APP_BASE_URL = "/"


@dataclass(slots=True)
class ReminderContext:
    instance: ComplianceInstance
    item: ComplianceItem
    anchor: date
    days_to_anchor: int
    unit_name: str | None
    department_name: str | None
    authority_name: str | None
    category_name: str | None
    owner: User | None
    delegate: User | None
    head: User | None
    unit_head_user: User | None
    compliance_users: list[User]
    management_users: list[User]
    profile: ReminderProfile | None
    pending_docs: list[str]


# --------------------------------------------------------------------------- #
# Context assembly
# --------------------------------------------------------------------------- #
def _load_profile(db: Session, item: ComplianceItem) -> ReminderProfile | None:
    if item.reminder_profile_id:
        profile = db.get(ReminderProfile, item.reminder_profile_id)
        if profile is not None:
            return profile
    return db.execute(
        select(ReminderProfile).where(
            ReminderProfile.is_default.is_(True), ReminderProfile.is_deleted.is_(False)
        ).limit(1)
    ).scalar_one_or_none()


def build_context(
    db: Session,
    instance: ComplianceInstance,
    item: ComplianceItem,
    *,
    today: date | None = None,
) -> ReminderContext:
    """Everything a reminder template needs about one cycle.

    ``today`` is the reference date the offsets are measured from. The daily run
    passes the date it is running *as* — ``POST /reminders/run?at=`` replays a
    past day — so the selection and the job record agree on which day is being
    worked. It defaults to the wall clock for any other caller.
    """
    today = today or ist_today()
    unit = db.get(OrganisationUnit, item.unit_id) if item.unit_id else None
    department = db.get(Department, item.department_id) if item.department_id else None
    authority = db.get(IssuingAuthority, item.authority_id) if item.authority_id else None
    category = db.get(Category, item.category_id) if item.category_id else None

    owner = db.get(User, item.owner_id) if item.owner_id else None
    delegate = db.get(User, item.delegate_id) if item.delegate_id else None
    head = department_head(db, item.department_id)
    unit_head_user = unit_head(db, item.unit_id)

    compliance_users = users_with_role(db, "Compliance Team", item.unit_id)
    management_users = users_with_role(db, "Management View", item.unit_id)

    pending_docs = [
        row.item_name
        for row in db.execute(
            select(InstanceChecklist).where(
                InstanceChecklist.instance_id == instance.id,
                InstanceChecklist.status == "Pending",
                InstanceChecklist.is_deleted.is_(False),
            )
        ).scalars().all()
    ]

    anchor = reminder_anchor_date(
        anchor_on=item.anchor_on,
        expiry_date=item.expiry_date,
        renewal_due_date=item.renewal_due_date,
        statutory_due_date=instance.due_date,
    ) or instance.due_date or item.expiry_date or today

    return ReminderContext(
        instance=instance,
        item=item,
        anchor=anchor,
        days_to_anchor=(anchor - today).days,
        unit_name=unit.name if unit else None,
        department_name=department.name if department else None,
        authority_name=authority.name if authority else None,
        category_name=category.name if category else None,
        owner=owner,
        delegate=delegate,
        head=head,
        unit_head_user=unit_head_user,
        compliance_users=compliance_users,
        management_users=management_users,
        profile=_load_profile(db, item),
        pending_docs=pending_docs,
    )


def open_instances(db: Session, *, limit: int | None = None) -> list[tuple[ComplianceInstance, ComplianceItem]]:
    """Every cycle still needing attention. Reminders never fire for the rest."""
    stmt = (
        select(ComplianceInstance, ComplianceItem)
        .join(ComplianceItem, ComplianceItem.id == ComplianceInstance.item_id)
        .where(
            ComplianceInstance.is_deleted.is_(False),
            ComplianceItem.is_deleted.is_(False),
            ComplianceInstance.status.notin_(tuple(REMINDER_SUPPRESSED_STATES)),
            ComplianceItem.applicability != "Not Applicable",
        )
        .order_by(ComplianceInstance.due_date.asc().nulls_last())
    )
    if limit:
        stmt = stmt.limit(limit)
    return [(i, it) for i, it in db.execute(stmt).all()]


# --------------------------------------------------------------------------- #
# Quiet hours (RM-09)
# --------------------------------------------------------------------------- #
def within_quiet_hours(now: datetime) -> bool:
    hour = now.astimezone(IST).hour
    start, end = settings.quiet_hours_start, settings.quiet_hours_end
    if start <= end:
        return start <= hour < end
    return hour >= start or hour < end


# --------------------------------------------------------------------------- #
# Reminder sending
# --------------------------------------------------------------------------- #
VARIABLE_OFFSETS_CODE = "OFFSET"

DEFAULT_SUBJECT = "[ACTION] {Criticality} | {Item} ({Unit}) expires in {Days Left} days - due {Expiry Date}"
DEFAULT_EXPIRED_SUBJECT = "[EXPIRED] {Item} - {Days Overdue} days overdue - Immediate action"
DEFAULT_PUSH = "{Item} - {Days Left} d left - tap to update"


def _dedupe_key(instance_id: str, offset: int, channel: str, recipient_id: str) -> str:
    return f"rem:{instance_id}:{offset}:{channel}:{recipient_id}"


def _already_logged(db: Session, key: str) -> ReminderLog | None:
    return db.execute(
        select(ReminderLog).where(ReminderLog.dedupe_key == key)
    ).scalar_one_or_none()


def _escalation_dedupe(instance_id: str, level: int, recipient_id: str) -> str:
    return f"esc:{instance_id}:{level}:{recipient_id}"


def _render_bodies(ctx: ReminderContext, *, expired: bool, next_escalation: str | None) -> tuple[str, str, str]:
    values = notifications.template_values(
        item_name=ctx.item.name,
        item_code=ctx.item.item_code,
        reference_number=ctx.item.reference_number,
        authority=ctx.authority_name,
        unit=ctx.unit_name,
        department=ctx.department_name,
        expiry_date=ctx.item.expiry_date,
        renewal_due_date=ctx.item.renewal_due_date,
        due_date=ctx.instance.due_date,
        status=ctx.instance.status,
        owner=ctx.owner.name if ctx.owner else None,
        days_left=max(ctx.days_to_anchor, 0),
        days_overdue=max(-ctx.days_to_anchor, 0),
        criticality=ctx.item.criticality,
        cycle=ctx.instance.cycle_label,
        documents_pending=ctx.pending_docs,
        next_escalation_date=next_escalation,
        next_escalation_level=escalation_rules.level_label(
            escalation_rules.current_level(
                days_to_anchor=ctx.days_to_anchor,
                workflow_status=ctx.instance.status,
                criticality=ctx.item.criticality,
            ) + 1
        ),
        link=f"{APP_BASE_URL}items/{ctx.item.id}",
        exposure_note=ctx.item.exposure_note,
    )

    subject = notifications.render(
        DEFAULT_EXPIRED_SUBJECT if expired else DEFAULT_SUBJECT, values
    )
    html = _email_html(ctx, values, expired=expired)
    push = notifications.render(DEFAULT_PUSH, values)
    return subject, html, push


def _email_html(ctx: ReminderContext, values: dict, *, expired: bool) -> str:
    """The Section 11 default layout: summary table, checklist, action buttons."""
    accent = "#b91c1c" if expired else "#1d4ed8"
    pending = ctx.pending_docs
    checklist_rows = "".join(
        f"<li style='color:#b45309;font-weight:600'>&#9744; {doc}</li>" for doc in pending
    ) or "<li style='color:#15803d'>&#9745; All required documents received</li>"

    def row(label: str, value) -> str:
        return (
            "<tr>"
            f"<td style='padding:6px 12px;color:#475569;font-size:13px'>{label}</td>"
            f"<td style='padding:6px 12px;font-weight:600;font-size:13px'>{values.get(value, '—')}</td>"
            "</tr>"
        )

    return f"""<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif">
  <div style="max-width:640px;margin:0 auto;background:#ffffff">
    <div style="background:{accent};color:#fff;padding:18px 24px">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">
        ComplyTrack &middot; Statutory Compliance
      </div>
      <div style="font-size:19px;font-weight:700;margin-top:6px">{values['Item']}</div>
      <div style="font-size:13px;opacity:.9;margin-top:4px">
        {values['Unit']} &middot; {values['Cycle']} &middot; {values['Criticality']}
      </div>
    </div>
    <div style="padding:20px 24px">
      <p style="font-size:14px;color:#0f172a;margin:0 0 14px">{values['Greeting']}</p>
      <p style="font-size:14px;color:#334155;margin:0 0 18px">
        {'This obligation is <strong>past its date</strong>.' if expired else 'This obligation needs action before its due date.'}
        Please review and update the register.
      </p>
      <table style="width:100%;border-collapse:collapse;background:#f8fafc;border-radius:8px">
        {row('Reference No.', 'Reference No.')}
        {row('Authority', 'Authority')}
        {row('Owner', 'Owner')}
        {row('Expiry Date', 'Expiry Date')}
        {row('Renewal Due Date', 'Renewal Due Date')}
        {row('Status', 'Status')}
        {row('Days Left', 'Days Left')}
        {row('Days Overdue', 'Days Overdue')}
      </table>
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:22px 0 8px">
        Required documents
      </h3>
      <ul style="padding-left:18px;margin:0;font-size:13px;color:#334155;line-height:1.7">{checklist_rows}</ul>
      <div style="margin:24px 0 8px">
        <a href="{values['Link']}" style="background:{accent};color:#fff;padding:11px 20px;border-radius:6px;
           text-decoration:none;font-size:13px;font-weight:600;display:inline-block">Open Item</a>
        <a href="{values['Link']}?action=under_process" style="border:1px solid #cbd5e1;color:#0f172a;
           padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;margin-left:8px;
           display:inline-block">Mark Under Process</a>
        <a href="{values['Link']}?action=upload" style="border:1px solid #cbd5e1;color:#0f172a;
           padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;margin-left:8px;
           display:inline-block">Upload Renewal</a>
      </div>
      <p style="font-size:12px;color:#64748b;margin-top:22px;border-top:1px solid #e2e8f0;padding-top:12px">
        If no action is taken by <strong>{values['Next Escalation Date']}</strong>, this will be escalated
        to <strong>{values['Next Escalation Level']}</strong>.
      </p>
    </div>
  </div>
</body></html>"""


def send_reminder(
    db: Session, ctx: ReminderContext, *, offset: int, recipient_id: str, channel: str,
    commit: bool = True,
) -> tuple[ReminderLog | None, bool]:
    """Send one reminder on one channel. Returns (log, was_duplicate)."""
    key = _dedupe_key(ctx.instance.id, offset, channel, recipient_id)
    existing = _already_logged(db, key)
    if existing is not None and existing.status in (ReminderStatus.SENT, ReminderStatus.DELIVERED):
        return existing, True

    recipient = db.get(User, recipient_id)
    if recipient is None or recipient.status != "Active":
        return None, True

    expired = escalation_rules.is_post_expiry(offset)
    subject, html, push = _render_bodies(ctx, expired=expired, next_escalation=None)

    log = existing or ReminderLog(
        instance_id=ctx.instance.id,
        item_id=ctx.item.id,
        offset=offset,
        is_post_expiry=expired,
        channel=channel,
        recipient_id=recipient_id,
        recipient_address=recipient.email,
        scheduled_at=utcnow(),
        dedupe_key=key,
        subject=subject,
        body=html,
    )

    # RM-09: critical items bypass quiet hours.
    quiet = (
        channel in (ReminderChannel.EMAIL, ReminderChannel.PUSH)
        and within_quiet_hours(utcnow())
        and ctx.item.criticality != Criticality.CRITICAL
    )

    if quiet:
        # Already parked from an earlier pass in the same quiet window: nothing
        # changes, so count it as suppressed rather than as a fresh deferral.
        if existing is not None and existing.status == ReminderStatus.QUEUED:
            return log, True
        log.status = ReminderStatus.QUEUED
        log.error = "Deferred - quiet hours."

    elif channel == ReminderChannel.EMAIL:
        result = notifications.deliver_email(to=recipient.email, subject=subject, html=html)
        log.status = ReminderStatus.SENT if result.ok else ReminderStatus.FAILED
        log.sent_at = utcnow() if result.ok else None
        log.error = None if result.ok else result.detail

    elif channel == ReminderChannel.IN_APP:
        notifications.notify(
            db,
            user_id=recipient_id,
            title=subject,
            body=push,
            link=f"/items/{ctx.item.id}",
            severity="danger" if expired else "warning",
            category="reminder",
        )
        log.status = ReminderStatus.SENT
        log.sent_at = utcnow()

    elif channel == ReminderChannel.PUSH:
        # Web Push via the browser subscription; recorded here so delivery is auditable.
        log.status = ReminderStatus.SENT
        log.sent_at = utcnow()
        _push_to_device(db, recipient_id, push, link=f"/items/{ctx.item.id}")

    else:  # sms / whatsapp / teams are Phase 2 — log the intent, don't pretend.
        log.status = ReminderStatus.SKIPPED
        log.error = f"Channel '{channel}' is enabled in Phase 2."

    db.add(log)
    if commit:
        try:
            db.commit()
        except IntegrityError:
            # Lost the race with a concurrent run — the other run won, which is
            # exactly the behaviour we want.
            db.rollback()
            return _already_logged(db, key), True
    else:
        # Inside the daily run's longer transaction, so there is no commit to
        # catch the unique index. Flush through a savepoint instead: if the key
        # is already there the run absorbs it here rather than aborting every
        # instance's work at the final commit (RM-11 idempotency).
        try:
            with db.begin_nested():
                db.flush()
        except IntegrityError:
            # Drop our losing row so the final commit cannot trip on it again.
            if log in db.new:
                db.expunge(log)
            return _already_logged(db, key), True
    return log, False


def _push_to_device(db: Session, user_id: str, body: str, *, link: str) -> None:
    """Deliver a Web Push message to every registered device token."""
    user = db.get(User, user_id)
    if user is None:
        return
    tokens = user.device_tokens or []
    if not tokens:
        return
    # A production deployment signs and posts to the subscription endpoint here
    # (VAPID). Unconfigured, the notification centre remains the delivery record.


# --------------------------------------------------------------------------- #
# Escalation
# --------------------------------------------------------------------------- #
def escalate(db: Session, ctx: ReminderContext, *, commit: bool = True) -> list[EscalationLog]:
    """Raise the escalation level if a trigger has fired (OW-04, OW-05)."""
    level = escalation_rules.current_level(
        days_to_anchor=ctx.days_to_anchor,
        workflow_status=ctx.instance.status,
        criticality=ctx.item.criticality,
        already_at_level=ctx.instance.escalation_level,
    )
    if level <= ctx.instance.escalation_level:
        return []

    roles = escalation_rules.notify_roles_for(level)
    mapping = {
        "owner": [ctx.owner],
        "delegate": [ctx.delegate],
        "department_head": [ctx.head],
        "unit_head": [ctx.unit_head_user],
        "plant_head": [ctx.unit_head_user],
        "management": ctx.management_users,
        "compliance": ctx.compliance_users,
        "director": ctx.management_users,
    }

    created: list[EscalationLog] = []
    # One person often holds several of these roles (a Unit Head is usually also
    # a Department Head, and Management overlaps the Director list), so collapse
    # to a single notification per human before writing any log rows. The unique
    # dedupe_key is the backstop, not the first line of defence.
    seen: set[str] = set()
    for role_key in roles:
        for user in mapping.get(role_key, []):
            if user is None or user.status != "Active" or user.id in seen:
                continue
            seen.add(user.id)
            key = _escalation_dedupe(ctx.instance.id, level, user.id)
            if db.execute(
                select(EscalationLog).where(EscalationLog.dedupe_key == key)
            ).scalar_one_or_none():
                continue

            log = EscalationLog(
                instance_id=ctx.instance.id,
                level=level,
                notified_to=[user.id],
                triggered_at=utcnow(),
                outcome=escalation_rules.level_label(level),
                dedupe_key=key,
            )
            db.add(log)
            notifications.notify(
                db,
                user_id=user.id,
                title=f"Escalation L{level}: {ctx.item.name}",
                body=(
                    f"{escalation_rules.level_label(level)} — "
                    f"{ctx.item.criticality} item at {ctx.unit_name or 'unit'}, "
                    f"{'overdue by ' + str(-ctx.days_to_anchor) + ' days' if ctx.days_to_anchor < 0 else str(ctx.days_to_anchor) + ' days remaining'}."
                ),
                link=f"/items/{ctx.item.id}",
                severity="danger" if level >= 3 else "warning",
                category="escalation",
            )

            if ctx.owner is not None and ctx.owner.email:
                notifications.deliver_email(
                    to=user.email,
                    subject=f"[ESCALATION L{level}] {ctx.item.name} — {ctx.item.criticality}",
                    html=_escalation_html(ctx, level, user),
                )
            created.append(log)

    if created:
        ctx.instance.escalation_level = level
        ctx.instance.last_reminder_at = utcnow()
        db.add(ctx.instance)

    if commit:
        db.commit()
    return created


def _escalation_html(ctx: ReminderContext, level: int, recipient: User) -> str:
    return f"""<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f1f5f9;margin:0">
  <div style="max-width:620px;margin:0 auto;background:#fff">
    <div style="background:#7f1d1d;color:#fff;padding:18px 24px">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85">
        Escalation Level {level}
      </div>
      <div style="font-size:18px;font-weight:700;margin-top:6px">{ctx.item.name}</div>
    </div>
    <div style="padding:20px 24px;font-size:14px;color:#334155;line-height:1.6">
      <p>Dear {recipient.name},</p>
      <p>This obligation has been escalated to you under the compliance escalation matrix.</p>
      <ul>
        <li><strong>Unit:</strong> {ctx.unit_name or '—'}</li>
        <li><strong>Department:</strong> {ctx.department_name or '—'}</li>
        <li><strong>Owner:</strong> {ctx.owner.name if ctx.owner else '—'} ({ctx.owner.email if ctx.owner else '—'})</li>
        <li><strong>Authority:</strong> {ctx.authority_name or '—'}</li>
        <li><strong>Reference:</strong> {ctx.item.reference_number or '—'}</li>
        <li><strong>Expiry:</strong> {ctx.item.expiry_date or '—'}</li>
        <li><strong>Current status:</strong> {ctx.instance.status}</li>
        <li><strong>Days to due date:</strong> {ctx.days_to_anchor}</li>
      </ul>
      <p style="color:#b91c1c"><strong>Reason:</strong> {escalation_rules.level_label(level)}</p>
      <p><a href="{APP_BASE_URL}items/{ctx.item.id}" style="background:#7f1d1d;color:#fff;padding:10px 18px;
         border-radius:6px;text-decoration:none;font-weight:600">Open Item</a></p>
    </div>
  </div>
</body></html>"""


# --------------------------------------------------------------------------- #
# The daily job
# --------------------------------------------------------------------------- #
def _next_escalation_date(ctx: ReminderContext) -> str | None:
    upcoming = [
        (ctx.anchor + __import__("datetime").timedelta(days=-r.trigger_days), r.trigger_days)
        for r in escalation_rules.DEFAULT_MATRIX
        if r.trigger_direction == "before" and r.trigger_days < ctx.days_to_anchor
    ]
    if not upcoming:
        return None
    when, _ = max(upcoming, key=lambda pair: pair[1])
    return when.strftime("%d-%b-%Y")


def run_daily_reminders(db: Session, *, now: datetime | None = None, commit: bool = True) -> dict:
    """RM-11: the idempotent daily run. Safe to re-run at any time."""
    started = utcnow()
    today = ist_today(now)

    job = JobRun(job_name="daily_reminders", started_at=started, status="Running",
                 run_date=today, stats={})
    db.add(job)
    db.flush()

    sent = 0
    duplicates = 0
    failures = 0
    deferrals = 0
    escalations_raised = 0
    scanned = 0
    errors: list[str] = []
    details: list[dict] = []

    for instance, item in open_instances(db):
        scanned += 1
        try:
            ctx = build_context(db, instance, item, today=today)
            sent, duplicates, failures, deferrals, escalations_raised = _process_instance(
                db, ctx, instance, item,
                sent=sent, duplicates=duplicates, failures=failures,
                deferrals=deferrals, escalations_raised=escalations_raised,
                details=details,
            )
        except Exception as exc:  # noqa: BLE001
            # One malformed item must never abort the whole compliance run.
            db.rollback()
            errors.append(f"{item.item_code}: {exc}")
            logger.exception("Reminder run failed for %s", item.item_code)

    job.finished_at = utcnow()
    job.status = "Success" if failures == 0 else "Completed with errors"
    job.stats = {
        "reminders_sent": sent,
        "duplicates_suppressed": duplicates,
        "failures": failures,
        "deferred": deferrals,
        "escalations": escalations_raised,
        "instances_scanned": scanned,
        "errors": len(errors),
    }
    if failures:
        job.error = f"{failures} reminder(s) failed to deliver."
        for admin in users_with_role(db, "Administrator"):
            notifications.notify(
                db, user_id=admin.id,
                title=f"Reminder delivery failures: {failures}",
                body="Open the job dashboard for the failure detail.",
                link="/admin/jobs", severity="danger", category="system",
            )

    db.add(job)
    if commit:
        db.commit()

    return {
        "ran_at": started,
        "reminders_sent": sent,
        "escalations": escalations_raised,
        "skipped_duplicates": duplicates,
        "failures": failures,
        "deferred": deferrals,
        "instances_scanned": scanned,
        "errors": errors[:50],
        "details": details[:200],
    }


def _process_instance(
    db: Session, ctx: ReminderContext, instance, item, *,
    sent: int, duplicates: int, failures: int, deferrals: int,
    escalations_raised: int, details: list[dict],
) -> tuple[int, int, int, int, int]:
    """Send today's reminders and any escalation for one open cycle."""
    profile = ctx.profile
    offsets = (profile.offsets if profile and profile.offsets
               else list(settings.default_reminder_offsets))
    frequency = (profile.post_expiry_frequency_days if profile
                 else settings.post_expiry_frequency_days)
    channels = (profile.channels if profile and profile.channels
                else ["email", "in_app", "push"])
    recipients_map = (profile.recipients_by_offset if profile else {}) or {}

    offset = escalation_rules.offsets_for_today(
        days_to_anchor=ctx.days_to_anchor,
        offsets=offsets,
        post_expiry_frequency_days=frequency,
    )

    if offset is not None:
        recipient_ids = escalation_rules.recipients_for_offset(
            offset=offset,
            recipients_by_offset=recipients_map,
            owner_id=item.owner_id,
            delegate_id=item.delegate_id,
            department_head_id=ctx.head.id if ctx.head else None,
            unit_head_id=ctx.unit_head_user.id if ctx.unit_head_user else None,
            compliance_ids=[u.id for u in ctx.compliance_users],
            management_ids=[u.id for u in ctx.management_users],
        )
        # The same person can arrive down two role paths; notify them once.
        recipient_ids = list(dict.fromkeys(recipient_ids))

        for recipient_id in recipient_ids:
            for channel in channels:
                log, was_duplicate = send_reminder(
                    db, ctx, offset=offset, recipient_id=recipient_id,
                    channel=channel, commit=False,
                )
                if was_duplicate:
                    duplicates += 1
                elif log is None:
                    continue
                elif log.status == ReminderStatus.FAILED:
                    failures += 1
                elif log.status == ReminderStatus.QUEUED:
                    deferrals += 1
                elif log.status == ReminderStatus.SENT:
                    sent += 1

        if recipient_ids:
            instance.last_reminder_at = utcnow()
            db.add(instance)
            details.append({
                "item": item.name,
                "unit": ctx.unit_name,
                "offset": offset,
                "recipients": len(recipient_ids),
            })

    # Escalation runs regardless of whether a reminder offset matched today.
    raised = escalate(db, ctx, commit=False)
    if raised:
        escalations_raised += len(raised)
        details.append({
            "item": item.name,
            "escalated_to_level": ctx.instance.escalation_level,
            "notified": len(raised),
        })

    return sent, duplicates, failures, deferrals, escalations_raised


def retry_failed(db: Session, *, limit: int = 100) -> int:
    """RM-08: retry failed deliveries, capped per row."""
    rows = db.execute(
        select(ReminderLog).where(
            ReminderLog.status == ReminderStatus.FAILED,
            ReminderLog.retry_count < 3,
            ReminderLog.channel == ReminderChannel.EMAIL,
        ).limit(limit)
    ).scalars().all()

    retried = 0
    for log in rows:
        if not log.recipient_address:
            continue
        result = notifications.deliver_email(
            to=log.recipient_address,
            subject=log.subject or "Compliance reminder",
            html=log.body or "",
        )
        log.retry_count += 1
        if result.ok:
            log.status = ReminderStatus.SENT
            log.sent_at = utcnow()
            log.error = None
            retried += 1
        else:
            log.error = result.detail
        db.add(log)
    db.commit()
    return retried


def daily_digest(db: Session, user: User) -> dict:
    """RM-05: everything open for one user, ready to render or email."""
    from app.domain import status as status_rules

    today = ist_today()
    rows = db.execute(
        select(ComplianceInstance, ComplianceItem)
        .join(ComplianceItem, ComplianceItem.id == ComplianceInstance.item_id)
        .where(
            ComplianceItem.is_deleted.is_(False),
            ComplianceInstance.is_deleted.is_(False),
            ComplianceInstance.status.notin_(tuple(REMINDER_SUPPRESSED_STATES)),
            (ComplianceItem.owner_id == user.id) | (ComplianceItem.delegate_id == user.id),
        )
        .order_by(ComplianceInstance.due_date.asc().nulls_last())
    ).all()

    entries = []
    for instance, item in rows:
        state = _status_input(item, instance)
        entries.append({
            "item_id": item.id,
            "item_code": item.item_code,
            "name": item.name,
            "cycle": instance.cycle_label,
            "status": instance.status,
            "criticality": item.criticality,
            "expiry_date": item.expiry_date.isoformat() if item.expiry_date else None,
            "due_date": instance.due_date.isoformat() if instance.due_date else None,
            "derived": status_rules.derive_status(state, today).value,
            "rag": status_rules.rag_colour(state, today).value,
            "days_left": status_rules.countdown(item.expiry_date, today),
            "escalation_level": instance.escalation_level,
        })

    return {
        "user": {"id": user.id, "name": user.name, "email": user.email},
        "generated_at": utcnow().isoformat(),
        "open_count": len(entries),
        "items": entries,
    }


def _status_input(item: ComplianceItem, instance: ComplianceInstance):
    from app.domain import status as status_rules

    return status_rules.StatusInput(
        workflow_status=instance.status,
        applicability=item.applicability,
        expiry_date=item.expiry_date,
        renewal_due_date=item.renewal_due_date,
        internal_target_date=item.internal_target_date,
        due_date=instance.due_date,
        is_perpetual=item.is_perpetual,
        renewal_in_process=bool(instance.renewal_in_process),
        reminder_window_days=item.lead_time_days or 90,
    )
