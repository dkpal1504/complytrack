"""Reports R1-R12 (PRD Section 7.4) with Excel / CSV / PDF export."""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.rbac import Scope
from app.db.types import utcnow
from app.domain import status as status_rules
from app.domain.dates import format_ist, ist_day_start, ist_today, to_ist
from app.domain.enums import ComplianceBucket, ItemStatus
from app.models.audit import AuditLog
from app.models.compliance import ComplianceInstance, ComplianceItem, InstanceChecklist
from app.models.reminders import EscalationLog
from app.services import dashboards
from app.services.queries import lookup_maps

REPORT_CATALOGUE = [
    {"code": "R1", "name": "Compliance Status Report",
     "description": "Every item with status, owner, due/expiry date and days left.",
     "columns": ["Code", "Item", "Category", "Unit", "Department", "Owner", "Authority",
                 "Reference", "Expiry", "Renewal Due", "Status", "Bucket", "Days Left",
                 "Criticality"], "group": "Core"},
    {"code": "R2", "name": "Department-wise Status",
     "description": "Counts and percentage per status for each department.",
     "columns": ["Department", "Total", "Complied", "Under Process", "Pending",
                 "Overdue", "Expired", "Compliance %"], "group": "Core"},
    {"code": "R3", "name": "Unit / Location-wise Status",
     "description": "Same breakdown by unit or location.",
     "columns": ["Unit", "Total", "Complied", "Under Process", "Pending",
                 "Overdue", "Expired", "Compliance %"], "group": "Core"},
    {"code": "R4", "name": "Monthly Renewal Calendar",
     "description": "Month-by-month list of due and expiry dates, 12 months forward.",
     "columns": ["Month", "Item", "Unit", "Owner", "Expiry", "Due", "Criticality", "Status"],
     "group": "Core"},
    {"code": "R5", "name": "Pending Action Report",
     "description": "Open instances by owner with ageing, last reminder and escalation level.",
     "columns": ["Owner", "Item", "Unit", "Status", "Due", "Days Pending", "Ageing Bucket",
                 "Last Reminder", "Escalation"], "group": "Core"},
    {"code": "R6", "name": "Expired / Expiring Licences",
     "description": "Sorted by expiry with criticality and potential exposure.",
     "columns": ["Item", "Unit", "Owner", "Authority", "Reference", "Expiry", "Days Left",
                 "Criticality", "Exposure / day"], "group": "Core"},
    {"code": "R7", "name": "Renewals Completed",
     "description": "Renewals closed in the period with turnaround and on-time flag.",
     "columns": ["Item", "Unit", "Owner", "Cycle", "Due", "Closed", "Turnaround Days",
                 "On Time"], "group": "Core"},
    {"code": "R8", "name": "Escalation Report",
     "description": "Who was escalated to, when, and at what level.",
     "columns": ["Item", "Unit", "Level", "Reason", "Notified", "Triggered", "Acknowledged"],
     "group": "Governance"},
    {"code": "R9", "name": "Submission Monitoring",
     "description": "Required documents pending versus received, per cycle.",
     "columns": ["Item", "Unit", "Cycle", "Document", "Status", "Received On"],
     "group": "Governance"},
    {"code": "R10", "name": "Audit Trail Report",
     "description": "Filterable immutable audit trail export.",
     "columns": ["Timestamp (IST)", "User", "Entity", "Action", "Field", "Old", "New",
                 "Reason", "IP", "Hash"], "group": "Governance"},
    {"code": "R11", "name": "Compliance Certificate (HOD sign-off)",
     "description": "Per-department quarterly compliance statement for sign-off.",
     "columns": ["Department", "Unit", "Total", "Complied", "Pending", "Overdue", "Expired",
                 "Compliance %", "Statement"], "group": "Governance"},
    {"code": "R12", "name": "Management Summary",
     "description": "One-page KPI, top risks and trend summary.",
     "columns": ["Metric", "Value"], "group": "Management"},
]


