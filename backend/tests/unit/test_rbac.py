"""Pure unit tests for server-side RBAC and data scoping (``app.core.rbac``).

Mirrors the PRD Section 9 capability matrix, one granted and one denied
permission at a time, plus the Unit/Department scope each role resolves to.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.core.rbac import (
    MATRIX,
    Permission,
    Scope,
    build_scope,
    has_permission,
    is_read_only,
    permissions_for,
)
from app.domain.enums import Role


# --------------------------------------------------------------------------- #
# Granted permissions — one representative per PRD row
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("role", "permission"),
    [
        # Administrator
        (Role.ADMIN, Permission.MANAGE_ORG),
        (Role.ADMIN, Permission.CONFIGURE_ENGINE),
        (Role.ADMIN, Permission.MANAGE_ITEMS),
        (Role.ADMIN, Permission.VIEW_ALL_ITEMS),
        (Role.ADMIN, Permission.UPDATE_ASSIGNED),
        (Role.ADMIN, Permission.DELETE_ARCHIVE),
        (Role.ADMIN, Permission.REASSIGN),
        (Role.ADMIN, Permission.VIEW_DASHBOARD_ALL),
        (Role.ADMIN, Permission.RUN_REPORTS_ALL),
        (Role.ADMIN, Permission.VIEW_AUDIT),
        (Role.ADMIN, Permission.DOWNLOAD_DOCS),
        (Role.ADMIN, Permission.MANAGE_SETTINGS),
        # Compliance Team
        (Role.COMPLIANCE, Permission.CONFIGURE_ENGINE),
        (Role.COMPLIANCE, Permission.MANAGE_TEMPLATES),
        (Role.COMPLIANCE, Permission.MANAGE_ITEMS),
        (Role.COMPLIANCE, Permission.VIEW_ALL_ITEMS),
        (Role.COMPLIANCE, Permission.VERIFY_CLOSE),
        (Role.COMPLIANCE, Permission.DELETE_ARCHIVE),
        (Role.COMPLIANCE, Permission.REASSIGN),
        (Role.COMPLIANCE, Permission.VIEW_DASHBOARD_ALL),
        (Role.COMPLIANCE, Permission.RUN_REPORTS_ALL),
        (Role.COMPLIANCE, Permission.VIEW_AUDIT),
        (Role.COMPLIANCE, Permission.DOWNLOAD_DOCS),
        # Department User
        (Role.DEPARTMENT, Permission.VIEW_SCOPED_ITEMS),
        (Role.DEPARTMENT, Permission.UPDATE_ASSIGNED),
        (Role.DEPARTMENT, Permission.VIEW_DASHBOARD_SCOPED),
        (Role.DEPARTMENT, Permission.RUN_REPORTS_SCOPED),
        (Role.DEPARTMENT, Permission.DOWNLOAD_DOCS),
        # Management View
        (Role.MANAGEMENT, Permission.VIEW_ALL_ITEMS),
        (Role.MANAGEMENT, Permission.VIEW_DASHBOARD_ALL),
        (Role.MANAGEMENT, Permission.RUN_REPORTS_ALL),
        (Role.MANAGEMENT, Permission.DOWNLOAD_DOCS),
        (Role.MANAGEMENT, Permission.VIEW_FINANCIALS),
        # Auditor (time-boxed read-only share)
        (Role.AUDITOR, Permission.VIEW_SCOPED_ITEMS),
        (Role.AUDITOR, Permission.DOWNLOAD_DOCS),
    ],
)
def test_granted_permissions(role: str, permission: str) -> None:
    assert has_permission([role], permission) is True


# --------------------------------------------------------------------------- #
# Denied permissions — the other half of the matrix
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("role", "permission"),
    [
        # Administrator: segregation of duties — never verifies or closes.
        (Role.ADMIN, Permission.VERIFY_CLOSE),
        (Role.ADMIN, Permission.VIEW_SCOPED_ITEMS),
        (Role.ADMIN, Permission.VIEW_DASHBOARD_SCOPED),
        (Role.ADMIN, Permission.RUN_REPORTS_SCOPED),
        # Compliance Team: no organisation administration, no system settings.
        (Role.COMPLIANCE, Permission.MANAGE_ORG),
        (Role.COMPLIANCE, Permission.MANAGE_SETTINGS),
        (Role.COMPLIANCE, Permission.VIEW_SCOPED_ITEMS),
        (Role.COMPLIANCE, Permission.VIEW_DASHBOARD_SCOPED),
        # Department User: cannot see everything, cannot manage or verify.
        (Role.DEPARTMENT, Permission.VIEW_ALL_ITEMS),
        (Role.DEPARTMENT, Permission.MANAGE_ITEMS),
        (Role.DEPARTMENT, Permission.MANAGE_ORG),
        (Role.DEPARTMENT, Permission.VERIFY_CLOSE),
        (Role.DEPARTMENT, Permission.DELETE_ARCHIVE),
        (Role.DEPARTMENT, Permission.REASSIGN),
        (Role.DEPARTMENT, Permission.VIEW_DASHBOARD_ALL),
        (Role.DEPARTMENT, Permission.RUN_REPORTS_ALL),
        (Role.DEPARTMENT, Permission.VIEW_AUDIT),
        (Role.DEPARTMENT, Permission.VIEW_FINANCIALS),
        # Management View: read-only.
        (Role.MANAGEMENT, Permission.UPDATE_ASSIGNED),
        (Role.MANAGEMENT, Permission.MANAGE_ITEMS),
        (Role.MANAGEMENT, Permission.MANAGE_ORG),
        (Role.MANAGEMENT, Permission.VERIFY_CLOSE),
        (Role.MANAGEMENT, Permission.VIEW_AUDIT),
        (Role.MANAGEMENT, Permission.VIEW_SCOPED_ITEMS),
        # Auditor: read-only, and not a register administrator.
        (Role.AUDITOR, Permission.VIEW_ALL_ITEMS),
        (Role.AUDITOR, Permission.VIEW_AUDIT),
        (Role.AUDITOR, Permission.MANAGE_ITEMS),
        (Role.AUDITOR, Permission.UPDATE_ASSIGNED),
        (Role.AUDITOR, Permission.VERIFY_CLOSE),
        (Role.AUDITOR, Permission.VIEW_DASHBOARD_ALL),
        (Role.AUDITOR, Permission.RUN_REPORTS_ALL),
    ],
)
def test_denied_permissions(role: str, permission: str) -> None:
    assert has_permission([role], permission) is False


def test_every_matrix_entry_is_a_known_permission() -> None:
    known = {value for name, value in vars(Permission).items() if not name.startswith("_")}
    for role, permissions in MATRIX.items():
        assert permissions, f"{role} has an empty permission set"
        assert permissions <= known, f"{role} grants an unknown permission"


def test_permissions_for_unions_multiple_roles() -> None:
    # A user who is both a Department User and Compliance gets both scopes.
    granted = permissions_for([Role.DEPARTMENT, Role.COMPLIANCE])
    assert Permission.VERIFY_CLOSE in granted
    assert Permission.VIEW_SCOPED_ITEMS in granted
    assert Permission.MANAGE_ORG not in granted


def test_permissions_for_an_unknown_role_is_empty() -> None:
    assert permissions_for(["Freelancer"]) == set()
    assert has_permission(["Freelancer"], Permission.VIEW_ALL_ITEMS) is False


# --------------------------------------------------------------------------- #
# Read-only roles
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("role", [Role.MANAGEMENT, Role.AUDITOR])
def test_management_and_auditor_are_read_only(role: str) -> None:
    assert is_read_only([role]) is True


@pytest.mark.parametrize("role", [Role.ADMIN, Role.COMPLIANCE, Role.DEPARTMENT])
def test_operational_roles_are_not_read_only(role: str) -> None:
    assert is_read_only([role]) is False


def test_a_dual_read_only_and_operational_user_is_not_read_only() -> None:
    assert is_read_only([Role.AUDITOR, Role.COMPLIANCE]) is False


def test_no_roles_is_not_read_only() -> None:
    assert is_read_only([]) is False


# --------------------------------------------------------------------------- #
# build_scope
# --------------------------------------------------------------------------- #
def _user(role: str, **overrides) -> SimpleNamespace:
    base = {
        "id": "user-1",
        "role": role,
        "department_id": "dept-1",
        "unit_ids": ["unit-1"],
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_admin_and_compliance_scope_is_everything() -> None:
    for role in (Role.ADMIN, Role.COMPLIANCE):
        scope = build_scope(_user(role))
        assert isinstance(scope, Scope)
        assert scope.all_units is True
        assert scope.all_departments is True
        assert scope.own_rows_only is False


def test_management_sees_all_units_unless_the_account_is_unit_restricted() -> None:
    unrestricted = build_scope(_user(Role.MANAGEMENT, unit_ids=[]))
    assert unrestricted.all_units is True
    assert unrestricted.all_departments is True

    restricted = build_scope(_user(Role.MANAGEMENT, unit_ids=["unit-1"]))
    assert restricted.all_units is False
    assert restricted.unit_ids == frozenset({"unit-1"})
    assert restricted.all_departments is True
    assert restricted.own_rows_only is False


@pytest.mark.parametrize("role", [Role.DEPARTMENT, Role.AUDITOR])
def test_department_user_and_auditor_are_confined_to_their_own_rows(role: str) -> None:
    scope = build_scope(_user(role))
    assert scope.all_units is False
    assert scope.unit_ids == frozenset({"unit-1"})
    assert scope.all_departments is False
    assert scope.department_id == "dept-1"
    assert scope.own_rows_only is True


def test_scope_uses_all_roles_when_the_user_holds_several() -> None:
    user = _user(Role.DEPARTMENT, all_roles=[Role.DEPARTMENT, Role.COMPLIANCE])
    scope = build_scope(user)
    assert scope.all_units is True  # the Compliance role widens it


def test_scope_allows_unit_and_department_checks() -> None:
    wide = build_scope(_user(Role.ADMIN))
    assert wide.allows_unit("anything") is True
    assert wide.allows_unit(None) is True
    assert wide.allows_department("any-dept") is True

    narrow = build_scope(_user(Role.DEPARTMENT))
    assert narrow.allows_unit("unit-1") is True
    assert narrow.allows_unit("unit-2") is False
    assert narrow.allows_unit(None) is False
    assert narrow.allows_department("dept-1") is True
    assert narrow.allows_department("dept-2") is False
