"""Report engine R1-R12 with CSV, Excel, PDF and iCal output (DS/§7)."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select

from app.api.common import (
    CurrentScope, CurrentUser, DbSession, bad_request, not_found,
)
from app.core.deps import require, require_any
from app.core.rbac import Permission
from app.db.types import utcnow
from app.domain.dates import ist_today
from app.models.reminders import ScheduledReport
from app.scheduler import next_run_after
from app.schemas.reports import ScheduleReportRequest
from app.services import reports as report_service

router = APIRouter(prefix="/reports", tags=["Reports"])

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("", summary="Catalogue of the twelve standard reports")
def catalogue(
    user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED))
) -> list[dict]:
    return report_service.catalogue()


@router.get("/{code}", summary="Run a report and return its rows as JSON")
def run_report(
    code: str,
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED)),
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
    criticality: str | None = None,
    owner_id: str | None = None,
    type: str | None = None,
    period_from: date | None = None,
    period_to: date | None = None,
) -> dict:
    filters = {
        k: v for k, v in {
            "unit_id": unit_id, "department_id": department_id, "category_id": category_id,
            "criticality": criticality, "owner_id": owner_id, "type": type,
            "period_from": period_from, "period_to": period_to,
        }.items() if v is not None
    }
    try:
        return report_service.build_report(db, code, scope, filters=filters, today=ist_today())
    except ValueError as exc:
        raise not_found(f"Report {code}") from exc


@router.get("/{code}/export", summary="Download a report as CSV, Excel or PDF")
def export_report(
    code: str,
    db: DbSession,
    scope: CurrentScope,
    fmt: str = Query("xlsx", pattern="^(csv|xlsx|pdf)$"),
    user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED)),
    unit_id: str | None = None,
    department_id: str | None = None,
    category_id: str | None = None,
    criticality: str | None = None,
    owner_id: str | None = None,
    type: str | None = None,
    period_from: date | None = None,
    period_to: date | None = None,
) -> Response:
    filters = {
        k: v for k, v in {
            "unit_id": unit_id, "department_id": department_id, "category_id": category_id,
            "criticality": criticality, "owner_id": owner_id, "type": type,
            "period_from": period_from, "period_to": period_to,
        }.items() if v is not None
    }
    try:
        report = report_service.build_report(
            db, code, scope, filters=filters, today=ist_today()
        )
    except ValueError as exc:
        raise not_found(f"Report {code}") from exc

    stem = f"{report['code']}_{report['name'].replace(' ', '_')}"
    if fmt == "csv":
        return Response(
            content=report_service.to_csv(report), media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{stem}.csv"'},
        )
    if fmt == "pdf":
        return Response(
            content=report_service.to_pdf(report), media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{stem}.pdf"'},
        )
    return Response(
        content=report_service.to_excel(report), media_type=XLSX,
        headers={"Content-Disposition": f'attachment; filename="{stem}.xlsx"'},
    )


@router.get("/{code}/ical", summary="Renewal dates from this report as a calendar feed")
def report_ical(
    code: str,
    db: DbSession,
    scope: CurrentScope,
    user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED)),
) -> Response:
    try:
        report = report_service.build_report(db, code, scope, today=ist_today())
    except ValueError as exc:
        raise not_found(f"Report {code}") from exc
    return Response(
        content=report_service.to_ical(report["rows"], calendar_name=report["name"]),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{report["code"]}.ics"'},
    )


# --------------------------------------------------------------------------- #
# Scheduled report delivery
# --------------------------------------------------------------------------- #
@router.get("/schedules/list", summary="Configured scheduled reports")
def list_schedules(
    db: DbSession, user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED))
) -> list[dict]:
    rows = db.execute(
        select(ScheduledReport).where(ScheduledReport.is_deleted.is_(False))
        .order_by(ScheduledReport.created_at.desc())
    ).scalars().all()
    return [_serialise(s) for s in rows]


@router.post("/schedules", status_code=201, summary="Schedule a recurring report e-mail")
def create_schedule(
    payload: ScheduleReportRequest, db: DbSession,
    user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED)),
) -> dict:
    if payload.report_code.upper() not in {r["code"] for r in report_service.REPORT_CATALOGUE}:
        raise bad_request(f"'{payload.report_code}' is not a known report code.")
    if not payload.recipients:
        raise bad_request("Add at least one recipient.")

    schedule = ScheduledReport(
        report_code=payload.report_code.upper(),
        name=payload.name or payload.report_code.upper(),
        frequency=payload.frequency,
        recipients=payload.recipients,
        filters=payload.filters,
        format=payload.format,
        active=True,
        # Without this the delivery sweep never picks the row up: it selects on
        # `next_run_at <= now`, and a NULL there matches nothing.
        next_run_at=next_run_after(payload.frequency, utcnow()),
        created_by=user.id,
    )
    db.add(schedule)
    db.commit()
    db.refresh(schedule)
    return _serialise(schedule)


@router.delete("/schedules/{schedule_id}", summary="Delete a scheduled report")
def delete_schedule(
    schedule_id: str, db: DbSession,
    user: User = Depends(require_any(Permission.RUN_REPORTS_ALL, Permission.RUN_REPORTS_SCOPED)),
) -> dict:
    schedule = db.get(ScheduledReport, schedule_id)
    if schedule is None or schedule.is_deleted:
        raise not_found("Scheduled report")
    # Both flags: `active=False` stops the delivery sweep, and the soft-delete
    # flag is what the list filters on — setting only one leaves the row visible
    # after the user has been told it was removed.
    schedule.active = False
    schedule.is_deleted = True
    db.add(schedule)
    db.commit()
    return {"detail": "Scheduled report removed.", "ok": True}


def _serialise(s: ScheduledReport) -> dict:
    return {
        "id": s.id, "report_code": s.report_code, "name": s.name,
        "frequency": s.frequency, "recipients": s.recipients or [],
        "filters": s.filters or {}, "format": s.format, "active": s.active,
        "next_run_at": s.next_run_at, "last_run_at": s.last_run_at,
        "created_at": s.created_at,
    }
