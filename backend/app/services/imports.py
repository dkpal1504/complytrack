"""Excel/CSV import with dry-run validation (PRD Section 12) and export template."""

from __future__ import annotations

import io
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.rbac import Scope
from app.domain.dates import compute_dates, ist_today
from app.domain.enums import Applicability, Criticality, ItemType, RecurrenceKind, ValidityUnit
from app.models.auth import User
from app.models.compliance import ComplianceItem
from app.models.org import Category, Department, IssuingAuthority, OrganisationUnit
from app.schemas.compliance import ItemCreate
from app.services import items as items_service

IMPORT_COLUMNS = [
    "Unit", "Department", "Category", "Item Name", "Type", "Authority", "Reference No.",
    "Issue Date", "Validity (value)", "Validity (unit)", "Expiry Date", "Owner Email",
    "Delegate Email", "Criticality", "Lead Time Days", "Authority Processing Days",
    "Recurrence", "Reminder Profile", "File Name",
]

REQUIRED_COLUMNS = {"Unit", "Item Name", "Owner Email", "Type"}

_DATE_FORMATS = ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%m/%d/%Y")

VALID_TYPES = {t.value for t in ItemType}
VALID_CRITICALITY = {c.value for c in Criticality}
VALID_VALIDITY = {v.value for v in ValidityUnit}
VALID_RECURRENCE = {r.value for r in RecurrenceKind}


class ImportError_(ValueError):
    pass