def catalogue() -> list[dict]:
    return REPORT_CATALOGUE


def _columns(code: str) -> list[dict]:
    entry = next(r for r in REPORT_CATALOGUE if r["code"] == code)
    return [{"key": _slug(c), "label": c} for c in entry["columns"]]


def _slug(label: str) -> str:
    return label.lower().replace(" / ", "_").replace(" ", "_").replace("%", "pct").replace("-", "_")


def build_report(
    db: Session, code: str, scope: Scope, *, filters: dict | None = None,
    today: date | None = None,
) -> dict:
    today = today or ist_today()
    filters = filters or {}
    builder = {
        "R1": _r1, "R2": _r2, "R3": _r3, "R4": _r4, "R5": _r5, "R6": _r6,
        "R7": _r7, "R8": _r8, "R9": _r9, "R10": _r10, "R11": _r11, "R12": _r12,
    }.get(code.upper())
    if builder is None:
        raise ValueError(f"Unknown report code: {code}")

    rows, totals, summary = builder(db, scope, filters, today)
    entry = next(r for r in REPORT_CATALOGUE if r["code"] == code.upper())
    return {
        "code": entry["code"],
        "name": entry["name"],
        "generated_at": utcnow(),
        "columns": _columns(entry["code"]),
        "rows": rows,
        "totals": totals,
        "summary": summary,
    }


def _rows_with_context(db: Session, scope: Scope, filters: dict, today: date) -> list[dict]:
    return dashboards.build_rows(db, scope, filters=filters, today=today)


# --------------------------------------------------------------------------- #
# R1-R3
# --------------------------------------------------------------------------- #
def _r1(db, scope, filters, today):
    rows = _rows_with_context(db, scope, filters, today)
    out = [
        {
            "code": r["item_code"], "item": r["name"], "category": r["category"],
            "unit": r["unit"], "department": r["department"], "owner": r["owner"],
            "authority": r["authority"], "reference": r["reference_number"],
            "expiry": _d(r["expiry_date"]), "renewal_due": _d(r["renewal_due_date"]),
            "status": r["derived_status"], "bucket": r["bucket"] or "Not Applicable",
            "days_left": r["days_left"], "criticality": r["criticality"],
        }
        for r in sorted(rows, key=lambda r: (r["expiry_date"] or date.max))
    ]
    counts = status_rules.status_counts([r["bucket"] for r in rows])
    return out, {}, {"total": len(out), **counts}


def _status_breakdown(rows: list[dict], key: str) -> tuple[list[dict], dict]:
    out = []
    for name, group in dashboards._group(rows, key).items():
        counted = [r for r in group if r["bucket"] is not None]
        values = {b.value: 0 for b in ComplianceBucket}
        for row in counted:
            values[row["bucket"]] += 1
        total = len(counted)
        out.append({
            key: name, "total": total,
            "complied": values[ComplianceBucket.COMPLIED.value],
            "under_process": values[ComplianceBucket.UNDER_PROCESS.value],
            "pending": values[ComplianceBucket.PENDING.value],
            "overdue": values[ComplianceBucket.OVERDUE.value],
            "expired": values[ComplianceBucket.EXPIRED.value],
            "compliance_pct": round(values[ComplianceBucket.COMPLIED.value] / total * 100, 1)
            if total else 0.0,
        })
    out.sort(key=lambda r: r["compliance_pct"])
    return out, {"rows": len(out)}


def _r2(db, scope, filters, today):
    rows = _rows_with_context(db, scope, filters, today)
    out, summary = _status_breakdown(rows, "department")
    return out, {}, summary


def _r3(db, scope, filters, today):
    rows = _rows_with_context(db, scope, filters, today)
    out, summary = _status_breakdown(rows, "unit")
    return out, {}, summary


