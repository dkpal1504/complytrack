"""Helpers shared by the API routers."""

from __future__ import annotations

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.deps import CurrentScope, CurrentUser, DbSession
from app.models.auth import User
from app.models.org import Department


def not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found.")


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def context_from(request: Request, user: User) -> dict:
    """Audit stamps for a write, taken from the live request.

    ``Context`` (``Annotated[dict, Depends(...)]``) cannot be combined with a
    permission ``Depends(...)`` default on the same signature, so routers that
    gate on a permission build their context from the request instead.
    """
    return {
        "user_id": user.id,
        "user_email": user.email,
        "ip": request.client.host if request.client else None,
        "user_agent": request.headers.get("user-agent"),
    }


def serialise_user(db: Session, user: User) -> dict:
    department = db.get(Department, user.department_id) if user.department_id else None
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "mobile": user.mobile,
        "employee_id": user.employee_id,
        "department_id": user.department_id,
        "department_name": department.name if department else None,
        "unit_ids": user.unit_ids or [],
        "role": user.role,
        "status": user.status,
        "mfa_enabled": bool(user.mfa_enabled),
        "last_login_at": user.last_login_at,
    }


def serialise_me(db: Session, user: User) -> dict:
    payload = serialise_user(db, user)
    scope = rbac.build_scope(user)
    payload["roles"] = user.all_roles
    payload["permissions"] = sorted(rbac.permissions_for(user.all_roles))
    payload["scope"] = {
        "all_units": scope.all_units,
        "unit_ids": sorted(scope.unit_ids),
        "all_departments": scope.all_departments,
        "department_id": scope.department_id,
        "read_only": rbac.is_read_only(user.all_roles),
    }
    return payload


def parse_filters(
    *,
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
    criticality: str | None = None,
    owner_id: str | None = None,
    status_value: str | None = None,
    bucket: str | None = None,
    search: str | None = None,
    period_from: date | None = None,
    period_to: date | None = None,
    type_value: str | None = None,
) -> dict:
    return {
        "unit_id": unit_id,
        "department_id": department_id,
        "category_id": category_id,
        "criticality": criticality,
        "owner_id": owner_id,
        "status": status_value,
        "bucket": bucket,
        "search": search,
        "period_from": period_from,
        "period_to": period_to,
        "type": type_value,
    }


# Re-exported for route modules so each one imports from a single place.
__all__ = [
    "CurrentScope", "CurrentUser", "DbSession", "bad_request", "conflict", "forbidden",
    "not_found", "parse_filters", "serialise_me", "serialise_user",
]
