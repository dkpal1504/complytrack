"""Scoped query builders shared by every service.

RBAC data scoping is applied here — once, centrally — so no endpoint can
accidentally leak another department's register (AC-02, AC-04).
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import Select, or_, select, false
from sqlalchemy.orm import Session

from app.core.rbac import Scope
from app.domain.enums import ItemStatus
from app.models.compliance import ComplianceInstance, ComplianceItem
from app.models.org import Category, Department, IssuingAuthority, OrganisationUnit
from app.models.auth import User


def apply_item_scope(stmt: Select, scope: Scope) -> Select:
    """Restrict a compliance_item query to what the caller may see."""
    if not scope.all_units:
        if scope.unit_ids:
            stmt = stmt.where(ComplianceItem.unit_id.in_(tuple(scope.unit_ids)))
        else:
            # No unit granted yet — fail closed rather than open.
            stmt = stmt.where(false())
    if not scope.all_departments:
        stmt = stmt.where(ComplianceItem.department_id == scope.department_id)
    if scope.own_rows_only:
        # A Department User sees the department register, and only edits their
        # own rows (enforced separately in the write path).
        pass
    return stmt


def scoped_items(db: Session, scope: Scope, *, include_archived: bool = False) -> Select:
    stmt = select(ComplianceItem)
    if not include_archived:
        stmt = stmt.where(ComplianceItem.is_deleted.is_(False))
    return apply_item_scope(stmt, scope)


def current_instance(db: Session, item_id: str) -> ComplianceInstance | None:
    """The open cycle, else the most recent one."""
    open_row = db.execute(
        select(ComplianceInstance)
        .where(
            ComplianceInstance.item_id == item_id,
            ComplianceInstance.is_deleted.is_(False),
            ComplianceInstance.status.in_(
                (
                    ItemStatus.PENDING,
                    ItemStatus.UNDER_PROCESS,
                    ItemStatus.SUBMITTED,
                    ItemStatus.RENEWED,
                    ItemStatus.ON_HOLD,
                    ItemStatus.QUERY_RAISED,
                )
            ),
        )
        .order_by(ComplianceInstance.due_date.asc().nulls_last())
        .limit(1)
    ).scalar_one_or_none()
    if open_row is not None:
        return open_row

    return db.execute(
        select(ComplianceInstance)
        .where(ComplianceInstance.item_id == item_id, ComplianceInstance.is_deleted.is_(False))
        .order_by(ComplianceInstance.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def open_instance_count(db: Session, item_id: str) -> int:
    return len(
        db.execute(
            select(ComplianceInstance.id).where(
                ComplianceInstance.item_id == item_id,
                ComplianceInstance.is_deleted.is_(False),
                ComplianceInstance.status.in_(
                    (ItemStatus.PENDING, ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED,
                     ItemStatus.RENEWED, ItemStatus.QUERY_RAISED)
                ),
            )
        ).scalars().all()
    )


def lookup_maps(db: Session) -> dict[str, dict[str, str]]:
    """id -> name maps so list serialisation stays O(1) per row."""
    def mapping(model, name_field="name"):
        rows = db.execute(select(model.id, getattr(model, name_field))).all()
        return {r[0]: r[1] for r in rows}

    units = mapping(OrganisationUnit)
    departments = mapping(Department)
    categories = mapping(Category)
    authorities = mapping(IssuingAuthority)
    users = mapping(User)
    return {
        "unit": units,
        "department": departments,
        "category": categories,
        "authority": authorities,
        "user": users,
    }


def holidays_for(db: Session, state: str | None) -> set[date]:
    from app.models.org import HolidayCalendar

    stmt = select(HolidayCalendar.date)
    if state:
        stmt = stmt.where(or_(HolidayCalendar.state == state, HolidayCalendar.state == "ALL"))
    rows = db.execute(stmt).scalars().all()
    return set(rows)


def user_or_none(db: Session, user_id: str | None) -> User | None:
    if not user_id:
        return None
    user = db.get(User, user_id)
    if user is None or user.is_deleted:
        return None
    return user


def department_head(db: Session, department_id: str | None) -> User | None:
    if not department_id:
        return None
    dept = db.get(Department, department_id)
    return user_or_none(db, dept.head_user_id) if dept else None


def users_with_role(db: Session, role: str, unit_id: str | None = None) -> list[User]:
    stmt = select(User).where(
        User.is_deleted.is_(False),
        User.role == role,
        User.status == "Active",
    )
    users = list(db.execute(stmt).scalars().all())
    if unit_id:
        users = [
            u for u in users
            if not u.unit_ids or unit_id in (u.unit_ids or [])
        ]
    return users


def unit_head(db: Session, unit_id: str | None) -> User | None:
    """Best available 'head of unit' — the Management View account for that unit."""
    if not unit_id:
        return None
    candidates = users_with_role(db, "Management View", unit_id)
    return candidates[0] if candidates else None
