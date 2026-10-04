"""Server-side RBAC and Unit/Department data scoping (PRD Section 9).

The matrix here is the single source of truth for authorisation. It is enforced
in the API dependency layer, never in the client.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.enums import Role


class Permission:
    MANAGE_ORG = "manage_org"                       # users, roles, units, departments
    CONFIGURE_ENGINE = "configure_engine"           # reminder rules, escalation, templates
    MANAGE_TEMPLATES = "manage_templates"
    MANAGE_ITEMS = "manage_items"
    VIEW_ALL_ITEMS = "view_all_items"
    VIEW_SCOPED_ITEMS = "view_scoped_items"
    UPDATE_ASSIGNED = "update_assigned"             # status, comments, uploads
    VERIFY_CLOSE = "verify_close"
    DELETE_ARCHIVE = "delete_archive"
    REASSIGN = "reassign"
    VIEW_DASHBOARD_ALL = "view_dashboard_all"
    VIEW_DASHBOARD_SCOPED = "view_dashboard_scoped"
    RUN_REPORTS_ALL = "run_reports_all"
    RUN_REPORTS_SCOPED = "run_reports_scoped"
    VIEW_AUDIT = "view_audit"
    DOWNLOAD_DOCS = "download_docs"
    MANAGE_SETTINGS = "manage_settings"
    VIEW_FINANCIALS = "view_financials"             # AC-05 field-level restriction
    MANAGE_PHASE2 = "manage_phase2"                 # CAPA, contractors, legal tracker
    CREATE_SHARE_LINK = "create_share_link"


_ALL = {
    Permission.MANAGE_ORG,
    Permission.CONFIGURE_ENGINE,
    Permission.MANAGE_TEMPLATES,
    Permission.MANAGE_ITEMS,
    Permission.VIEW_ALL_ITEMS,
    Permission.VIEW_SCOPED_ITEMS,
    Permission.UPDATE_ASSIGNED,
    Permission.VERIFY_CLOSE,
    Permission.DELETE_ARCHIVE,
    Permission.REASSIGN,
    Permission.VIEW_DASHBOARD_ALL,
    Permission.VIEW_DASHBOARD_SCOPED,
    Permission.RUN_REPORTS_ALL,
    Permission.RUN_REPORTS_SCOPED,
    Permission.VIEW_AUDIT,
    Permission.DOWNLOAD_DOCS,
    Permission.MANAGE_SETTINGS,
    Permission.VIEW_FINANCIALS,
    Permission.MANAGE_PHASE2,
    Permission.CREATE_SHARE_LINK,
}

# Exactly the matrix in PRD Section 9. Administrator deliberately cannot
# verify/close (segregation of duties).
MATRIX: dict[str, set[str]] = {
    Role.ADMIN: {
        Permission.MANAGE_ORG,
        Permission.CONFIGURE_ENGINE,
        Permission.MANAGE_TEMPLATES,
        Permission.MANAGE_ITEMS,
        Permission.VIEW_ALL_ITEMS,
        Permission.UPDATE_ASSIGNED,
        Permission.DELETE_ARCHIVE,
        Permission.REASSIGN,
        Permission.VIEW_DASHBOARD_ALL,
        Permission.RUN_REPORTS_ALL,
        Permission.VIEW_AUDIT,
        Permission.DOWNLOAD_DOCS,
        Permission.MANAGE_SETTINGS,
        Permission.VIEW_FINANCIALS,
        Permission.MANAGE_PHASE2,
        Permission.CREATE_SHARE_LINK,
    },
    Role.COMPLIANCE: {
        Permission.CONFIGURE_ENGINE,
        Permission.MANAGE_TEMPLATES,
        Permission.MANAGE_ITEMS,
        Permission.VIEW_ALL_ITEMS,
        Permission.UPDATE_ASSIGNED,
        Permission.VERIFY_CLOSE,
        Permission.DELETE_ARCHIVE,
        Permission.REASSIGN,
        Permission.VIEW_DASHBOARD_ALL,
        Permission.RUN_REPORTS_ALL,
        Permission.VIEW_AUDIT,
        Permission.DOWNLOAD_DOCS,
        Permission.VIEW_FINANCIALS,
        Permission.MANAGE_PHASE2,
        Permission.CREATE_SHARE_LINK,
    },
    Role.DEPARTMENT: {
        Permission.VIEW_SCOPED_ITEMS,
        Permission.UPDATE_ASSIGNED,
        Permission.VIEW_DASHBOARD_SCOPED,
        Permission.RUN_REPORTS_SCOPED,
        Permission.DOWNLOAD_DOCS,
    },
    Role.MANAGEMENT: {
        Permission.VIEW_ALL_ITEMS,
        Permission.VIEW_DASHBOARD_ALL,
        Permission.RUN_REPORTS_ALL,
        Permission.DOWNLOAD_DOCS,
        Permission.VIEW_FINANCIALS,
    },
    Role.AUDITOR: {
        # Time-boxed, read-only, and scoped by the share link that admitted them.
        Permission.VIEW_SCOPED_ITEMS,
        Permission.DOWNLOAD_DOCS,
    },
}

READ_ONLY_ROLES = {Role.MANAGEMENT, Role.AUDITOR}


@dataclass(frozen=True, slots=True)
class Scope:
    """The Unit/Department restriction applied on top of the role."""

    all_units: bool
    unit_ids: frozenset[str]
    all_departments: bool
    department_id: str | None
    user_id: str
    # Department Users additionally see only rows they own or delegate, unless
    # the department grants wider visibility.
    own_rows_only: bool

    def allows_unit(self, unit_id: str | None) -> bool:
        if self.all_units:
            return True
        return unit_id in self.unit_ids

    def allows_department(self, department_id: str | None) -> bool:
        if self.all_departments:
            return True
        return department_id == self.department_id


def permissions_for(roles: list[str]) -> set[str]:
    granted: set[str] = set()
    for role in roles:
        granted |= MATRIX.get(role, set())
    return granted


def has_permission(roles: list[str], permission: str) -> bool:
    return permission in permissions_for(roles)


def build_scope(user) -> Scope:
    """Derive the data scope for a user object (any object with the same shape)."""
    roles = user.all_roles if hasattr(user, "all_roles") else [user.role]

    if Role.ADMIN in roles or Role.COMPLIANCE in roles:
        return Scope(True, frozenset(), True, user.department_id, user.id, False)

    if Role.MANAGEMENT in roles:
        # Management sees all units unless the account is unit-restricted
        # (open point 3 in Section 19 — configurable per user).
        unit_ids = frozenset(user.unit_ids or [])
        return Scope(
            all_units=not unit_ids,
            unit_ids=unit_ids,
            all_departments=True,
            department_id=user.department_id,
            user_id=user.id,
            own_rows_only=False,
        )

    # Department User (and Auditor): own unit(s), own department, own rows.
    return Scope(
        all_units=False,
        unit_ids=frozenset(user.unit_ids or []),
        all_departments=False,
        department_id=user.department_id,
        user_id=user.id,
        own_rows_only=True,
    )


def is_read_only(roles: list[str]) -> bool:
    """Management and Auditor never mutate the register."""
    return bool(roles) and all(r in READ_ONLY_ROLES for r in roles)
