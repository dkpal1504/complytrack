"""The compliance register: templates, items, instances, checklist, comments."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import UTCDateTime
from app.domain.enums import (
    Applicability,
    Criticality,
    ItemStatus,
    ItemType,
    RecurrenceKind,
    ValidityUnit,
    VerificationStatus,
)
from app.models.mixins import BaseColumns


class ComplianceTemplate(BaseColumns, Base):
    """A reusable obligation definition, instantiated against a unit (CD/EX-01)."""

    __tablename__ = "compliance_template"

    code: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    category_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("category.id"), nullable=True, index=True
    )
    sub_category_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("category.id"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(30), default=ItemType.LICENCE)
    authority_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("issuing_authority.id"), nullable=True, index=True
    )

    default_validity_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_validity_unit: Mapped[str] = mapped_column(String(30), default=ValidityUnit.MONTHS)
    recurrence_rule: Mapped[str] = mapped_column(String(30), default=RecurrenceKind.ANNUAL)
    recurrence_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recurrence_interval_months: Mapped[int | None] = mapped_column(Integer, nullable=True)

    lead_time_days: Mapped[int] = mapped_column(Integer, default=90)
    authority_processing_days: Mapped[int] = mapped_column(Integer, default=15)
    internal_prep_days: Mapped[int] = mapped_column(Integer, default=15)

    default_owner_dept_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=True, index=True
    )
    criticality: Mapped[str] = mapped_column(String(20), default=Criticality.MEDIUM, index=True)

    required_documents: Mapped[list[str]] = mapped_column(JSON, default=list)
    legal_reference_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    reminder_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    escalation_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Filings may go Submitted -> Closed with no renewal certificate (Section 8).
    allow_direct_close: Mapped[bool] = mapped_column(Boolean, default=False)
    # Reminders anchor on renewal-due-date (licences) or statutory due date (filings).
    anchor_on: Mapped[str] = mapped_column(String(20), default="renewal_due_date")

    applicability_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    legal_reference_text: Mapped[str | None] = mapped_column(String(400), nullable=True)
    is_seed: Mapped[bool] = mapped_column(Boolean, default=False)

    category: Mapped["Category | None"] = relationship(foreign_keys=[category_id])  # noqa: F821
    authority: Mapped["IssuingAuthority | None"] = relationship()  # noqa: F821


class ComplianceItem(BaseColumns, Base):
    """One live obligation for one unit — the register row."""

    __tablename__ = "compliance_item"

    template_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_template.id"), nullable=True, index=True
    )
    item_code: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(400), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    category_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("category.id"), nullable=True, index=True
    )
    sub_category_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    type: Mapped[str] = mapped_column(String(30), default=ItemType.LICENCE, index=True)
    legal_reference_text: Mapped[str | None] = mapped_column(String(400), nullable=True)

    unit_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organisation_unit.id"), nullable=True, index=True
    )
    department_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=True, index=True
    )

    owner_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user.id"), nullable=True, index=True
    )
    delegate_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user.id"), nullable=True
    )
    reviewer_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("user.id"), nullable=True)
    approver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("user.id"), nullable=True)

    authority_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("issuing_authority.id"), nullable=True, index=True
    )
    reference_number: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)

    issue_date: Mapped[date | None] = mapped_column(nullable=True)
    validity_value: Mapped[int | None] = mapped_column(Integer, nullable=True)
    validity_unit: Mapped[str] = mapped_column(String(30), default=ValidityUnit.MONTHS)
    expiry_date: Mapped[date | None] = mapped_column(nullable=True, index=True)

    authority_processing_days: Mapped[int] = mapped_column(Integer, default=15)
    internal_prep_days: Mapped[int] = mapped_column(Integer, default=15)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=90)

    renewal_due_date: Mapped[date | None] = mapped_column(nullable=True, index=True)
    internal_target_date: Mapped[date | None] = mapped_column(nullable=True, index=True)
    is_perpetual: Mapped[bool] = mapped_column(Boolean, default=False)

    recurrence_rule: Mapped[str] = mapped_column(String(30), default=RecurrenceKind.ANNUAL)
    recurrence_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recurrence_interval_months: Mapped[int | None] = mapped_column(Integer, nullable=True)

    criticality: Mapped[str] = mapped_column(String(20), default=Criticality.MEDIUM, index=True)
    applicability: Mapped[str] = mapped_column(String(20), default=Applicability.APPLICABLE)
    applicability_justification: Mapped[str | None] = mapped_column(Text, nullable=True)

    asset_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("asset.id"), nullable=True)
    person_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)

    fee_amount: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    penalty_per_day: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    grace_period_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    required_documents: Mapped[list[str]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    exposure_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    reminder_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    escalation_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    allow_direct_close: Mapped[bool] = mapped_column(Boolean, default=False)
    anchor_on: Mapped[str] = mapped_column(String(20), default="renewal_due_date")
    last_reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    template: Mapped[ComplianceTemplate | None] = relationship()
    category: Mapped["Category | None"] = relationship(foreign_keys=[category_id])  # noqa: F821
    authority: Mapped["IssuingAuthority | None"] = relationship()  # noqa: F821
    unit: Mapped["OrganisationUnit | None"] = relationship()  # noqa: F821
    department: Mapped["Department | None"] = relationship()  # noqa: F821
    owner: Mapped["User | None"] = relationship(foreign_keys=[owner_id])  # noqa: F821
    instances: Mapped[list["ComplianceInstance"]] = relationship(
        back_populates="item", cascade="all, delete-orphan"
    )


class ComplianceInstance(BaseColumns, Base):
    """One cycle of an item — status and evidence live here (PRD Section 3)."""

    __tablename__ = "compliance_instance"

    item_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("compliance_item.id"), index=True
    )
    cycle_label: Mapped[str] = mapped_column(String(60), index=True)
    period_start: Mapped[date | None] = mapped_column(nullable=True)
    period_end: Mapped[date | None] = mapped_column(nullable=True)
    due_date: Mapped[date | None] = mapped_column(nullable=True, index=True)

    status: Mapped[str] = mapped_column(String(30), default=ItemStatus.PENDING, index=True)
    status_changed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    expected_filing_date: Mapped[date | None] = mapped_column(nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    renewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    closed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("user.id"), nullable=True)

    acknowledgement_no: Mapped[str | None] = mapped_column(String(200), nullable=True)
    new_reference_number: Mapped[str | None] = mapped_column(String(200), nullable=True)
    new_issue_date: Mapped[date | None] = mapped_column(nullable=True)
    new_expiry_date: Mapped[date | None] = mapped_column(nullable=True)
    fee_paid: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)

    delay_days: Mapped[int] = mapped_column(Integer, default=0)
    verification_status: Mapped[str] = mapped_column(
        String(30), default=VerificationStatus.NOT_SUBMITTED, index=True
    )
    verification_remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("user.id"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # RT-07: applied before expiry -> "Complied - renewal in process".
    renewal_in_process: Mapped[bool] = mapped_column(Boolean, default=False)
    on_hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_date: Mapped[date | None] = mapped_column(nullable=True)

    owner_acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    escalation_level: Mapped[int] = mapped_column(Integer, default=0)
    last_reminder_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    item: Mapped[ComplianceItem] = relationship(back_populates="instances")
    checklist: Mapped[list["InstanceChecklist"]] = relationship(
        back_populates="instance", cascade="all, delete-orphan"
    )


class InstanceChecklist(BaseColumns, Base):
    """DS-01: required-documents checklist for one cycle."""

    __tablename__ = "instance_checklist"

    instance_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("compliance_instance.id"), index=True
    )
    item_name: Mapped[str] = mapped_column(String(250))
    status: Mapped[str] = mapped_column(String(20), default="Pending")
    received_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    received_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Free text against this line — the challan number, who saw the original,
    # why a document is not required this cycle. The checklist screen has always
    # offered the field; until this column existed the note was accepted by the
    # request schema and then dropped on the floor.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    instance: Mapped[ComplianceInstance] = relationship(back_populates="checklist")


class Comment(BaseColumns, Base):
    """OW-07: comments, @mentions and the query/response log."""

    __tablename__ = "comment"

    item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_item.id"), nullable=True, index=True
    )
    instance_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_instance.id"), nullable=True, index=True
    )
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("user.id"), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    mentions: Mapped[list[str]] = mapped_column(JSON, default=list)
    kind: Mapped[str] = mapped_column(String(30), default="comment")


class Asset(BaseColumns, Base):
    """Phase 2 asset register — cranes, boilers, DG sets, lifts (CD-05, EX-08)."""

    __tablename__ = "asset"

    tag: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(250))
    type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    location: Mapped[str | None] = mapped_column(String(250), nullable=True)
    unit_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    owner_dept_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Contractor(BaseColumns, Base):
    """Phase 2 contractor compliance (EX-02)."""

    __tablename__ = "contractor"

    name: Mapped[str] = mapped_column(String(250), index=True)
    licence_no: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pf_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    esi_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    valid_till: Mapped[date | None] = mapped_column(nullable=True)
    unit_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    contact: Mapped[str | None] = mapped_column(String(250), nullable=True)


class FindingCapa(BaseColumns, Base):
    """Phase 2 inspection/audit findings and CAPA tracker (EX-01)."""

    __tablename__ = "finding_capa"

    source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    observation: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20), default=Criticality.MEDIUM)
    owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    unit_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    target_date: Mapped[date | None] = mapped_column(nullable=True)
    closed_date: Mapped[date | None] = mapped_column(nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="Open")
    action_taken: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_ids: Mapped[list[str]] = mapped_column(JSON, default=list)


class LegalChange(BaseColumns, Base):
    """Phase 2 legal change tracker (EX-03)."""

    __tablename__ = "legal_change"

    title: Mapped[str] = mapped_column(String(300))
    act_rule_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    effective_date: Mapped[date | None] = mapped_column(nullable=True)
    impact_assessment: Mapped[str | None] = mapped_column(Text, nullable=True)
    impact_level: Mapped[str] = mapped_column(String(20), default=Criticality.MEDIUM)
    action_owner_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="Open")
