"""Compliance item / template / instance schemas."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.domain.enums import (
    Applicability,
    Criticality,
    ItemStatus,
    ItemType,
    RecurrenceKind,
    ValidityUnit,
)
from app.schemas.common import ORMModel


class ItemBase(BaseModel):
    name: str = Field(min_length=2, max_length=400)
    description: str | None = None
    category_id: str | None = None
    sub_category_id: str | None = None
    type: str = ItemType.LICENCE
    legal_reference_text: str | None = None

    unit_id: str | None = None
    department_id: str | None = None

    owner_id: str | None = None
    delegate_id: str | None = None
    reviewer_id: str | None = None
    approver_id: str | None = None

    authority_id: str | None = None
    reference_number: str | None = None

    issue_date: date | None = None
    validity_value: int | None = None
    validity_unit: str = ValidityUnit.MONTHS
    expiry_date: date | None = None

    authority_processing_days: int = 15
    internal_prep_days: int = 15
    lead_time_days: int = 90

    recurrence_rule: str = RecurrenceKind.ANNUAL
    recurrence_day: int | None = None
    recurrence_interval_months: int | None = None

    criticality: str = Criticality.MEDIUM
    applicability: str = Applicability.APPLICABLE
    applicability_justification: str | None = None

    asset_id: str | None = None
    person_ref: str | None = None

    fee_amount: float | None = None
    penalty_per_day: float | None = None
    grace_period_days: int | None = None

    required_documents: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    remarks: str | None = None
    exposure_note: str | None = None

    reminder_profile_id: str | None = None
    escalation_profile_id: str | None = None
    allow_direct_close: bool = False
    anchor_on: str = "renewal_due_date"
    is_perpetual: bool = False


class ItemCreate(ItemBase):
    template_id: str | None = None
    item_code: str | None = None
    # Seed the first cycle immediately (default) or leave the item cycle-less.
    create_first_instance: bool = True
    ignore_duplicate_check: bool = False


class ItemUpdate(BaseModel):
    """Every field optional — only what is sent gets changed (and audited)."""

    model_config = {"extra": "forbid"}

    name: str | None = None
    description: str | None = None
    category_id: str | None = None
    sub_category_id: str | None = None
    type: str | None = None
    legal_reference_text: str | None = None
    unit_id: str | None = None
    department_id: str | None = None
    owner_id: str | None = None
    delegate_id: str | None = None
    reviewer_id: str | None = None
    approver_id: str | None = None
    authority_id: str | None = None
    reference_number: str | None = None
    issue_date: date | None = None
    validity_value: int | None = None
    validity_unit: str | None = None
    expiry_date: date | None = None
    authority_processing_days: int | None = None
    internal_prep_days: int | None = None
    lead_time_days: int | None = None
    recurrence_rule: str | None = None
    recurrence_day: int | None = None
    recurrence_interval_months: int | None = None
    criticality: str | None = None
    applicability: str | None = None
    applicability_justification: str | None = None
    asset_id: str | None = None
    person_ref: str | None = None
    fee_amount: float | None = None
    penalty_per_day: float | None = None
    grace_period_days: int | None = None
    required_documents: list[str] | None = None
    tags: list[str] | None = None
    remarks: str | None = None
    exposure_note: str | None = None
    reminder_profile_id: str | None = None
    escalation_profile_id: str | None = None
    allow_direct_close: bool | None = None
    anchor_on: str | None = None
    is_perpetual: bool | None = None
    reason: str | None = None


class InstanceSummary(ORMModel):
    id: str
    cycle_label: str
    status: str
    due_date: date | None
    period_start: date | None
    period_end: date | None
    verification_status: str
    escalation_level: int
    renewal_in_process: bool
    delay_days: int
    closed_at: datetime | None = None
    new_expiry_date: date | None = None


class ItemOut(ORMModel):
    id: str
    item_code: str
    name: str
    description: str | None = None
    type: str
    category_id: str | None = None
    category_name: str | None = None
    unit_id: str | None = None
    unit_name: str | None = None
    department_id: str | None = None
    department_name: str | None = None
    owner_id: str | None = None
    owner_name: str | None = None
    delegate_id: str | None = None
    authority_id: str | None = None
    authority_name: str | None = None
    reference_number: str | None = None
    issue_date: date | None = None
    expiry_date: date | None = None
    renewal_due_date: date | None = None
    internal_target_date: date | None = None
    validity_value: int | None = None
    validity_unit: str | None = None
    criticality: str
    applicability: str
    recurrence_rule: str
    fee_amount: float | None = None
    is_perpetual: bool = False
    tags: list[str] = Field(default_factory=list)
    required_documents: list[str] = Field(default_factory=list)

    # Derived, computed per request against today's date (IST).
    current_status: str | None = None
    bucket: str | None = None
    rag: str | None = None
    days_left: int | None = None
    current_instance: InstanceSummary | None = None
    open_instances: int = 0


class ChecklistUpdate(BaseModel):
    status: str
    note: str | None = None


class CommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    mentions: list[str] = Field(default_factory=list)
    kind: str = "comment"


class CommentOut(ORMModel):
    id: str
    body: str
    mentions: list[str] = Field(default_factory=list)
    kind: str
    user_id: str | None = None
    user_name: str | None = None
    created_at: datetime


class StatusChange(BaseModel):
    target_status: str
    reason: str | None = None
    expected_filing_date: date | None = None
    submission_date: date | None = None
    acknowledgement_no: str | None = None
    new_reference_number: str | None = None
    new_issue_date: date | None = None
    new_expiry_date: date | None = None
    fee_paid: float | None = None
    verification_remark: str | None = None
    on_hold_reason: str | None = None
    review_date: date | None = None
    delay_days: int | None = None

    model_config = {"protected_namespaces": ()}


class VerificationRequest(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    remark: str = Field(min_length=3, max_length=2000)
    new_expiry_date: date | None = None
    new_reference_number: str | None = None
    new_issue_date: date | None = None
    roll_forward: bool = True


class TimelineEntry(BaseModel):
    ts: datetime
    ts_display: str
    kind: str
    title: str
    detail: str | None = None
    actor: str | None = None
    severity: str = "info"


class TemplateBase(BaseModel):
    code: str = Field(min_length=2, max_length=60)
    name: str = Field(min_length=2, max_length=300)
    category_id: str | None = None
    sub_category_id: str | None = None
    type: str = ItemType.LICENCE
    authority_id: str | None = None
    default_validity_value: int | None = None
    default_validity_unit: str = ValidityUnit.MONTHS
    recurrence_rule: str = RecurrenceKind.ANNUAL
    recurrence_day: int | None = None
    recurrence_interval_months: int | None = None
    lead_time_days: int = 90
    authority_processing_days: int = 15
    internal_prep_days: int = 15
    default_owner_dept_id: str | None = None
    criticality: str = Criticality.MEDIUM
    required_documents: list[str] = Field(default_factory=list)
    legal_reference_ids: list[str] = Field(default_factory=list)
    reminder_profile_id: str | None = None
    escalation_profile_id: str | None = None
    allow_direct_close: bool = False
    anchor_on: str = "renewal_due_date"
    applicability_notes: str | None = None
    legal_reference_text: str | None = None


class TemplateCreate(TemplateBase):
    pass


class TemplateUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str | None = None
    category_id: str | None = None
    type: str | None = None
    authority_id: str | None = None
    default_validity_value: int | None = None
    default_validity_unit: str | None = None
    recurrence_rule: str | None = None
    recurrence_day: int | None = None
    recurrence_interval_months: int | None = None
    lead_time_days: int | None = None
    authority_processing_days: int | None = None
    internal_prep_days: int | None = None
    default_owner_dept_id: str | None = None
    criticality: str | None = None
    required_documents: list[str] | None = None
    legal_reference_ids: list[str] | None = None
    allow_direct_close: bool | None = None
    anchor_on: str | None = None
    applicability_notes: str | None = None
    legal_reference_text: str | None = None
    reason: str | None = None


class TemplateOut(ORMModel):
    id: str
    code: str
    name: str
    type: str
    category_id: str | None = None
    category_name: str | None = None
    authority_id: str | None = None
    authority_name: str | None = None
    default_validity_value: int | None = None
    default_validity_unit: str
    recurrence_rule: str
    lead_time_days: int
    authority_processing_days: int
    internal_prep_days: int
    criticality: str
    default_owner_dept_id: str | None = None
    department_name: str | None = None
    required_documents: list[str] = Field(default_factory=list)
    legal_reference_text: str | None = None
    applicability_notes: str | None = None
    is_seed: bool = False
    item_count: int = 0


class ApplyTemplateRequest(BaseModel):
    unit_id: str
    department_id: str | None = None
    owner_id: str | None = None
    category_ids: list[str] | None = None
    template_ids: list[str] | None = None
    issue_date: date | None = None
    dry_run: bool = False


class ApplyTemplateResult(BaseModel):
    created: int
    skipped: int
    details: list[dict] = Field(default_factory=list)


class BulkReassign(BaseModel):
    item_ids: list[str]
    owner_id: str | None = None
    delegate_id: str | None = None
    department_id: str | None = None
    reason: str = Field(min_length=3, max_length=1000)


class BulkEdit(BaseModel):
    item_ids: list[str]
    set_criticality: str | None = None
    set_department_id: str | None = None
    set_owner_id: str | None = None
    set_tags: list[str] | None = None
    add_tags: list[str] | None = None
    reason: str = Field(min_length=3, max_length=1000)


class ArchiveRequest(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class StatusOptionsOut(BaseModel):
    statuses: list[str]
    transitions: dict[str, list[dict]]