# --------------------------------------------------------------------------- #
# R4-R6
# --------------------------------------------------------------------------- #
def _r4(db, scope, filters, today):
    rows = _rows_with_context(db, scope, filters, today)
    horizon = today + timedelta(days=365)
    out = []
    for row in rows:
        when = row["expiry_date"] or row["due_date"]
        if not when or not (today <= when <= horizon):
            continue
        out.append({
            "month": when.strftime("%b %Y"), "item": row["name"], "unit": row["unit"],
            "owner": row["owner"], "expiry": _d(row["expiry_date"]),
            "due": _d(row["due_date"]), "criticality": row["criticality"],
            "status": row["derived_status"],
        })
    out.sort(key=lambda r: (r["month"], r["item"]))
    return out, {"items_in_12_months": len(out)}, {"horizon_start": _d(today),
                                                   "horizon_end": _d(horizon)}


def _r5(db, scope, filters, today):
    rows = [r for r in _rows_with_context(db, scope, filters, today)
            if r["bucket"] in (ComplianceBucket.PENDING, ComplianceBucket.OVERDUE)]
    out = []
    for row in rows:
        pending_days = (
            (today - row["expiry_date"]).days if row["expiry_date"] and today > row["expiry_date"]
            else (today - row["due_date"]).days if row["due_date"] else 0
        )
        out.append({
            "owner": row["owner"], "item": row["name"], "unit": row["unit"],
            "status": row["workflow_status"], "due": _d(row["due_date"] or row["expiry_date"]),
            "days_pending": max(pending_days, 0),
            "ageing_bucket": status_rules.ageing_bucket(max(pending_days, 0)),
            "last_reminder": "—", "escalation": f"L{row['escalation_level']}"
            if row["escalation_level"] else "—",
            "_instance_id": row["instance_id"],
        })
    _fill_last_reminder(db, out)
    out.sort(key=lambda r: -r["days_pending"])
    return out, {"open_instances": len(out)}, {}


def _fill_last_reminder(db: Session, rows: list[dict]) -> None:
    from app.models.reminders import ReminderLog

    ids = [r["_instance_id"] for r in rows if r.get("_instance_id")]
    if not ids:
        return
    latest: dict[str, object] = {}
    for log in db.execute(
        select(ReminderLog).where(ReminderLog.instance_id.in_(ids))
        .order_by(ReminderLog.sent_at.desc())
    ).scalars().all():
        latest.setdefault(log.instance_id, log)
    for row in rows:
        log = latest.get(row.get("_instance_id"))
        row["last_reminder"] = format_ist(log.sent_at) if log and log.sent_at else "—"
        row.pop("_instance_id", None)


def _r6(db, scope, filters, today):
    rows = _rows_with_context(db, scope, filters, today)
    horizon = today + timedelta(days=365)
    out = []
    for row in rows:
        if not row["expiry_date"]:
            continue
        if row["expiry_date"] > horizon:
            continue
        exposure = (row["penalty_per_day"] or 0) * max(row["days_overdue"] or 0, 0)
        out.append({
            "item": row["name"], "unit": row["unit"], "owner": row["owner"],
            "authority": row["authority"], "reference": row["reference_number"],
            "expiry": _d(row["expiry_date"]), "days_left": row["days_left"],
            "criticality": row["criticality"], "exposure_per_day": exposure or None,
        })
    out.sort(key=lambda r: r["days_left"] if r["days_left"] is not None else 0)
    expired = sum(1 for r in out if (r["days_left"] or 0) < 0)
    return out, {"expired": expired, "expiring_within_365": len(out) - expired}, {}


