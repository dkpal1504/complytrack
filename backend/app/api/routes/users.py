"""User administration: directory, provisioning, access review and orphan report."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.common import (
    CurrentUser,
    DbSession,
    bad_request,
    conflict,
    not_found,
    serialise_me,
    serialise_user,
)
from app.core.deps import Context, require
from app.core.rbac import Permission
from app.core.security import (
    WeakPasswordError,
    generate_temporary_password,
    hash_password,
    validate_password_policy,
)
from app.db.types import utcnow
from app.domain.enums import ItemStatus, UserStatus
from app.models.auth import User
from app.models.compliance import ComplianceItem
from app.models.org import Department, OrganisationUnit
from app.schemas.auth import UserCreate, UserUpdate
from app.services import audit
from app.services.queries import current_instance

router = APIRouter(prefix="/users", tags=["Users & roles"])

_ACTOR_KEYS = ("user_id", "user_email", "ip", "user_agent")


class PasswordReset(BaseModel):
    new_password: str | None = None


def _write_audit(
    db: Session,
    ctx: dict,
    *,
    entity_id: str | None,
    action: str,
    reason: str | None = None,
    changes: dict | None = None,
) -> None:
    """Append one user audit entry and commit the caller's write with it."""
    audit.write_audit(
        db,
        entity_type="user",
        entity_id=entity_id,
        action=action,
        reason=reason,
        changes=changes,
        **{k: (ctx or {}).get(k) for k in _ACTOR_KEYS},
    )
    db.commit()


def _name_map(db: Session, model) -> dict[str, str]:
    return dict(
        db.execute(select(model.id, model.name).where(model.is_deleted.is_(False))).all()
    )


def _owned_item_ids(db: Session, user_id: str) -> list[str]:
    return db.execute(
        select(ComplianceItem.id).where(
            ComplianceItem.owner_id == user_id, ComplianceItem.is_deleted.is_(False)
        )
    ).scalars().all()


def _open_owned_items(db: Session, user_id: str) -> list[str]:
    """Owned items whose current cycle is not Closed — the hand-over workload."""
    return [
        item_id
        for item_id in _owned_item_ids(db, user_id)
        if (instance := current_instance(db, item_id)) is None
        or instance.status != ItemStatus.CLOSED
    ]


# --------------------------------------------------------------------------- #
# Own profile
# --------------------------------------------------------------------------- #
@router.get("/me", summary="Your own profile, roles, permissions and scope")
def me(user: CurrentUser, db: DbSession) -> dict:
    return serialise_me(db, user)


