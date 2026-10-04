"""In-app notifications, e-mail delivery, push and notification templates.

The mailer is deliberately pluggable: with SMTP configured it sends, otherwise
it writes ``.eml`` files to the outbox so reminders are fully testable offline.
"""

from __future__ import annotations

import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.types import utcnow
from app.models.auth import User
from app.models.reminders import EmailTemplate, Notification, ReminderLog


# --------------------------------------------------------------------------- #
# In-app notifications
# --------------------------------------------------------------------------- #
def notify(
    db: Session,
    *,
    user_id: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    severity: str = "info",
    category: str = "reminder",
) -> Notification:
    row = Notification(
        user_id=user_id, title=title, body=body, link=link,
        severity=severity, category=category,
    )
    db.add(row)
    return row


def notify_many(db: Session, *, user_ids: list[str], **kwargs) -> list[Notification]:
    return [notify(db, user_id=uid, **kwargs) for uid in dict.fromkeys(user_ids) if uid]


def mark_read(db: Session, notification_id: str, user_id: str) -> bool:
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user_id:
        return False
    row.read_at = utcnow()
    db.add(row)
    db.commit()
    return True


def mark_all_read(db: Session, user_id: str) -> int:
    result = db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    db.commit()
    return result.rowcount or 0


def unread_count(db: Session, user_id: str) -> int:
    from sqlalchemy import func

    return db.execute(
        select(func.count(Notification.id)).where(
            Notification.user_id == user_id, Notification.read_at.is_(None)
        )
    ).scalar_one()


def clear_instance_reminders(db: Session, instance_id: str) -> int:
    """RM-06: reminders stop automatically when an item is actioned or closed."""
    result = db.execute(
        update(ReminderLog)
        .where(
            ReminderLog.instance_id == instance_id,
            ReminderLog.status == "Queued",
        )
        .values(status="Skipped", error="Item actioned — reminder stands down.")
    )
    return result.rowcount or 0


# --------------------------------------------------------------------------- #
# Templates (RM-10)
# --------------------------------------------------------------------------- #
DEFAULT_PLACEHOLDERS = (
    "Greeting", "Item", "Reference No.", "Authority", "Unit", "Department",
    "Expiry Date", "Renewal Due Date", "Due Date", "Status", "Owner",
    "Days Left", "Days Overdue", "Criticality", "Cycle", "Documents Pending",
    "Next Escalation Date", "Next Escalation Level", "Link", "Exposure Note",
)


def render(template: str, values: dict) -> str:
    """Substitute {placeholders}; unknown keys are left visible for the Admin."""
    out = template
    for key, value in values.items():
        out = out.replace("{" + key + "}", "" if value is None else str(value))
    return out


def get_template(db: Session, code: str) -> EmailTemplate | None:
    return db.execute(
        select(EmailTemplate).where(EmailTemplate.code == code, EmailTemplate.is_deleted.is_(False))
    ).scalar_one_or_none()


def template_values(
    *,
    item_name: str,
    item_code: str,
    reference_number: str | None,
    authority: str | None,
    unit: str | None,
    department: str | None,
    expiry_date,
    renewal_due_date,
    due_date,
    status: str,
    owner: str | None,
    days_left: int | None,
    days_overdue: int | None,
    criticality: str,
    cycle: str,
    documents_pending: list[str] | None = None,
    next_escalation_date=None,
    next_escalation_level: str | None = None,
    link: str | None = None,
    exposure_note: str | None = None,
) -> dict:
    return {
        "Greeting": "Dear Colleague,",
        "Item": item_name,
        "Item Code": item_code,
        "Reference No.": reference_number or "—",
        "Authority": authority or "—",
        "Unit": unit or "—",
        "Department": department or "—",
        "Expiry Date": expiry_date or "—",
        "Renewal Due Date": renewal_due_date or "—",
        "Due Date": due_date or "—",
        "Status": status,
        "Owner": owner or "—",
        "Days Left": days_left if days_left is not None else "—",
        "Days Overdue": days_overdue if days_overdue is not None else 0,
        "Criticality": criticality,
        "Cycle": cycle,
        "Documents Pending": ", ".join(documents_pending or []) or "None",
        "Next Escalation Date": next_escalation_date or "—",
        "Next Escalation Level": next_escalation_level or "—",
        "Link": link or "/",
        "Exposure Note": exposure_note or "—",
    }


# --------------------------------------------------------------------------- #
# Delivery
# --------------------------------------------------------------------------- #
class DeliveryResult:
    __slots__ = ("ok", "detail")

    def __init__(self, ok: bool, detail: str = "") -> None:
        self.ok = ok
        self.detail = detail


def deliver_email(
    *, to: str, subject: str, html: str, text: str | None = None, attachments: list[tuple[str, bytes, str]] | None = None
) -> DeliveryResult:
    """Send via SMTP, or spool to the outbox when SMTP is unconfigured."""
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_from
    message["To"] = to
    message.set_content(text or _html_to_text(html))
    message.add_alternative(html, subtype="html")

    for filename, payload, mime in attachments or []:
        maintype, _, subtype = mime.partition("/")
        message.add_attachment(
            payload, maintype=maintype or "application", subtype=subtype or "octet-stream",
            filename=filename,
        )

    if not settings.smtp_host:
        outbox: Path = settings.mail_outbox_dir
        outbox.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        safe = "".join(c for c in to if c.isalnum() or c in "._@-") or "recipient"
        (outbox / f"{stamp}_{safe}.eml").write_bytes(message.as_bytes())
        return DeliveryResult(True, "spooled to outbox (SMTP not configured)")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_user:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(message)
        return DeliveryResult(True, "sent")
    except Exception as exc:  # noqa: BLE001 — delivery failure must not break the run
        return DeliveryResult(False, str(exc))


def _html_to_text(html: str) -> str:
    import re

    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"</(p|div|tr|h[1-6])>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def email_recipients(db: Session, user_ids: list[str]) -> list[tuple[str, str]]:
    """Resolve (user_id, email) pairs, skipping inactive accounts."""
    if not user_ids:
        return []
    rows = db.execute(select(User).where(User.id.in_(user_ids))).scalars().all()
    return [(u.id, u.email) for u in rows if u.status == "Active" and not u.is_deleted]