# --------------------------------------------------------------------------- #
# R7-R9
# --------------------------------------------------------------------------- #
def _r7(db, scope, filters, today):
    item_ids = {
        r["item_id"] for r in _rows_with_context(db, scope, filters, today)
    }
    if not item_ids:
        return [], {}, {}
    start = filters.get("period_from") or (today - timedelta(days=365))
    end = filters.get("period_to") or today

    maps = lookup_maps(db)
    rows = db.execute(
        select(ComplianceInstance, ComplianceItem)
        .join(ComplianceItem, ComplianceItem.id == ComplianceInstance.item_id)
        .where(
            ComplianceInstance.item_id.in_(tuple(item_ids)),
            ComplianceInstance.status == ItemStatus.CLOSED,
            ComplianceInstance.closed_at.isnot(None),
        )
    ).all()

    out = []
    for instance, item in rows:
        # The report's period is a run of IST days, so the day a cycle closed
        # on is an IST one too — otherwise a closure at 02:00 IST would be
        # counted on the previous day, or fall outside a one-day window.
        closed_on = to_ist(instance.closed_at).date()
        if not (start <= closed_on <= end):
            continue
        turnaround = (closed_on - instance.period_start).days if instance.period_start else None
        out.append({
            "item": item.name, "unit": maps["unit"].get(item.unit_id),
            "owner": maps["user"].get(item.owner_id), "cycle": instance.cycle_label,
            "due": _d(instance.due_date), "closed": _d(closed_on),
            "turnaround_days": turnaround,
            "on_time": "Yes" if (instance.due_date is None or closed_on <= instance.due_date) else "No",
        })
    out.sort(key=lambda r: r["closed"] or "", reverse=True)
    on_time = sum(1 for r in out if r["on_time"] == "Yes")
    return out, {"completed": len(out), "on_time": on_time,
                 "on_time_pct": round(on_time / len(out) * 100, 1) if out else 0.0}, {}


def _r8(db, scope, filters, today):
    item_ids = {r["item_id"] for r in _rows_with_context(db, scope, filters, today)}
    if not item_ids:
        return [], {}, {}
    instance_rows = db.execute(
        select(ComplianceInstance, ComplianceItem)
        .join(ComplianceItem, ComplianceItem.id == ComplianceInstance.item_id)
        .where(ComplianceInstance.item_id.in_(tuple(item_ids)))
    ).all()
    by_instance = {i.id: (i, it) for i, it in instance_rows}
    if not by_instance:
        return [], {}, {}

    maps = lookup_maps(db)
    logs = db.execute(
        select(EscalationLog).where(EscalationLog.instance_id.in_(tuple(by_instance.keys())))
        .order_by(EscalationLog.triggered_at.desc())
    ).scalars().all()

    out = []
    for log in logs:
        instance, item = by_instance[log.instance_id]
        out.append({
            "item": item.name, "unit": maps["unit"].get(item.unit_id), "level": log.level,
            "reason": log.outcome,
            "notified": ", ".join(
                maps["user"].get(uid, uid) for uid in (log.notified_to or [])
            ),
            "triggered": format_ist(log.triggered_at),
            "acknowledged": format_ist(log.acknowledged_at) if log.acknowledged_at else "—",
        })
    return out, {"escalations": len(out)}, {}


def _r9(db, scope, filters, today):
    item_ids = {r["item_id"] for r in _rows_with_context(db, scope, filters, today)}
    if not item_ids:
        return [], {}, {}
    maps = lookup_maps(db)
    rows = db.execute(
        select(InstanceChecklist, ComplianceInstance, ComplianceItem)
        .join(ComplianceInstance, ComplianceInstance.id == InstanceChecklist.instance_id)
        .join(ComplianceItem, ComplianceItem.id == ComplianceInstance.item_id)
        .where(ComplianceItem.id.in_(tuple(item_ids)), InstanceChecklist.is_deleted.is_(False))
    ).all()

    out = [
        {
            "item": item.name, "unit": maps["unit"].get(item.unit_id),
            "cycle": instance.cycle_label, "document": checklist.item_name,
            "status": checklist.status,
            "received_on": format_ist(checklist.received_at) if checklist.received_at else "—",
        }
        for checklist, instance, item in rows
    ]
    pending = sum(1 for r in out if r["status"] == "Pending")
    return out, {"documents": len(out), "pending": pending,
                 "received": len(out) - pending}, {}


