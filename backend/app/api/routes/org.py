"""Master-data routes: units, departments, authorities, categories, legal refs,
holidays, settings and the combined form lookup feed.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.common import CurrentUser, DbSession, conflict, not_found
from app.core.deps import Context, require
from app.core.rbac import Permission
from app.db.types import utcnow
from app.domain.enums import (
    Criticality,
    ItemStatus,
    ItemType,
    RecurrenceKind,
    Role,
    UserStatus,
    ValidityUnit,
)
from app.models.auth import User
from app.models.compliance import ComplianceItem
from app.models.org import (
    Category,
    Department,
    HolidayCalendar,
    IssuingAuthority,
    LegalReference,
    OrganisationUnit,
    Setting,
)
from app.schemas.org import (
    AuthorityCreate,
    AuthorityUpdate,
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    DepartmentCreate,
    DepartmentUpdate,
    HolidayCreate,
    LegalReferenceCreate,
    SettingUpdate,
    UnitCreate,
    UnitOut,
    UnitUpdate,
)
from app.services import audit, mail_config

router = APIRouter(prefix="/org", tags=["Master data"])

_ACTOR_KEYS = ("user_id", "user_email", "ip", "user_agent")


def _write_audit(
    db: Session,
    ctx: dict,
    *,
    entity_type: str,
    entity_id: str | None,
    action: str,
    reason: str | None = None,
    changes: dict | None = None,
) -> None:
    """Append one audit entry and commit the caller's write with it."""
    audit.write_audit(
        db,
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        reason=reason,
        changes=changes,
        **{k: (ctx or {}).get(k) for k in _ACTOR_KEYS},
    )
    db.commit()


def _counts_by(db: Session, model, column) -> dict[str, int]:
    """One grouped query per foreign key instead of a count per row."""
    rows = db.execute(
        select(column, func.count(model.id))
        .where(model.is_deleted.is_(False), column.isnot(None))
        .group_by(column)
    ).all()
    return {row[0]: row[1] for row in rows}


def _name_map(db: Session, model) -> dict[str, str]:
    return dict(
        db.execute(select(model.id, model.name).where(model.is_deleted.is_(False))).all()
    )


def _unit_dict(unit: OrganisationUnit, item_count: int = 0) -> dict:
    return {
        "id": unit.id,
        "code": unit.code,
        "name": unit.name,
        "type": unit.type,
        "parent_id": unit.parent_id,
        "address": unit.address,
        "state": unit.state,
        "gstin": unit.gstin,
        "active": unit.active,
        "item_count": item_count,
    }


def _department_dict(
    department: Department,
    *,
    head_user_name: str | None,
    unit_name: str | None,
    item_count: int,
    user_count: int,
) -> dict:
    return {
        "id": department.id,
        "code": department.code,
        "name": department.name,
        "head_user_id": department.head_user_id,
        "head_user_name": head_user_name,
        "unit_id": department.unit_id,
        "unit_name": unit_name,
        "item_count": item_count,
        "user_count": user_count,
    }


# --------------------------------------------------------------------------- #
# Units
# --------------------------------------------------------------------------- #
@router.get("/units", summary="Organisation units with their live item counts")
def list_units(db: DbSession, user: CurrentUser) -> list[dict]:
    counts = _counts_by(db, ComplianceItem, ComplianceItem.unit_id)
    rows = db.execute(
        select(OrganisationUnit)
        .where(OrganisationUnit.is_deleted.is_(False))
        .order_by(OrganisationUnit.name)
    ).scalars().all()
    return [_unit_dict(unit, counts.get(unit.id, 0)) for unit in rows]


