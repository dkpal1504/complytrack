"""Dashboards (Section 7): Management, Compliance Officer and My Work."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, Response

from app.api.common import CurrentScope, CurrentUser, DbSession
from app.core.deps import require, require_any
from app.core.rbac import Permission
from app.domain.dates import ist_today
from app.domain.enums import ComplianceBucket, Criticality, ItemType
from app.services import dashboards as dash_service
from app.services import reports as report_service

router = APIRouter(prefix="/dashboards", tags=["Dashboards"])


def _filters(**kw) -> dict:
    return {k: v for k, v in kw.items() if v is not None}


@router.get("/management", summary="Management cockpit: KPIs, trends and top risks")
def management(
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require(Permission.VIEW_DASHBOARD_ALL)),
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
    criticality: str | None = None,
    type: str | None = None,
) -> dict:
    today = ist_today()
    return dash_service.management_dashboard(
        db, scope,
        filters=_filters(unit_id=unit_id, department_id=department_id,
                         category_id=category_id, criticality=criticality, type=type),
        today=today,
    )


@router.get("/officer", summary="Compliance Officer workbench: seven action tabs")
def officer(
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require(Permission.VIEW_DASHBOARD_ALL)),
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
    criticality: str | None = None,
    type: str | None = None,
) -> dict:
    return dash_service.officer_dashboard(
        db, scope,
        filters=_filters(unit_id=unit_id, department_id=department_id,
                         category_id=category_id, criticality=criticality, type=type),
        today=ist_today(),
    )


@router.get("/my-work", summary="My Work: everything I own or am covering")
def my_work(
    db: DbSession,
    user: User = Depends(require_any(Permission.VIEW_ALL_ITEMS, Permission.VIEW_SCOPED_ITEMS)),
) -> dict:
    return dash_service.my_work(db, user, today=ist_today())


@router.get("/filters", summary="Filter options for the dashboard bars")
def filter_options(db: DbSession, user: CurrentUser) -> dict:
    from sqlalchemy import select

    from app.models.org import Category, Department, OrganisationUnit

    units = db.execute(select(OrganisationUnit)).scalars().all()
    departments = db.execute(select(Department)).scalars().all()
    categories = db.execute(
        select(Category).where(Category.is_deleted.is_(False))
    ).scalars().all()
    return {
        "units": [{"value": u.id, "label": u.name, "code": u.code} for u in units],
        "departments": [
            {"value": d.id, "label": d.name, "code": d.code} for d in departments
        ],
        "categories": [
            {"value": c.id, "label": c.name, "colour": c.colour,
             "parent_id": c.parent_id}
            for c in categories
        ],
        "criticalities": [c.value for c in Criticality],
        "types": [t.value for t in ItemType],
        "buckets": [b.value for b in ComplianceBucket],
        "reports": report_service.catalogue(),
    }


@router.get("/calendar", summary="Renewal calendar, twelve months of due and expiry dates")
def calendar(
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require_any(Permission.VIEW_ALL_ITEMS, Permission.VIEW_SCOPED_ITEMS)),
    months: int = Query(12, ge=1, le=24),
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
) -> dict:
    """Flat day list plus a month roll-up, ready for a calendar or agenda view."""
    today = ist_today()
    rows = dash_service.build_rows(
        db, scope,
        filters=_filters(unit_id=unit_id, department_id=department_id, category_id=category_id),
        today=today,
    )
    days = dash_service._calendar_payload(rows, today, months=months)

    by_day: dict[str, list[dict]] = {}
    for row in rows:
        for key in ("expiry_date", "renewal_due_date", "internal_target_date"):
            value = row.get(key)
            if value is None:
                continue
            iso = value.isoformat() if hasattr(value, "isoformat") else str(value)
            by_day.setdefault(iso, []).append({
                "item_id": row["item_id"], "item_code": row["item_code"],
                "name": row["name"], "unit": row["unit"], "owner": row["owner"],
                "criticality": row["criticality"], "rag": row["rag"],
                "bucket": row["bucket"], "event": key,
            })
    return {"months": days, "events": by_day, "generated_for": today}


@router.get("/export/ical", summary="Subscribe to renewals from Outlook or Google Calendar")
def ical(
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require_any(Permission.VIEW_ALL_ITEMS, Permission.VIEW_SCOPED_ITEMS)),
) -> Response:
    rows = dash_service.build_rows(db, scope, filters={}, today=ist_today())
    feed = report_service.to_ical(rows, calendar_name="ComplyTrack Renewals")
    return Response(
        content=feed,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="complytrack-renewals.ics"'},
    )


@router.get("/criticality-weights", summary="Criticality weights used by the Compliance Index")
def criticality_weights(user: CurrentUser) -> dict:
    from app.domain.enums import CRITICALITY_WEIGHT

    return {
        "weights": {k.value: v for k, v in CRITICALITY_WEIGHT.items()},
        "formula": "sum(weight x satisfied) / sum(weight x applicable) x 100",
    }


__all__ = ["router"]