# --------------------------------------------------------------------------- #
# R10-R12
# --------------------------------------------------------------------------- #
def _r10(db, scope, filters, today):
    stmt = select(AuditLog)
    if filters.get("user_id"):
        stmt = stmt.where(AuditLog.user_id == filters["user_id"])
    if filters.get("entity_type"):
        stmt = stmt.where(AuditLog.entity_type == filters["entity_type"])
    if filters.get("action"):
        stmt = stmt.where(AuditLog.action == filters["action"])
    if filters.get("entity_id"):
        stmt = stmt.where(AuditLog.entity_id == filters["entity_id"])
    if filters.get("period_from"):
        stmt = stmt.where(AuditLog.ts_utc >= ist_day_start(filters["period_from"]))
    if filters.get("period_to"):
        # The same IST day boundaries the audit screen uses — this extract
        # renders its own timestamps in IST, so it has to filter in IST too.
        stmt = stmt.where(
            AuditLog.ts_utc < ist_day_start(filters["period_to"] + timedelta(days=1))
        )

    rows = db.execute(stmt.order_by(AuditLog.ts_utc.desc()).limit(5000)).scalars().all()
    out = [
        {
            "timestamp_ist": r.ts_ist, "user": r.user_email, "entity": r.entity_type,
            "action": r.action, "field": r.field or "—",
            "old": _trim(r.old_value), "new": _trim(r.new_value),
            "reason": r.reason or "—", "ip": r.ip or "—", "hash": (r.hash or "")[:12],
        }
        for r in rows
    ]
    return out, {"entries": len(out)}, {}


def _r11(db, scope, filters, today):
    rows = _rows_with_context(db, scope, filters, today)
    breakdown, _ = _status_breakdown(rows, "department")
    quarter = f"Q{((today.month - 1) // 3) + 1} {today.year}"
    for row in breakdown:
        row["unit"] = rows[0]["unit"] if rows else "—"
        row["statement"] = (
            f"I certify that for {quarter}, all statutory obligations of the "
            f"{row['department']} department are compliant, except "
            f"{row['overdue'] + row['expired'] + row['pending']} item(s) reported above."
        )
    return breakdown, {}, {"quarter": quarter, "departments": len(breakdown)}


def _r12(db, scope, filters, today):
    payload = dashboards.management_dashboard(db, scope, filters=filters, today=today)
    out = [{"metric": k["label"], "value": f"{k['value']}{k.get('suffix', '')}"}
           for k in payload["kpis"]]
    out.append({"metric": "Fees due next quarter (INR)", "value": f"{payload['fees_next_quarter']:,.2f}"})
    for risk in payload["top_risks"][:10]:
        out.append({
            "metric": f"Risk: {risk['name'][:80]}",
            "value": f"{risk['status']} · {risk['criticality']} · "
                     f"{risk['days_overdue'] or risk['days_left']} days",
        })
    return out, {}, {"kpis": len(payload["kpis"]), "top_risks": len(payload["top_risks"])}


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #
def _d(value) -> str:
    return value.strftime("%d-%b-%Y") if value else "—"


def _trim(value, limit: int = 120) -> str:
    if value is None:
        return "—"
    text = str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def to_csv(report: dict) -> bytes:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([c["label"] for c in report["columns"]])
    for row in report["rows"]:
        writer.writerow([_cell(row.get(c["key"])) for c in report["columns"]])
    return buffer.getvalue().encode("utf-8-sig")


def _cell(value) -> str:
    return "" if value is None else str(value)