# --------------------------------------------------------------------------- #
# Directory
# --------------------------------------------------------------------------- #
@router.get("", summary="Search, filter and page the user directory")
def list_users(
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    search: str | None = None,
    role: str | None = None,
    department_id: str | None = None,
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500),
) -> dict:
    stmt = select(User).where(User.is_deleted.is_(False))
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.name.ilike(like), User.email.ilike(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if department_id:
        stmt = stmt.where(User.department_id == department_id)
    if status:
        stmt = stmt.where(User.status == status)

    total = db.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()
    rows = db.execute(
        stmt.order_by(User.name).offset((page - 1) * page_size).limit(page_size)
    ).scalars().all()
    return {
        "items": [serialise_user(db, row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max((total + page_size - 1) // page_size, 1),
    }


@router.post("", status_code=201, summary="Create a user account")
def create_user(
    payload: UserCreate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    email = payload.email.lower()
    if db.execute(select(User.id).where(User.email == email)).scalar_one_or_none():
        raise conflict(f"{email} is already registered.")

    generated = payload.password is None
    password = payload.password or generate_temporary_password()
    data = payload.model_dump(exclude={"password"})
    data["email"] = email
    account = User(
        **data,
        password_hash=hash_password(password),
        must_change_password=True,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(account)
    db.flush()
    _write_audit(
        db, ctx, entity_id=account.id, action="create",
        reason=f"Created account for {email} as {account.role}.",
    )
    out = serialise_user(db, account)
    out["temporary_password"] = password if generated else None
    return out


@router.patch("/{user_id}", summary="Update a user; deactivation forces sign-out")
def update_user(
    user_id: str,
    payload: UserUpdate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    account = db.get(User, user_id)
    if account is None or account.is_deleted:
        raise not_found("User")

    data = payload.model_dump(exclude_unset=True)
    if data.get("email"):
        email = str(data["email"]).lower()
        clash = db.execute(
            select(User.id).where(User.email == email, User.id != account.id)
        ).scalar_one_or_none()
        if clash:
            raise conflict(f"{email} is already registered.")
        data["email"] = email

    deactivating = data.get("status") == UserStatus.INACTIVE
    new_password = data.pop("password", None)
    before = serialise_user(db, account)

    for key, value in data.items():
        setattr(account, key, value)
    if new_password:
        account.password_hash = hash_password(new_password)
        account.must_change_password = True
    if deactivating:
        # get_current_user rejects any token issued before this timestamp, so
        # bumping it here is the forced-logout switch (AC-04).
        account.last_login_at = utcnow()
    account.updated_by = user.id
    db.add(account)
    db.flush()

    after = serialise_user(db, account)
    _write_audit(
        db, ctx, entity_id=account.id, action="update",
        reason=f"Updated account {account.email}.",
        changes=audit.diff_entity(before, after, ignore={"last_login_at"}),
    )
    return {**after, "orphan_items": len(_open_owned_items(db, account.id)) if deactivating else 0}


@router.post("/{user_id}/reset-password", summary="Reset a user's password")
def reset_password(
    user_id: str,
    payload: PasswordReset,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    account = db.get(User, user_id)
    if account is None or account.is_deleted:
        raise not_found("User")

    generated = payload.new_password is None
    password = payload.new_password or generate_temporary_password()
    try:
        validate_password_policy(password)
    except WeakPasswordError as exc:
        raise bad_request(str(exc)) from exc

    account.password_hash = hash_password(password)
    account.must_change_password = True
    account.updated_by = user.id
    db.add(account)
    db.flush()
    _write_audit(
        db, ctx, entity_id=account.id, action="password_reset",
        reason=f"Password reset for {account.email}.",
    )
    return {
        "temporary_password": password if generated else None,
        "detail": f"Password reset for {account.email}.",
    }


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
@router.get("/access-review", summary="Flat access review for IT audit (AC-07)")
def access_review(
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
) -> list[dict]:
    users = db.execute(
        select(User).where(User.is_deleted.is_(False)).order_by(User.name)
    ).scalars().all()
    departments = _name_map(db, Department)
    units = _name_map(db, OrganisationUnit)
    owned = dict(
        db.execute(
            select(ComplianceItem.owner_id, func.count(ComplianceItem.id))
            .where(ComplianceItem.is_deleted.is_(False), ComplianceItem.owner_id.isnot(None))
            .group_by(ComplianceItem.owner_id)
        ).all()
    )

    return [
        {
            "id": row.id,
            "name": row.name,
            "email": row.email,
            "employee_id": row.employee_id,
            "role": row.role,
            "roles": row.all_roles,
            "department_id": row.department_id,
            "department_name": departments.get(row.department_id) if row.department_id else None,
            "unit_ids": row.unit_ids or [],
            "unit_names": [
                units[unit_id] for unit_id in (row.unit_ids or []) if unit_id in units
            ],
            "status": row.status,
            "mfa_enabled": bool(row.mfa_enabled),
            "must_change_password": bool(row.must_change_password),
            "last_login_at": row.last_login_at,
            "items_owned": owned.get(row.id, 0),
        }
        for row in users
    ]


@router.get("/orphans", summary="Items whose owner is inactive or removed (Section 18)")
def orphans(
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
) -> dict:
    items = db.execute(
        select(ComplianceItem)
        .where(ComplianceItem.is_deleted.is_(False), ComplianceItem.owner_id.isnot(None))
        .order_by(ComplianceItem.name)
    ).scalars().all()

    owner_ids = {item.owner_id for item in items}
    owners = (
        {
            row.id: row
            for row in db.execute(select(User).where(User.id.in_(owner_ids))).scalars().all()
        }
        if owner_ids
        else {}
    )
    units = _name_map(db, OrganisationUnit)
    departments = _name_map(db, Department)

    rows: list[dict] = []
    for item in items:
        owner = owners.get(item.owner_id)
        if owner is not None and not owner.is_deleted and owner.status == UserStatus.ACTIVE:
            continue
        instance = current_instance(db, item.id)
        rows.append(
            {
                "id": item.id,
                "item_code": item.item_code,
                "name": item.name,
                "owner_id": item.owner_id,
                "owner_name": owner.name if owner else None,
                "owner_email": owner.email if owner else None,
                "owner_status": "Removed" if owner is None or owner.is_deleted else owner.status,
                "unit_id": item.unit_id,
                "unit_name": units.get(item.unit_id) if item.unit_id else None,
                "department_id": item.department_id,
                "department_name": (
                    departments.get(item.department_id) if item.department_id else None
                ),
                "criticality": item.criticality,
                "expiry_date": item.expiry_date,
                "current_status": instance.status if instance else None,
            }
        )
    return {"items": rows, "total": len(rows)}