@router.post(
    "/units", response_model=UnitOut, status_code=201, summary="Create an organisation unit"
)
def create_unit(
    payload: UnitCreate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    clash = db.execute(
        select(OrganisationUnit.id).where(OrganisationUnit.code == payload.code)
    ).scalar_one_or_none()
    if clash:
        raise conflict(f"Unit code '{payload.code}' is already in use.")

    unit = OrganisationUnit(**payload.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(unit)
    db.flush()
    _write_audit(
        db, ctx, entity_type="organisation_unit", entity_id=unit.id, action="create",
        reason=f"Created unit {unit.code} — {unit.name}.",
    )
    return _unit_dict(unit)


@router.patch(
    "/units/{unit_id}", response_model=UnitOut, summary="Update an organisation unit"
)
def update_unit(
    unit_id: str,
    payload: UnitUpdate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    unit = db.get(OrganisationUnit, unit_id)
    if unit is None or unit.is_deleted:
        raise not_found("Organisation unit")

    before = _unit_dict(unit)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(unit, key, value)
    unit.updated_by = user.id
    db.add(unit)
    db.flush()
    after = _unit_dict(unit)
    _write_audit(
        db, ctx, entity_type="organisation_unit", entity_id=unit.id, action="update",
        reason=f"Updated unit {unit.code}.",
        changes=audit.diff_entity(before, after, ignore={"item_count"}),
    )
    return after


# --------------------------------------------------------------------------- #
# Departments
# --------------------------------------------------------------------------- #
@router.get("/departments", summary="Departments with head, unit and workload counts")
def list_departments(db: DbSession, user: CurrentUser) -> list[dict]:
    item_counts = _counts_by(db, ComplianceItem, ComplianceItem.department_id)
    user_counts = _counts_by(db, User, User.department_id)
    names = _name_map(db, User)
    units = _name_map(db, OrganisationUnit)
    rows = db.execute(
        select(Department).where(Department.is_deleted.is_(False)).order_by(Department.name)
    ).scalars().all()
    return [
        _department_dict(
            department,
            head_user_name=names.get(department.head_user_id) if department.head_user_id else None,
            unit_name=units.get(department.unit_id) if department.unit_id else None,
            item_count=item_counts.get(department.id, 0),
            user_count=user_counts.get(department.id, 0),
        )
        for department in rows
    ]


@router.post("/departments", status_code=201, summary="Create a department")
def create_department(
    payload: DepartmentCreate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    clash = db.execute(
        select(Department.id).where(Department.code == payload.code)
    ).scalar_one_or_none()
    if clash:
        raise conflict(f"Department code '{payload.code}' is already in use.")

    department = Department(**payload.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(department)
    db.flush()
    _write_audit(
        db, ctx, entity_type="department", entity_id=department.id, action="create",
        reason=f"Created department {department.code} — {department.name}.",
    )
    return _department_dict(
        department, head_user_name=None, unit_name=None, item_count=0, user_count=0
    )


@router.patch("/departments/{department_id}", summary="Update a department")
def update_department(
    department_id: str,
    payload: DepartmentUpdate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    department = db.get(Department, department_id)
    if department is None or department.is_deleted:
        raise not_found("Department")

    before = _department_dict(
        department, head_user_name=None, unit_name=None, item_count=0, user_count=0
    )
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(department, key, value)
    department.updated_by = user.id
    db.add(department)
    db.flush()

    names = _name_map(db, User)
    units = _name_map(db, OrganisationUnit)
    after = _department_dict(
        department,
        head_user_name=names.get(department.head_user_id) if department.head_user_id else None,
        unit_name=units.get(department.unit_id) if department.unit_id else None,
        item_count=0,
        user_count=0,
    )
    _write_audit(
        db, ctx, entity_type="department", entity_id=department.id, action="update",
        reason=f"Updated department {department.code}.",
        changes=audit.diff_entity(before, after),
    )
    return after


# --------------------------------------------------------------------------- #
# Issuing authorities
# --------------------------------------------------------------------------- #
@router.get("/authorities", summary="Issuing authorities with item counts")
def list_authorities(db: DbSession, user: CurrentUser) -> list[dict]:
    counts = _counts_by(db, ComplianceItem, ComplianceItem.authority_id)
    rows = db.execute(
        select(IssuingAuthority)
        .where(IssuingAuthority.is_deleted.is_(False))
        .order_by(IssuingAuthority.name)
    ).scalars().all()
    return [
        {
            "id": row.id,
            "name": row.name,
            "level": row.level,
            "website": row.website,
            "contact": row.contact,
            "default_processing_days": row.default_processing_days,
            "item_count": counts.get(row.id, 0),
        }
        for row in rows
    ]


@router.post("/authorities", status_code=201, summary="Create an issuing authority")
def create_authority(
    payload: AuthorityCreate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    authority = IssuingAuthority(**payload.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(authority)
    db.flush()
    _write_audit(
        db, ctx, entity_type="issuing_authority", entity_id=authority.id, action="create",
        reason=f"Created authority {authority.name}.",
    )
    return {
        "id": authority.id,
        "name": authority.name,
        "level": authority.level,
        "website": authority.website,
        "contact": authority.contact,
        "default_processing_days": authority.default_processing_days,
        "item_count": 0,
    }


@router.patch("/authorities/{authority_id}", summary="Update an issuing authority")
def update_authority(
    authority_id: str,
    payload: AuthorityUpdate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    authority = db.get(IssuingAuthority, authority_id)
    if authority is None or authority.is_deleted:
        raise not_found("Issuing authority")

    before = {
        "name": authority.name, "level": authority.level, "website": authority.website,
        "contact": authority.contact,
        "default_processing_days": authority.default_processing_days,
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(authority, key, value)
    authority.updated_by = user.id
    db.add(authority)
    db.flush()
    after = {
        "name": authority.name, "level": authority.level, "website": authority.website,
        "contact": authority.contact,
        "default_processing_days": authority.default_processing_days,
    }
    _write_audit(
        db, ctx, entity_type="issuing_authority", entity_id=authority.id, action="update",
        reason=f"Updated authority {authority.name}.",
        changes=audit.diff_entity(before, after),
    )
    return {**after, "id": authority.id, "item_count": 0}


# --------------------------------------------------------------------------- #
# Categories (self-referencing tree)
# --------------------------------------------------------------------------- #
def _category_node(
    category: Category,
    by_parent: dict[str | None, list[Category]],
    names: dict[str, str],
    counts: dict[str, int],
) -> CategoryOut:
    return CategoryOut(
        id=category.id,
        name=category.name,
        parent_id=category.parent_id,
        parent_name=names.get(category.parent_id),
        colour=category.colour,
        sort_order=category.sort_order,
        item_count=counts.get(category.id, 0),
        children=[
            _category_node(child, by_parent, names, counts)
            for child in by_parent.get(category.id, [])
        ],
    )


@router.get(
    "/categories", response_model=list[CategoryOut], summary="Category tree with item counts"
)
def list_categories(db: DbSession, user: CurrentUser) -> list[CategoryOut]:
    counts = _counts_by(db, ComplianceItem, ComplianceItem.category_id)
    rows = db.execute(
        select(Category)
        .where(Category.is_deleted.is_(False))
        .order_by(Category.sort_order, Category.name)
    ).scalars().all()

    names = {row.id: row.name for row in rows}
    by_parent: dict[str | None, list[Category]] = {}
    for row in rows:
        by_parent.setdefault(row.parent_id, []).append(row)

    # A category whose parent is archived still surfaces, as a root.
    roots = [row for row in rows if row.parent_id is None or row.parent_id not in names]
    return [_category_node(root, by_parent, names, counts) for root in roots]


@router.post("/categories", status_code=201, summary="Create a category")
def create_category(
    payload: CategoryCreate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    parent_name = None
    if payload.parent_id:
        parent = db.get(Category, payload.parent_id)
        if parent is None or parent.is_deleted:
            raise not_found("Parent category")
        parent_name = parent.name

    category = Category(**payload.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(category)
    db.flush()
    _write_audit(
        db, ctx, entity_type="category", entity_id=category.id, action="create",
        reason=f"Created category {category.name}.",
    )
    return {
        "id": category.id, "name": category.name, "parent_id": category.parent_id,
        "parent_name": parent_name, "colour": category.colour,
        "sort_order": category.sort_order, "item_count": 0, "children": [],
    }


@router.patch("/categories/{category_id}", summary="Update a category")
def update_category(
    category_id: str,
    payload: CategoryUpdate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    category = db.get(Category, category_id)
    if category is None or category.is_deleted:
        raise not_found("Category")

    before = {
        "name": category.name, "parent_id": category.parent_id,
        "colour": category.colour, "sort_order": category.sort_order,
    }
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, key, value)
    category.updated_by = user.id
    db.add(category)
    db.flush()
    after = {
        "name": category.name, "parent_id": category.parent_id,
        "colour": category.colour, "sort_order": category.sort_order,
    }
    _write_audit(
        db, ctx, entity_type="category", entity_id=category.id, action="update",
        reason=f"Updated category {category.name}.",
        changes=audit.diff_entity(before, after),
    )
    return {
        **after, "id": category.id,
        "parent_name": _name_map(db, Category).get(category.parent_id),
        "item_count": _counts_by(db, ComplianceItem, ComplianceItem.category_id).get(
            category.id, 0
        ),
    }


# --------------------------------------------------------------------------- #
# Legal references
# --------------------------------------------------------------------------- #
@router.get("/legal-references", summary="Statutory/legal reference library")
def list_legal_references(db: DbSession, user: CurrentUser) -> list[dict]:
    rows = db.execute(
        select(LegalReference)
        .where(LegalReference.is_deleted.is_(False))
        .order_by(LegalReference.act_rule_name)
    ).scalars().all()
    return [
        {
            "id": row.id, "act_rule_name": row.act_rule_name, "section": row.section,
            "jurisdiction": row.jurisdiction, "description": row.description,
        }
        for row in rows
    ]


@router.post("/legal-references", status_code=201, summary="Add a legal reference")
def create_legal_reference(
    payload: LegalReferenceCreate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    reference = LegalReference(**payload.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(reference)
    db.flush()
    _write_audit(
        db, ctx, entity_type="legal_reference", entity_id=reference.id, action="create",
        reason=f"Added legal reference {reference.act_rule_name}.",
    )
    return {
        "id": reference.id, "act_rule_name": reference.act_rule_name,
        "section": reference.section, "jurisdiction": reference.jurisdiction,
        "description": reference.description,
    }


# --------------------------------------------------------------------------- #
# Holiday calendar
# --------------------------------------------------------------------------- #
@router.get("/holidays", summary="Holiday calendar (state-wise plus ALL)")
def list_holidays(db: DbSession, user: CurrentUser, state: str | None = None) -> list[dict]:
    stmt = select(HolidayCalendar).where(HolidayCalendar.is_deleted.is_(False))
    if state:
        stmt = stmt.where(
            or_(HolidayCalendar.state == state, HolidayCalendar.state == "ALL")
        )
    rows = db.execute(stmt.order_by(HolidayCalendar.date)).scalars().all()
    return [
        {"id": row.id, "state": row.state, "date": row.date, "name": row.name}
        for row in rows
    ]


@router.post("/holidays", status_code=201, summary="Add a holiday")
def create_holiday(
    payload: HolidayCreate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    holiday = HolidayCalendar(**payload.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(holiday)
    db.flush()
    _write_audit(
        db, ctx, entity_type="holiday_calendar", entity_id=holiday.id, action="create",
        reason=f"Added holiday {holiday.name} on {holiday.date}.",
    )
    return {"id": holiday.id, "state": holiday.state, "date": holiday.date, "name": holiday.name}


@router.delete("/holidays/{holiday_id}", summary="Remove a holiday (soft delete)")
def delete_holiday(
    holiday_id: str,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_ORG)),
    ctx: Context = None,
) -> dict:
    holiday = db.get(HolidayCalendar, holiday_id)
    if holiday is None or holiday.is_deleted:
        raise not_found("Holiday")

    holiday.is_deleted = True
    holiday.deleted_at = utcnow()
    holiday.deleted_by = user.id
    db.add(holiday)
    db.flush()
    _write_audit(
        db, ctx, entity_type="holiday_calendar", entity_id=holiday.id, action="delete",
        reason=f"Removed holiday {holiday.name} on {holiday.date}.",
    )
    return {"detail": "Holiday removed.", "ok": True}


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
def _setting_dict(setting: Setting) -> dict:
    return {
        "id": setting.id, "key": setting.key,
        # This route echoes values verbatim, so anything secret is masked here as
        # a backstop. Such keys are also filtered out of the listing below, which
        # is what the settings screen actually sees.
        "value": "***redacted***" if setting.key in mail_config.SECRET_KEYS else setting.value,
        "description": setting.description,
    }


@router.get("/settings", summary="All configuration settings")
def list_settings(
    db: DbSession, user: User = Depends(require(Permission.MANAGE_SETTINGS))
) -> list[dict]:
    rows = db.execute(
        select(Setting)
        .where(
            Setting.is_deleted.is_(False),
            # Secrets are omitted rather than masked: this generic editor would
            # otherwise offer the value for editing and write the mask back over
            # the real one. They are set on the mail settings screen instead.
            Setting.key.not_in(mail_config.SECRET_KEYS),
        )
        .order_by(Setting.key)
    ).scalars().all()
    return [_setting_dict(row) for row in rows]


@router.put("/settings/{key}", summary="Create or replace a configuration value")
def update_setting(
    key: str,
    payload: SettingUpdate,
    db: DbSession,
    user: User = Depends(require(Permission.MANAGE_SETTINGS)),
    ctx: Context = None,
) -> dict:
    setting = db.execute(select(Setting).where(Setting.key == key)).scalar_one_or_none()
    created = setting is None
    if setting is None:
        setting = Setting(key=key, created_by=user.id)
    else:
        setting.is_deleted = False
        setting.deleted_at = None
    setting.value = payload.value
    setting.updated_by = user.id
    db.add(setting)
    db.flush()
    _write_audit(
        db, ctx, entity_type="setting", entity_id=setting.id,
        action="create" if created else "update",
        reason=f"{'Created' if created else 'Updated'} setting '{key}'.",
    )
    return _setting_dict(setting)


# --------------------------------------------------------------------------- #
# Combined lookup feed for every form in the UI
# --------------------------------------------------------------------------- #
@router.get("/lookups", summary="Everything a form needs in one call")
def lookups(db: DbSession, user: CurrentUser) -> dict:
    units = db.execute(
        select(OrganisationUnit)
        .where(OrganisationUnit.is_deleted.is_(False))
        .order_by(OrganisationUnit.name)
    ).scalars().all()
    departments = db.execute(
        select(Department).where(Department.is_deleted.is_(False)).order_by(Department.name)
    ).scalars().all()
    categories = db.execute(
        select(Category)
        .where(Category.is_deleted.is_(False))
        .order_by(Category.sort_order, Category.name)
    ).scalars().all()
    authorities = db.execute(
        select(IssuingAuthority)
        .where(IssuingAuthority.is_deleted.is_(False))
        .order_by(IssuingAuthority.name)
    ).scalars().all()
    users = db.execute(
        select(User)
        .where(User.is_deleted.is_(False), User.status == UserStatus.ACTIVE)
        .order_by(User.name)
    ).scalars().all()
    department_names = {row.id: row.name for row in departments}

    return {
        "units": [{"id": u.id, "name": u.name, "code": u.code} for u in units],
        "departments": [{"id": d.id, "name": d.name, "code": d.code} for d in departments],
        "categories": [{"id": c.id, "name": c.name, "parent_id": c.parent_id} for c in categories],
        "authorities": [{"id": a.id, "name": a.name} for a in authorities],
        "users": [
            {
                "id": u.id, "name": u.name, "email": u.email, "role": u.role,
                "department_name": department_names.get(u.department_id),
                "status": u.status,
            }
            for u in users
        ],
        "criticalities": [e.value for e in Criticality],
        "item_types": [e.value for e in ItemType],
        "statuses": [e.value for e in ItemStatus],
        "validity_units": [e.value for e in ValidityUnit],
        "recurrence_rules": [e.value for e in RecurrenceKind],
        "roles": [e.value for e in Role],
    }
