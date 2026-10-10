"""Document, reminder, escalation and notification schemas."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.common import EmailAddress, ORMModel


class DocumentOut(ORMModel):
    id: str
    item_id: str | None = None
    instance_id: str | None = None
    doc_type: str
    title: str
    file_name: str
    mime: str | None = None
    size: int
    sha256: str | None = None
    version_no: int
    is_current: bool
    reference_number: str | None = None
    issue_date: date | None = None
    expiry_date: date | None = None
    change_note: str | None = None
    virus_scan_status: str
    uploaded_by_name: str | None = None
    created_at: datetime
    download_url: str | None = None


class DocumentVersionOut(ORMModel):
    id: str
    version_no: int
    is_current: bool
    file_name: str
    size: int
    sha256: str | None = None
    change_note: str | None = None
    uploaded_by_name: str | None = None
    created_at: datetime


class ReminderProfileBase(BaseModel):
    name: str
    offsets: list[int] = Field(default_factory=lambda: [90, 60, 30, 15, 7, 3, 1, 0])
    channels: list[str] = Field(default_factory=lambda: ["email", "in_app", "push"])
    recipients_by_offset: dict = Field(default_factory=dict)
    post_expiry_frequency_days: int = 2
    anchor_on: str = "renewal_due_date"
    quiet_hours_exempt: bool = False
    is_default: bool = False


class ReminderProfileCreate(ReminderProfileBase):
    pass


class ReminderProfileUpdate(BaseModel):
    name: str | None = None
    offsets: list[int] | None = None
    channels: list[str] | None = None
    recipients_by_offset: dict | None = None
    post_expiry_frequency_days: int | None = None
    anchor_on: str | None = None
    quiet_hours_exempt: bool | None = None


class ReminderProfileOut(ORMModel):
    id: str
    name: str
    offsets: list[int]
    channels: list[str]
    recipients_by_offset: dict
    post_expiry_frequency_days: int
    anchor_on: str
    quiet_hours_exempt: bool
    is_default: bool


class ReminderLogOut(ORMModel):
    id: str
    item_id: str | None = None
    item_name: str | None = None
    instance_id: str | None = None
    offset: int
    channel: str
    recipient_address: str | None = None
    recipient_name: str | None = None
    scheduled_at: datetime
    sent_at: datetime | None = None
    status: str
    error: str | None = None
    subject: str | None = None
    retry_count: int = 0


class EscalationRuleOut(ORMModel):
    id: str
    profile_id: str
    level: int
    trigger_days: int
    trigger_direction: str
    status_condition: list[str]
    notify_roles: list[str]
    channels: list[str]
    message: str | None = None


class EscalationLogOut(ORMModel):
    id: str
    instance_id: str
    item_id: str | None = None
    item_name: str | None = None
    level: int
    level_label: str | None = None
    notified_to: list[str]
    notified_names: list[str] = Field(default_factory=list)
    triggered_at: datetime
    acknowledged_at: datetime | None = None
    outcome: str | None = None


class NotificationOut(ORMModel):
    id: str
    title: str
    body: str | None = None
    link: str | None = None
    severity: str
    category: str
    read_at: datetime | None = None
    created_at: datetime


class EmailTemplateOut(ORMModel):
    id: str
    code: str
    name: str
    subject: str
    body_html: str
    body_text: str | None = None
    channel: str
    language: str


class EmailTemplateUpdate(BaseModel):
    name: str | None = None
    subject: str | None = None
    body_html: str | None = None
    body_text: str | None = None


class PushSubscribe(BaseModel):
    endpoint: str
    keys: dict = Field(default_factory=dict)
    user_agent: str | None = None


class ShareLinkCreate(BaseModel):
    scope_item_id: str | None = None
    scope_unit_id: str | None = None
    created_for: str | None = None
    expires_in_hours: int = Field(default=72, ge=1, le=720)


class ShareLinkOut(ORMModel):
    id: str
    token: str
    url: str | None = None
    scope_item_id: str | None = None
    scope_unit_id: str | None = None
    created_for: str | None = None
    expires_at: datetime
    revoked: bool
    access_count: int


class JobRunOut(ORMModel):
    id: str
    job_name: str
    started_at: datetime
    finished_at: datetime | None = None
    status: str
    stats: dict
    error: str | None = None


class RunRemindersResult(BaseModel):
    ran_at: datetime
    reminders_sent: int
    escalations: int
    skipped_duplicates: int
    failures: int
    details: list[dict] = Field(default_factory=list)


class MailConfigUpdate(BaseModel):
    """A partial update of the stored SMTP settings.

    Every field is optional and ``exclude_unset`` decides what is written, so a
    screen that shows a masked password can leave ``password`` out entirely and
    the stored one survives. Send an empty string to clear it.
    """

    host: str | None = Field(None, max_length=255)
    port: int | None = Field(None, ge=1, le=65535)
    user: str | None = Field(None, max_length=255)
    password: str | None = Field(None, max_length=255)
    sender: EmailAddress | None = None
    use_tls: bool | None = None
    use_ssl: bool | None = None


class TestEmailRequest(BaseModel):
    """Where to send a test message. Defaults to the caller's own address."""

    to: EmailAddress | None = None