def to_excel(report: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = report["code"]

    header_fill = PatternFill("solid", fgColor="1E293B")
    header_font = Font(color="FFFFFF", bold=True, size=11)

    sheet.append([c["label"] for c in report["columns"]])
    for cell in sheet[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(vertical="center")
    sheet.freeze_panes = "A2"

    for row in report["rows"]:
        sheet.append([row.get(c["key"]) for c in report["columns"]])

    for index, column in enumerate(report["columns"], start=1):
        longest = max(
            [len(column["label"])] + [len(_cell(r.get(column["key"]))) for r in report["rows"][:200]]
        )
        sheet.column_dimensions[
            sheet.cell(row=1, column=index).column_letter
        ].width = min(max(longest + 3, 12), 55)

    meta = workbook.create_sheet("Metadata")
    meta.append(["Report", report["name"]])
    meta.append(["Code", report["code"]])
    meta.append(["Generated (UTC)", report["generated_at"].isoformat()])
    meta.append(["Rows", len(report["rows"])])
    for key, value in (report.get("summary") or {}).items():
        meta.append([key.replace("_", " ").title(), value])
    meta.column_dimensions["A"].width = 28

    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def to_pdf(report: dict) -> bytes:
    """Landscape A4 via ReportLab — no headless browser needed on-premise."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=landscape(A4),
        leftMargin=12 * mm, rightMargin=12 * mm, topMargin=12 * mm, bottomMargin=12 * mm,
        title=f"{report['code']} {report['name']}", author="ComplyTrack",
    )
    styles = getSampleStyleSheet()
    body = ParagraphStyle("cell", parent=styles["BodyText"], fontSize=7.2, leading=9)
    head = ParagraphStyle("head", parent=styles["BodyText"], fontSize=7.4, leading=9,
                          textColor=colors.white, fontName="Helvetica-Bold")

    story = [
        Paragraph(f"<b>{report['code']} — {report['name']}</b>", styles["Title"]),
        Paragraph(
            f"Generated {format_ist(report['generated_at'])} · {len(report['rows'])} row(s) · "
            f"ComplyTrack Statutory Compliance",
            styles["Normal"],
        ),
        Spacer(1, 6 * mm),
    ]

    columns = report["columns"][:14]
    data = [[Paragraph(c["label"], head) for c in columns]]
    for row in report["rows"][:600]:
        data.append([Paragraph(_escape(_cell(row.get(c["key"]))), body) for c in columns])

    table = Table(data, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CBD5E1")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F1F5F9")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    story.append(table)

    if len(report["rows"]) > 600:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph(
            f"Showing the first 600 of {len(report['rows'])} rows. "
            "Export to Excel or CSV for the full set.", body))

    doc.build(story)
    return buffer.getvalue()


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


# --------------------------------------------------------------------------- #
# R4 iCal feed
# --------------------------------------------------------------------------- #
def to_ical(rows: list[dict], *, calendar_name: str = "ComplyTrack Renewals") -> str:
    """iCal subscription feed for Outlook / Google Calendar (RP-04)."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ComplyTrack//Statutory Compliance//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{calendar_name}",
    ]
    stamp = utcnow().strftime("%Y%m%dT%H%M%SZ")
    for row in rows:
        when = row.get("expiry_date") or row.get("due_date")
        if not when:
            continue
        uid = f"{row.get('item_id') or row.get('item_code')}@complytrack"
        summary = f"{row.get('criticality', '')} · {row.get('name', '')}".strip(" ·")
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{stamp}",
            f"DTSTART;VALUE=DATE:{when.strftime('%Y%m%d')}",
            f"SUMMARY:{_ical_escape(summary)}",
            f"DESCRIPTION:{_ical_escape(_ical_description(row))}",
            "BEGIN:VALARM",
            "TRIGGER:-P30D",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{_ical_escape(summary)}",
            "END:VALARM",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


def _ical_description(row: dict) -> str:
    return (
        f"Unit: {row.get('unit') or '—'} | Owner: {row.get('owner') or '—'} | "
        f"Status: {row.get('derived_status') or row.get('bucket') or '—'} | "
        f"Reference: {row.get('reference_number') or '—'}"
    )


def _ical_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")
