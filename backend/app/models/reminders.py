"""Reminder profiles/logs, escalation matrix/logs and in-app notifications."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.db.types import UTCDateTime
from app.models.mixins import BaseColumns


class ReminderProfile(BaseColumns, Base):
    """RM-01/RM-03/RM-10: configurable offsets, channels and recipients."""

    __tablename__ = "reminder_profile"

    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    offsets: Mapped[list[int]] = mapped_column(JSON, default=list)
    channels: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["email", "in_app", "push"])
    # e.g. {"90": ["owner"], "15": ["owner","hod"], "0": ["owner","hod","compliance"]}
    recipients_by_offset: Mapped[dict] = mapped_column(JSON, default=dict)
    post_expiry_frequency_days: Mapped[int] = mapped_column(Integer, default=2)
    anchor_on: Mapped[str] = mapped_column(String(20), default="renewal_due_date")
    quiet_hours_exempt: Mapped[bool] = mapped_column(Boolean, default=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class ReminderLog(BaseColumns, Base):
    """Idempotency ledger: one row per (instance, offset, channel, recipient)."""

    __tablename__ = "reminder_log"

    instance_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_instance.id"), nullable=True, index=True
    )
    item_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    offset: Mapped[int] = mapped_column(Integer, default=0)
    is_post_expiry: Mapped[bool] = mapped_column(Boolean, default=False)
    channel: Mapped[str] = mapped_column(String(20), default="email", index=True)
    recipient_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    recipient_address: Mapped[str | None] = mapped_column(String(250), nullable=True)

    scheduled_at: Mapped[datetime] = mapped_column(UTCDateTime)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Queued", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    template_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(400), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)

    # Stable dedupe key so a scheduler re-run never double-sends (RM-11).
    dedupe_key: Mapped[str] = mapped_column(String(200), unique=True, index=True)


class EscalationProfile(BaseColumns, Base):
    __tablename__ = "escalation_profile"

    name: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    criticality: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)


class EscalationRule(BaseColumns, Base):
    """OW-04: level, trigger and who gets notified."""

    __tablename__ = "escalation_rule"

    profile_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("escalation_profile.id"), index=True
    )
    level: Mapped[int] = mapped_column(Integer)
    trigger_days: Mapped[int] = mapped_column(Integer)          # days relative to anchor
    trigger_direction: Mapped[str] = mapped_column(String(10), default="before")
    status_condition: Mapped[list[str]] = mapped_column(JSON, default=list)
    notify_roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    notify_extra: Mapped[list[str]] = mapped_column(JSON, default=list)
    channels: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["email", "in_app"])
    message: Mapped[str | None] = mapped_column(Text, nullable=True)


class EscalationLog(BaseColumns, Base):
    __tablename__ = "escalation_log"

    instance_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("compliance_instance.id"), index=True
    )
    level: Mapped[int] = mapped_column(Integer)
    notified_to: Mapped[list[str]] = mapped_column(JSON, default=list)
    triggered_at: Mapped[datetime] = mapped_column(UTCDateTime)
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    acknowledged_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(200), unique=True, index=True)


class Notification(BaseColumns, Base):
    """In-app notification centre rows (RM-02)."""

    __tablename__ = "notification"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[str | None] = mapped_column(String(400), nullable=True)
    severity: Mapped[str] = mapped_column(String(20), default="info")
    category: Mapped[str] = mapped_column(String(40), default="reminder")
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True, index=True)


class EmailTemplate(BaseColumns, Base):
    """RM-10: admin-editable templates with {placeholders}."""

    __tablename__ = "email_template"

    code: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    subject: Mapped[str] = mapped_column(String(400))
    body_html: Mapped[str] = mapped_column(Text)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel: Mapped[str] = mapped_column(String(20), default="email")
    language: Mapped[str] = mapped_column(String(10), default="en")


class ScheduledReport(BaseColumns, Base):
    """RP-10: saved report definitions with an email schedule."""

    __tablename__ = "scheduled_report"

    report_code: Mapped[str] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(200))
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    frequency: Mapped[str] = mapped_column(String(20), default="weekly")
    recipients: Mapped[list[str]] = mapped_column(JSON, default=list)
    format: Mapped[str] = mapped_column(String(10), default="pdf")
    next_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class JobRun(BaseColumns, Base):
    """Scheduler heartbeat so a failed daily run alerts the Admin (NFR availability)."""

    __tablename__ = "job_run"

    job_name: Mapped[str] = mapped_column(String(80), index=True)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="Running")
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_date: Mapped[date | None] = mapped_column(nullable=True, index=True)
