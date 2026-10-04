"""Shared enumerations. Values are stable strings — they appear in the audit log."""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    ADMIN = "Administrator"
    COMPLIANCE = "Compliance Team"
    DEPARTMENT = "Department User"
    MANAGEMENT = "Management View"
    AUDITOR = "Auditor"


class ItemType(StrEnum):
    LICENCE = "Licence"            # licence / registration / permit
    FILING = "Filing"              # periodic filing / return
    INSPECTION = "Inspection"      # inspection / test of asset or person
    CERTIFICATE = "Certificate"    # certificate for equipment or person
    POLICY = "Policy"              # one-time / event-driven approval or policy


class Criticality(StrEnum):
    CRITICAL = "Critical"
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


CRITICALITY_WEIGHT: dict[str, int] = {
    Criticality.CRITICAL: 4,
    Criticality.HIGH: 3,
    Criticality.MEDIUM: 2,
    Criticality.LOW: 1,
}


class Applicability(StrEnum):
    APPLICABLE = "Applicable"
    NOT_APPLICABLE = "Not Applicable"


class ItemStatus(StrEnum):
    """Manual workflow states (PRD Section 8)."""

    PENDING = "Pending"
    UNDER_PROCESS = "Under Process"
    SUBMITTED = "Submitted"
    RENEWED = "Renewed"
    CLOSED = "Closed"
    ON_HOLD = "On Hold"
    NOT_APPLICABLE = "Not Applicable"
    QUERY_RAISED = "Query Raised"


class DerivedStatus(StrEnum):
    """Computed for dashboards and RAG colouring (RT-05)."""

    VALID = "Valid"
    UPCOMING = "Upcoming"
    DUE_FOR_RENEWAL = "Due for Renewal"
    EXPIRED = "Expired"
    PERPETUAL = "Perpetual"
    NOT_APPLICABLE = "Not Applicable"


class ComplianceBucket(StrEnum):
    """How an item rolls up into the management dashboard."""

    COMPLIED = "Complied"
    UNDER_PROCESS = "Under Process"
    PENDING = "Pending"
    OVERDUE = "Overdue"
    EXPIRED = "Expired"


class BucketDrill(StrEnum):
    """What a management KPI card opens when it is clicked (PRD Section 7, AC-5).

    Every member names a card on the dashboard, so a card's value and the list
    it drills into are the same rule over the same rows. ``DUE_30`` is a window
    rather than a bucket — "Due in next 30 days" slices the open buckets by
    countdown — but it is a card too, so it is a drill value.
    """

    ALL = "all"
    COMPLIED = ComplianceBucket.COMPLIED
    PENDING = ComplianceBucket.PENDING
    UNDER_PROCESS = ComplianceBucket.UNDER_PROCESS
    OVERDUE = ComplianceBucket.OVERDUE
    EXPIRED = ComplianceBucket.EXPIRED
    DUE_30 = "due30"


class RagColour(StrEnum):
    RED = "red"
    AMBER = "amber"
    GREEN = "green"
    GREY = "grey"


class ValidityUnit(StrEnum):
    DAYS = "days"
    MONTHS = "months"
    YEARS = "years"
    EOFY = "end of financial year"
    EOCY = "end of calendar year"
    FIXED_ANNUAL = "fixed date annually"
    NONE = "no expiry"


class RecurrenceKind(StrEnum):
    NONE = "none"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    HALF_YEARLY = "half_yearly"
    ANNUAL = "annual"
    FY_ANNUAL = "financial_year"
    INTERVAL = "interval"   # N months from last done


class ChecklistStatus(StrEnum):
    PENDING = "Pending"
    RECEIVED = "Received"
    NOT_REQUIRED = "Not Required"


class DocumentType(StrEnum):
    CERTIFICATE = "Certificate"
    APPLICATION = "Application"
    ACKNOWLEDGEMENT = "Acknowledgement"
    CHALLAN = "Challan"
    REPORT = "Report"
    CORRESPONDENCE = "Correspondence"
    OTHER = "Other"


class VerificationStatus(StrEnum):
    NOT_SUBMITTED = "Not Submitted"
    AWAITING = "Awaiting Verification"
    APPROVED = "Approved"
    REJECTED = "Rejected"


class ReminderChannel(StrEnum):
    EMAIL = "email"
    IN_APP = "in_app"
    PUSH = "push"
    SMS = "sms"
    WHATSAPP = "whatsapp"
    TEAMS = "teams"


class ReminderStatus(StrEnum):
    QUEUED = "Queued"
    SENT = "Sent"
    DELIVERED = "Delivered"
    FAILED = "Failed"
    READ = "Read"
    SKIPPED = "Skipped"


class AuthorityLevel(StrEnum):
    CENTRAL = "Central"
    STATE = "State"
    LOCAL = "Local"
    CLASS = "Class"
    CUSTOMER = "Customer"
    INTERNAL = "Internal"


class UnitType(StrEnum):
    YARD = "Yard"
    PLANT = "Plant"
    OFFICE = "Office"
    SUBSIDIARY = "Subsidiary"


class UserStatus(StrEnum):
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    LOCKED = "Locked"
