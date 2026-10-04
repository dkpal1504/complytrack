"""Model package — importing it registers every table on the shared metadata."""

from app.models.audit import AuditLog
from app.models.auth import Delegation, SessionToken, User
from app.models.compliance import (
    Asset,
    Comment,
    ComplianceInstance,
    ComplianceItem,
    ComplianceTemplate,
    Contractor,
    FindingCapa,
    InstanceChecklist,
    LegalChange,
)
from app.models.documents import Document, ShareLink
from app.models.org import (
    Category,
    Department,
    HolidayCalendar,
    IssuingAuthority,
    LegalReference,
    OrganisationUnit,
    Setting,
)
from app.models.reminders import (
    EmailTemplate,
    EscalationLog,
    EscalationProfile,
    EscalationRule,
    JobRun,
    Notification,
    ReminderLog,
    ReminderProfile,
    ScheduledReport,
)

__all__ = [
    "Asset", "AuditLog", "Category", "Comment", "ComplianceInstance", "ComplianceItem",
    "ComplianceTemplate", "Contractor", "Delegation", "Department", "Document",
    "EmailTemplate", "EscalationLog", "EscalationProfile", "EscalationRule", "FindingCapa",
    "HolidayCalendar", "InstanceChecklist", "IssuingAuthority", "JobRun", "LegalChange",
    "LegalReference", "Notification", "OrganisationUnit", "ReminderLog", "ReminderProfile",
    "ScheduledReport", "SessionToken", "Setting", "ShareLink", "User",
]