def template_workbook() -> bytes:
    """The downloadable Excel import template, pre-filled with one example row."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Compliance Import"

    fill = PatternFill("solid", fgColor="1E293B")
    sheet.append(IMPORT_COLUMNS)
    for cell in sheet[1]:
        cell.fill = fill
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    sheet.freeze_panes = "A2"

    sheet.append([
        "Yard", "Safety", "Factory, Safety & Occupational Health",
        "Factory Licence FY2026-27", "Licence",
        "Directorate of Industrial Safety & Health (DISH)", "DISH/2026/1234",
        "01-04-2026", 12, "months", "", "safety.owner@example.com", "",
        "Critical", 90, 30, "annual", "Default", "",
    ])
    for index, column in enumerate(IMPORT_COLUMNS, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = max(len(column) + 4, 16)

    guide = workbook.create_sheet("How to use")
    for line in [
        ["ComplyTrack — Compliance Register Import"],
        [""],
        ["1. Do not rename or reorder the columns on the 'Compliance Import' sheet."],
        ["2. Dates accept DD-MM-YYYY, YYYY-MM-DD or DD-MMM-YYYY."],
        ["3. Unit / Department / Category / Authority are matched by name or code."],
        ["   Unknown names are reported as warnings and created as new master data is NOT automatic."],
        ["4. Owner Email must match an existing active user, otherwise the row is an error."],
        ["5. Validity (unit) accepts: " + ", ".join(sorted(VALID_VALIDITY))],
        ["6. Recurrence accepts: " + ", ".join(sorted(VALID_RECURRENCE))],
        ["7. Leave Expiry Date blank to let the system compute it from issue date + validity."],
        ["8. Re-importing a file updates existing rows matched on Unit + Authority + Reference No."],
        ["9. Attachments are uploaded separately as a ZIP whose file names match column 'File Name'."],
        [""],
        ["Always run the dry-run preview before committing an import."],
    ]:
        guide.append(line)
    guide.column_dimensions["A"].width = 100

    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()


def parse_workbook(data: bytes) -> list[dict]:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(data), data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        raise ImportError_("The file is empty.")

    header = [str(c).strip() if c is not None else "" for c in rows[0]]
    missing = REQUIRED_COLUMNS - set(header)
    if missing:
        raise ImportError_(
            "Missing required column(s): " + ", ".join(sorted(missing))
            + ". Download the template from this page and use it unchanged."
        )

    out = []
    for index, raw in enumerate(rows[1:], start=2):
        if raw is None or all(c is None or str(c).strip() == "" for c in raw):
            continue
        record = {header[i]: raw[i] for i in range(min(len(header), len(raw)))}
        record["__row__"] = index
        out.append(record)
    return out


def parse_csv(data: bytes) -> list[dict]:
    import csv

    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ImportError_("The file is empty.")
    missing = REQUIRED_COLUMNS - set(reader.fieldnames)
    if missing:
        raise ImportError_(
            "Missing required column(s): " + ", ".join(sorted(missing))
        )
    out = []
    for index, record in enumerate(reader, start=2):
        record["__row__"] = index
        out.append(record)
    return out


def _parse_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _clean(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def preview_import(db: Session, records: list[dict], scope: Scope) -> dict:
    """Dry-run: row-level validation report with errors and warnings (Section 12)."""
    units = {u.name.lower(): u for u in db.execute(select(OrganisationUnit)).scalars()}
    units.update({u.code.lower(): u for u in list(units.values())})
    departments = {d.name.lower(): d for d in db.execute(select(Department)).scalars()}
    departments.update({d.code.lower(): d for d in list(departments.values())})
    categories = {c.name.lower(): c for c in db.execute(select(Category)).scalars()}
    authorities = {a.name.lower(): a for a in db.execute(select(IssuingAuthority)).scalars()}
    users = {u.email.lower(): u for u in db.execute(select(User)).scalars() if not u.is_deleted}
    seen_refs: set[tuple] = set()

    errors: list[dict] = []
    warnings: list[dict] = []
    preview: list[dict] = []

    for record in records:
        row = record["__row__"]
        row_errors: list[str] = []

        unit = units.get((_clean(record.get("Unit")) or "").lower())
        if unit is None:
            row_errors.append(f"Unknown unit '{_clean(record.get('Unit'))}'.")
        elif not scope.all_units and unit.id not in scope.unit_ids:
            row_errors.append("Unit is outside your data scope.")

        name = _clean(record.get("Item Name"))
        if not name:
            row_errors.append("Item Name is required.")

        owner_email = (_clean(record.get("Owner Email")) or "").lower()
        owner = users.get(owner_email)
        if not owner:
            row_errors.append(f"No active user found for owner '{owner_email}'.")
        elif owner.status != "Active":
            row_errors.append(f"Owner '{owner_email}' is not an active user.")

        item_type = _clean(record.get("Type")) or ItemType.LICENCE.value
        if item_type not in VALID_TYPES:
            row_errors.append(
                f"Invalid Type '{item_type}'. Expected one of: {', '.join(sorted(VALID_TYPES))}."
            )

        criticality = _clean(record.get("Criticality")) or Criticality.MEDIUM.value
        if criticality not in VALID_CRITICALITY:
            row_errors.append(f"Invalid Criticality '{criticality}'.")

        validity_unit = _clean(record.get("Validity (unit)")) or ValidityUnit.MONTHS.value
        if validity_unit not in VALID_VALIDITY:
            row_errors.append(
                f"Invalid Validity (unit) '{validity_unit}'. Expected one of: "
                f"{', '.join(sorted(VALID_VALIDITY))}."
            )

        recurrence = _clean(record.get("Recurrence")) or RecurrenceKind.ANNUAL.value
        if recurrence not in VALID_RECURRENCE:
            row_errors.append(f"Invalid Recurrence '{recurrence}'.")

        issue_date = _parse_date(record.get("Issue Date"))
        if _clean(record.get("Issue Date")) and issue_date is None:
            row_errors.append(f"Could not read Issue Date '{record.get('Issue Date')}'.")
        expiry_date = _parse_date(record.get("Expiry Date"))
        if _clean(record.get("Expiry Date")) and expiry_date is None:
            row_errors.append(f"Could not read Expiry Date '{record.get('Expiry Date')}'.")

        validity_value = record.get("Validity (value)")
        try:
            validity_value = int(validity_value) if validity_value not in (None, "") else None
        except (TypeError, ValueError):
            row_errors.append(f"Validity (value) '{validity_value}' is not a whole number.")
            validity_value = None

        if item_type in (ItemType.LICENCE.value, ItemType.CERTIFICATE.value) \
                and not issue_date and not expiry_date:
            row_errors.append("Provide an Issue Date or an Expiry Date.")
        if item_type in (ItemType.LICENCE.value, ItemType.CERTIFICATE.value) \
                and not validity_value and not expiry_date:
            row_errors.append("Provide a Validity (value) or an Expiry Date.")

        department = departments.get((_clean(record.get("Department")) or "").lower())
        if _clean(record.get("Department")) and department is None:
            warnings.append({
                "row": row, "column": "Department", "severity": "warning",
                "message": f"Department '{record.get('Department')}' not found — will be left blank.",
            })
        category = categories.get((_clean(record.get("Category")) or "").lower())
        if _clean(record.get("Category")) and category is None:
            warnings.append({
                "row": row, "column": "Category", "severity": "warning",
                "message": f"Category '{record.get('Category')}' not found — will be left blank.",
            })
        authority = authorities.get((_clean(record.get("Authority")) or "").lower())
        if _clean(record.get("Authority")) and authority is None:
            warnings.append({
                "row": row, "column": "Authority", "severity": "warning",
                "message": f"Authority '{record.get('Authority')}' not found — will be left blank.",
            })

        reference = _clean(record.get("Reference No."))
        if unit and reference:
            key = (unit.id, reference)
            if key in seen_refs:
                warnings.append({
                    "row": row, "column": "Reference No.", "severity": "warning",
                    "message": f"Duplicate reference '{reference}' also appears earlier in this file.",
                })
            seen_refs.add(key)
            existing = items_service.find_duplicate(
                db, unit_id=unit.id, authority_id=authority.id if authority else None,
                reference_number=reference,
            )
            if existing:
                warnings.append({
                    "row": row, "column": "Reference No.", "severity": "warning",
                    "message": f"Matches existing item {existing.item_code} — this row will update it.",
                })

        if _clean(record.get("Reminder Profile")):
            warnings.append({
                "row": row, "column": "Reminder Profile", "severity": "warning",
                "message": "Named reminder profiles are matched at commit; unknown names fall back "
                           "to the default profile.",
            })

        for message in row_errors:
            errors.append({"row": row, "column": None, "severity": "error", "message": message})

        if not row_errors:
            preview.append({
                "row": row,
                "unit": unit.name if unit else None,
                "department": department.name if department else None,
                "category": category.name if category else None,
                "name": name,
                "type": item_type,
                "authority": authority.name if authority else None,
                "reference_number": reference,
                "issue_date": issue_date,
                "expiry_date": expiry_date,
                "owner": owner.email if owner else None,
                "criticality": criticality,
                "recurrence": recurrence,
            })

    return {
        "total_rows": len(records),
        "valid_rows": len(preview),
        "errors": errors,
        "warnings": warnings,
        "preview": preview[:200],
        "columns_detected": list(records[0].keys()) if records else [],
    }


def commit_import(
    db: Session, records: list[dict], *, actor: User, ctx: dict, scope: Scope,
    fy_start_month: int = 4,
) -> dict:
    """Apply the import. Re-imports update by unit + authority + reference number."""
    result = preview_import(db, records, scope)
    if result["errors"]:
        return {
            "created": 0, "updated": 0, "skipped": len(records),
            "errors": result["errors"], "item_ids": [],
        }

    units = {u.name.lower(): u for u in db.execute(select(OrganisationUnit)).scalars()}
    departments = {d.name.lower(): d for d in db.execute(select(Department)).scalars()}
    categories = {c.name.lower(): c for c in db.execute(select(Category)).scalars()}
    authorities = {a.name.lower(): a for a in db.execute(select(IssuingAuthority)).scalars()}
    users = {u.email.lower(): u for u in db.execute(select(User)).scalars() if not u.is_deleted}

    created = updated = skipped = 0
    item_ids: list[str] = []

    for record in records:
        row_errors = [e for e in result["errors"] if e["row"] == record["__row__"]]
        if row_errors:
            skipped += 1
            continue

        unit = units.get((_clean(record.get("Unit")) or "").lower())
        department = departments.get((_clean(record.get("Department")) or "").lower())
        category = categories.get((_clean(record.get("Category")) or "").lower())
        authority = authorities.get((_clean(record.get("Authority")) or "").lower())
        owner = users.get((_clean(record.get("Owner Email")) or "").lower())
        delegate = users.get((_clean(record.get("Delegate Email")) or "").lower())

        issue_date = _parse_date(record.get("Issue Date"))
        expiry_date = _parse_date(record.get("Expiry Date"))
        validity_raw = record.get("Validity (value)")
        validity_value = int(validity_raw) if validity_raw not in (None, "") else None

        try:
            lead = int(record.get("Lead Time Days") or 90)
        except (TypeError, ValueError):
            lead = 90
        try:
            processing = int(record.get("Authority Processing Days") or 15)
        except (TypeError, ValueError):
            processing = 15

        reference = _clean(record.get("Reference No."))
        existing = items_service.find_duplicate(
            db, unit_id=unit.id if unit else None,
            authority_id=authority.id if authority else None,
            reference_number=reference,
        )

        payload = ItemCreate(
            name=_clean(record.get("Item Name")) or "Untitled obligation",
            type=_clean(record.get("Type")) or ItemType.LICENCE.value,
            unit_id=unit.id if unit else None,
            department_id=department.id if department else None,
            category_id=category.id if category else None,
            authority_id=authority.id if authority else None,
            owner_id=owner.id if owner else None,
            delegate_id=delegate.id if delegate else None,
            reference_number=reference,
            issue_date=issue_date,
            validity_value=validity_value,
            validity_unit=_clean(record.get("Validity (unit)")) or ValidityUnit.MONTHS.value,
            expiry_date=expiry_date,
            criticality=_clean(record.get("Criticality")) or Criticality.MEDIUM.value,
            lead_time_days=lead,
            authority_processing_days=processing,
            recurrence_rule=_clean(record.get("Recurrence")) or RecurrenceKind.ANNUAL.value,
            applicability=Applicability.APPLICABLE.value,
            create_first_instance=True,
            ignore_duplicate_check=True,
        )

        if existing is not None:
            update_fields = payload.model_dump(
                exclude={"create_first_instance", "ignore_duplicate_check", "item_code",
                         "template_id"}
            )
            for key, value in update_fields.items():
                if value is not None:
                    setattr(existing, key, value)
            items_service.recalculate_dates(existing, fy_start_month=fy_start_month)
            db.add(existing)
            updated += 1
            item_ids.append(existing.id)
        else:
            item = items_service.create_item(
                db, payload, actor=actor, ctx=ctx, scope=scope, fy_start_month=fy_start_month
            )
            created += 1
            item_ids.append(item.id)

    db.commit()
    return {"created": created, "updated": updated, "skipped": skipped,
            "errors": [], "item_ids": item_ids}


def export_items_xlsx(rows: list[dict]) -> bytes:
    """Export the current register grid to Excel."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    columns = [
        ("Code", "item_code"), ("Item", "name"), ("Category", "category"),
        ("Unit", "unit"), ("Department", "department"), ("Owner", "owner"),
        ("Authority", "authority"), ("Reference", "reference_number"),
        ("Issue Date", "issue_date"), ("Expiry Date", "expiry_date"),
        ("Renewal Due", "renewal_due_date"), ("Internal Target", "internal_target_date"),
        ("Derived Status", "derived_status"), ("Workflow Status", "workflow_status"),
        ("Bucket", "bucket"), ("Days Left", "days_left"), ("Criticality", "criticality"),
        ("Cycle", "cycle"), ("Fee", "fee_amount"), ("Escalated", "escalation_level"),
    ]

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Compliance Register"
    sheet.append([label for label, _ in columns])
    for cell in sheet[1]:
        cell.fill = PatternFill("solid", fgColor="1E293B")
        cell.font = Font(color="FFFFFF", bold=True)
        cell.alignment = Alignment(vertical="center")
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:{sheet.cell(row=1, column=len(columns)).column_letter}1"

    for row in rows:
        sheet.append([
            row.get(key).strftime("%d-%b-%Y") if isinstance(row.get(key), date) else row.get(key)
            for _, key in columns
        ])
    for index, (label, _) in enumerate(columns, start=1):
        from openpyxl.utils import get_column_letter

        sheet.column_dimensions[get_column_letter(index)].width = max(len(label) + 4, 14)

    out = io.BytesIO()
    workbook.save(out)
    return out.getvalue()
