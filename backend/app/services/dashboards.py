"""Dashboard aggregation (PRD Section 7).

Rows are assembled once into a common shape, then every KPI, chart and report
is a grouping over that same list — which is what makes AC-5 true by
construction: the dashboard counts and the register list can never disagree,
because they are the same computation.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import String, select
from sqlalchemy.orm import Session

from app.core.rbac import Scope
from app.db.types import utcnow
from app.domain import status as status_rules
from app.domain.dates import ist_today
from app.domain.enums import CRITICALITY_WEIGHT, BucketDrill, ComplianceBucket, ItemStatus
from app.domain.escalation import level_label
from app.models.compliance import ComplianceInstance, ComplianceItem
from app.models.reminders import EscalationLog
from app.services import items as items_service
from app.services.queries import apply_item_scope, lookup_maps

OPEN_STATUSES = (
    ItemStatus.PENDING, ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED,
    ItemStatus.RENEWED, ItemStatus.QUERY_RAISED,
)


def build_rows(
    db: Session, scope: Scope, *, filters: dict | None = None, today: date | None = None,
    include_archived: bool = False,
) -> list[dict]:
    """One row per compliance item, with its open cycle and derived status."""
    today = today or ist_today()
    filters = filters or {}

    stmt = select(ComplianceItem)
    if not include_archived:
        stmt = stmt.where(ComplianceItem.is_deleted.is_(False))
    stmt = apply_item_scope(stmt, scope)

    if filters.get("unit_id"):
        stmt = stmt.where(ComplianceItem.unit_id == filters["unit_id"])
    if filters.get("department_id"):
        stmt = stmt.where(ComplianceItem.department_id == filters["department_id"])
    if filters.get("category_id"):
        stmt = stmt.where(ComplianceItem.category_id == filters["category_id"])
    if filters.get("criticality"):
        stmt = stmt.where(ComplianceItem.criticality == filters["criticality"])
    if filters.get("owner_id"):
        stmt = stmt.where(ComplianceItem.owner_id == filters["owner_id"])
    if filters.get("type"):
        stmt = stmt.where(ComplianceItem.type == filters["type"])
    if filters.get("tag"):
        # Same portable JSON-containment trick the register grid uses: a LIKE on
        # the serialised list beats a dialect-specific operator here.
        stmt = stmt.where(
            ComplianceItem.tags.cast(String).like(f'%"{filters["tag"]}"%')
        )

    all_items = list(db.execute(stmt).scalars().all())
    if not all_items:
        return []

    maps = lookup_maps(db)

    item_ids = [i.id for i in all_items]
    instances = db.execute(
        select(ComplianceInstance).where(
            ComplianceInstance.item_id.in_(item_ids),
            ComplianceInstance.is_deleted.is_(False),
        ).order_by(ComplianceInstance.due_date.asc().nulls_last())
    ).scalars().all()

    current: dict[str, ComplianceInstance] = {}
    open_counts: dict[str, int] = defaultdict(int)
    for instance in instances:
        if instance.status in OPEN_STATUSES:
            open_counts[instance.item_id] += 1
            current.setdefault(instance.item_id, instance)
    for instance in instances:
        current.setdefault(instance.item_id, instance)

    rows: list[dict] = []
    for item in all_items:
        instance = current.get(item.id)
        state = items_service.item_status_input(item, instance)
        derived = status_rules.derive_status(state, today)
        bucket = status_rules.compliance_bucket(state, today)
        rag = status_rules.rag_colour(state, today)
        days_left = status_rules.countdown(item.expiry_date, today)

        rows.append({
            "item_id": item.id,
            "item_code": item.item_code,
            "name": item.name,
            "type": item.type,
            "unit_id": item.unit_id,
            "unit": maps["unit"].get(item.unit_id),
            "department_id": item.department_id,
            "department": maps["department"].get(item.department_id),
            "category_id": item.category_id,
            "category": maps["category"].get(item.category_id),
            "owner_id": item.owner_id,
            "owner": maps["user"].get(item.owner_id),
            "authority_id": item.authority_id,
            "authority": maps["authority"].get(item.authority_id),
            "reference_number": item.reference_number,
            "criticality": item.criticality,
            "applicability": item.applicability,
            "expiry_date": item.expiry_date,
            "renewal_due_date": item.renewal_due_date,
            "internal_target_date": item.internal_target_date,
            "issue_date": item.issue_date,
            "fee_amount": float(item.fee_amount) if item.fee_amount is not None else None,
            "penalty_per_day": float(item.penalty_per_day) if item.penalty_per_day is not None else None,
            "instance_id": instance.id if instance else None,
            "cycle": instance.cycle_label if instance else None,
            "workflow_status": instance.status if instance else ItemStatus.PENDING,
            "verification_status": instance.verification_status if instance else None,
            "escalation_level": instance.escalation_level if instance else 0,
            "renewal_in_process": bool(instance.renewal_in_process) if instance else False,
            "due_date": instance.due_date if instance else None,
            "open_instances": open_counts.get(item.id, 0),
            "derived_status": derived.value,
            "bucket": bucket.value if bucket else None,
            "rag": rag.value,
            "days_left": days_left,
            "days_overdue": (
                max(-days_left, 0) if days_left is not None and days_left < 0 else 0
            ),
            "weight": CRITICALITY_WEIGHT.get(item.criticality, 1),
        })

    if filters.get("status"):
        rows = [r for r in rows if r["derived_status"] == filters["status"]]
    if filters.get("rag"):
        rows = [r for r in rows if r["rag"] == filters["rag"]]
    if filters.get("cycle_status"):
        rows = [r for r in rows if r["workflow_status"] == filters["cycle_status"]]
    if filters.get("bucket"):
        rows = [r for r in rows if r["bucket"] == filters["bucket"]]
    if filters.get("search"):
        term = filters["search"].lower()
        rows = [
            r for r in rows
            if term in (r["name"] or "").lower()
            or term in (r["item_code"] or "").lower()
            or term in (r["reference_number"] or "").lower()
        ]
    if filters.get("period_from"):
        rows = [r for r in rows if r["expiry_date"] and r["expiry_date"] >= filters["period_from"]]
    if filters.get("period_to"):
        rows = [r for r in rows if r["expiry_date"] and r["expiry_date"] <= filters["period_to"]]

    return rows


# --------------------------------------------------------------------------- #
# 7.1 Management summary
# --------------------------------------------------------------------------- #
def management_dashboard(
    db: Session, scope: Scope, *, filters: dict | None = None, today: date | None = None
) -> dict:
    today = today or ist_today()
    rows = build_rows(db, scope, filters=filters, today=today)

    counted = [(r["bucket"], r["criticality"]) for r in rows]
    index = status_rules.compliance_index(counted)
    counts = status_rules.status_counts([r["bucket"] for r in rows])
    counted_rows = [r for r in rows if r["bucket"] is not None]

    def bucket_count(name: str) -> int:
        return sum(1 for r in counted_rows if r["bucket"] == name)

    # Counted with the same rule the register filters on when a card is clicked,
    # so a KPI value and its drill-through total cannot drift apart (AC-5).
    def drill_count(drill: BucketDrill) -> int:
        return sum(
            1
            for r in rows
            if status_rules.matches_drill(
                ComplianceBucket(r["bucket"]) if r["bucket"] else None,
                r["expiry_date"],
                today,
                drill,
            )
        )

    due_90 = sum(
        1 for r in counted_rows
        if r["days_left"] is not None and 0 <= r["days_left"] <= 90
    )

    kpis = [
        {"key": "total", "label": "Total active obligations", "value": drill_count(BucketDrill.ALL),
         "severity": "neutral", "drill": BucketDrill.ALL},
        {"key": "complied", "label": "Complied",
         "value": drill_count(BucketDrill.COMPLIED),
         "suffix": f"{_pct(bucket_count(ComplianceBucket.COMPLIED), len(counted_rows))}",
         "severity": "good", "drill": BucketDrill.COMPLIED},
        {"key": "pending", "label": "Pending (not started)",
         "value": drill_count(BucketDrill.PENDING), "severity": "neutral",
         "drill": BucketDrill.PENDING},
        {"key": "under_process", "label": "Under Process / Submitted",
         "value": drill_count(BucketDrill.UNDER_PROCESS), "severity": "warn",
         "drill": BucketDrill.UNDER_PROCESS},
        {"key": "due_30", "label": "Due in next 30 days",
         "value": drill_count(BucketDrill.DUE_30),
         "severity": "warn", "drill": BucketDrill.DUE_30},
        {"key": "overdue", "label": "Overdue",
         "value": drill_count(BucketDrill.OVERDUE), "severity": "danger",
         "drill": BucketDrill.OVERDUE},
        {"key": "expired", "label": "Expired licences / certificates",
         "value": drill_count(BucketDrill.EXPIRED), "severity": "danger",
         "drill": BucketDrill.EXPIRED},
        {"key": "index", "label": "Compliance Index (criticality-weighted)",
         "value": index["index"], "suffix": "%",
         "severity": "good" if index["index"] >= 90 else "warn" if index["index"] >= 70 else "danger",
         "drill": BucketDrill.ALL},
    ]

    status_split = [
        {"label": bucket, "key": bucket, "value": counts.get(bucket, 0)}
        for bucket in ComplianceBucket
    ]

    department_status = _stacked(rows, "department")
    unit_status = _stacked(rows, "unit")

    category_status = []
    for category, group in _group(rows, "category").items():
        counted_group = [r for r in group if r["bucket"] is not None]
        if not counted_group:
            continue
        category_status.append({
            "label": category,
            "key": category,
            "value": round(
                sum(1 for r in counted_group if r["bucket"] == ComplianceBucket.COMPLIED)
                / len(counted_group) * 100, 1
            ),
        })
    category_status.sort(key=lambda c: c["value"])

    renewal_timeline = _renewal_timeline(rows, today)
    index_trend = _index_trend(db, scope, today)

    top_risks = _top_risks(counted_rows)
    escalations = _active_escalations(db, scope, rows)
    owner_backlog = _owner_backlog(counted_rows)

    quarter_end = today + timedelta(days=90)
    fees = sum(
        r["fee_amount"] or 0
        for r in counted_rows
        if r["expiry_date"] and today <= r["expiry_date"] <= quarter_end
    )

    return {
        "generated_at": utcnow(),
        "filters": {k: v for k, v in (filters or {}).items() if v},
        "kpis": kpis,
        "status_split": status_split,
        "department_status": department_status,
        "unit_status": unit_status,
        "category_status": category_status,
        "renewal_timeline": renewal_timeline,
        "index_trend": index_trend,
        "top_risks": top_risks,
        "escalations": escalations,
        "owner_backlog": owner_backlog,
        "fees_next_quarter": round(fees, 2),
    }


def _pct(numerator: int, denominator: int) -> str:
    if not denominator:
        return "—"
    return f"{numerator / denominator * 100:.0f}%"


def _group(rows: list[dict], key: str) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        grouped[row.get(key) or "Unassigned"].append(row)
    return dict(sorted(grouped.items(), key=lambda kv: (-len(kv[1]), kv[0])))


def _stacked(rows: list[dict], key: str) -> list[dict]:
    out = []
    for name, group in _group(rows, key).items():
        counted = [r for r in group if r["bucket"] is not None]
        values = {b.value: 0 for b in ComplianceBucket}
        for row in counted:
            values[row["bucket"]] += 1
        out.append({"category": name, "values": values, "total": len(counted)})
    return out


def _renewal_timeline(rows: list[dict], today: date, months: int = 12) -> list[dict]:
    timeline = []
    cursor = date(today.year, today.month, 1)
    for _ in range(months):
        month_end = (cursor + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        label = cursor.strftime("%b %Y")
        values = {b.value: 0 for b in ComplianceBucket}
        for row in rows:
            expiry = row["expiry_date"]
            if expiry and cursor <= expiry <= month_end:
                values[row["bucket"] or "Expired"] += 1
        timeline.append({
            "category": label,
            "values": values,
            "total": sum(values.values()),
        })
        cursor = (month_end + timedelta(days=1))
    return timeline


def _index_trend(db: Session, scope: Scope, today: date, months: int = 12) -> list[dict]:
    """Reconstruct the Compliance Index for each of the last 12 months."""
    rows = build_rows(db, scope, filters={}, today=today)
    trend = []
    for offset in range(months - 1, -1, -1):
        cursor = date(today.year, today.month, 1)
        month_index = cursor.month - 1 - offset
        year = cursor.year + month_index // 12
        month = month_index % 12 + 1
        snapshot = date(year, month, 28)
        entries = []
        for row in rows:
            state = status_rules.StatusInput(
                workflow_status=row["workflow_status"],
                applicability=row["applicability"],
                expiry_date=row["expiry_date"],
                renewal_due_date=row["renewal_due_date"],
                internal_target_date=row["internal_target_date"],
                due_date=row["due_date"],
                renewal_in_process=row["renewal_in_process"],
            )
            entries.append((status_rules.compliance_bucket(state, snapshot), row["criticality"]))
        result = status_rules.compliance_index(entries)
        trend.append({
            "label": snapshot.strftime("%b %y"),
            "key": snapshot.strftime("%Y-%m"),
            "value": result["index"],
        })
    return trend


def _top_risks(rows: list[dict], limit: int = 10) -> list[dict]:
    def risk_score(row: dict) -> tuple:
        overdue = row["days_overdue"] or 0
        severity = {
            ComplianceBucket.EXPIRED: 3, ComplianceBucket.OVERDUE: 2,
            ComplianceBucket.UNDER_PROCESS: 1,
        }.get(row["bucket"], 0)
        return (severity, row["weight"], overdue)

    risky = [r for r in rows if r["bucket"] in (
        ComplianceBucket.EXPIRED, ComplianceBucket.OVERDUE, ComplianceBucket.UNDER_PROCESS
    )]
    risky.sort(key=risk_score, reverse=True)
    return [
        {
            "item_id": r["item_id"], "item_code": r["item_code"], "name": r["name"],
            "unit": r["unit"], "owner": r["owner"], "criticality": r["criticality"],
            "status": r["bucket"], "days_overdue": r["days_overdue"] or None,
            "days_left": r["days_left"], "expiry_date": r["expiry_date"],
            "exposure": (r["penalty_per_day"] or 0) * (r["days_overdue"] or 0) or None,
        }
        for r in risky[:limit]
    ]


def _active_escalations(db: Session, scope: Scope, rows: list[dict]) -> list[dict]:
    by_instance = {r["instance_id"]: r for r in rows if r["instance_id"]}
    escalated = [r for r in rows if (r["escalation_level"] or 0) >= 2]
    logs = {}
    if by_instance:
        for log in db.execute(
            select(EscalationLog).where(
                EscalationLog.instance_id.in_(tuple(by_instance.keys()))
            ).order_by(EscalationLog.triggered_at.desc())
        ).scalars().all():
            logs.setdefault(log.instance_id, log)

    out = []
    for row in sorted(escalated, key=lambda r: -(r["escalation_level"] or 0))[:15]:
        log = logs.get(row["instance_id"])
        out.append({
            "instance_id": row["instance_id"],
            "item_id": row["item_id"],
            "item_name": row["name"],
            "level": row["escalation_level"],
            "label": level_label(row["escalation_level"]),
            "since": log.triggered_at if log else utcnow(),
            "owner": row["owner"],
            "unit": row["unit"],
            "criticality": row["criticality"],
        })
    return out


def _owner_backlog(rows: list[dict], limit: int = 15) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if row["bucket"] == ComplianceBucket.COMPLIED:
            continue
        grouped[row["owner"] or "Unassigned"].append(row)

    out = []
    for owner, group in grouped.items():
        out.append({
            "owner_id": group[0]["owner_id"],
            "owner_name": owner,
            "open_items": len(group),
            "overdue": sum(1 for r in group if r["bucket"] == ComplianceBucket.OVERDUE),
            "expired": sum(1 for r in group if r["bucket"] == ComplianceBucket.EXPIRED),
            "oldest_days": max((r["days_overdue"] or 0) for r in group),
        })
    out.sort(key=lambda r: (-r["expired"], -r["overdue"], -r["open_items"]))
    return out[:limit]


# --------------------------------------------------------------------------- #
# 7.2 Compliance Officer operational dashboard
# --------------------------------------------------------------------------- #
OFFICER_TABS = (
    "Expired", "Due for renewal (≤30d)", "Upcoming (31-90d)",
    "Upcoming (91-180d)", "Pending submissions", "Awaiting verification",
    "Awaiting authority",
)


def officer_dashboard(
    db: Session, scope: Scope, *, filters: dict | None = None, today: date | None = None
) -> dict:
    today = today or ist_today()
    rows = build_rows(db, scope, filters=filters, today=today)

    def brief(row: dict) -> dict:
        return {
            "item_id": row["item_id"], "item_code": row["item_code"], "name": row["name"],
            "unit": row["unit"], "owner": row["owner"], "criticality": row["criticality"],
            "status": row["bucket"], "derived_status": row["derived_status"],
            "rag": row["rag"], "days_overdue": row["days_overdue"] or None,
            "days_left": row["days_left"], "expiry_date": row["expiry_date"],
            "cycle": row["cycle"], "escalation_level": row["escalation_level"],
            "department": row["department"],
        }

    tabs = {
        "Expired": [brief(r) for r in rows if r["bucket"] == ComplianceBucket.EXPIRED],
        "Due for renewal (≤30d)": [
            brief(r) for r in rows
            if r["days_left"] is not None and 0 <= r["days_left"] <= 30
            and r["bucket"] not in (ComplianceBucket.COMPLIED,)
        ],
        "Upcoming (31-90d)": [
            brief(r) for r in rows
            if r["days_left"] is not None and 31 <= r["days_left"] <= 90
        ],
        "Upcoming (91-180d)": [
            brief(r) for r in rows
            if r["days_left"] is not None and 91 <= r["days_left"] <= 180
        ],
        "Pending submissions": [
            brief(r) for r in rows
            if r["bucket"] in (ComplianceBucket.PENDING, ComplianceBucket.OVERDUE)
        ],
        "Awaiting verification": [
            brief(r) for r in rows if r["verification_status"] == "Awaiting Verification"
        ],
        "Awaiting authority": [
            brief(r) for r in rows if r["workflow_status"] == ItemStatus.SUBMITTED
        ],
    }

    today_actions = sorted(
        [
            brief(r) for r in rows
            if (r["days_left"] is not None and r["days_left"] <= 7)
            or r["bucket"] in (ComplianceBucket.EXPIRED, ComplianceBucket.OVERDUE)
        ],
        key=lambda r: (r["days_left"] if r["days_left"] is not None else 999),
    )[:20]

    calendar = _calendar_payload(rows, today)

    return {
        "generated_at": utcnow(),
        "tabs": tabs,
        "today_actions": today_actions,
        "calendar": calendar,
        "counts": {name: len(value) for name, value in tabs.items()},
    }


def _calendar_payload(rows: list[dict], today: date, months: int = 12) -> list[dict]:
    out = []
    cursor = date(today.year, today.month, 1)
    for _ in range(months):
        month_end = (cursor + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        items_in_month = [
            {
                "item_id": r["item_id"], "name": r["name"], "item_code": r["item_code"],
                "date": (r["expiry_date"] or r["due_date"]).isoformat()
                if (r["expiry_date"] or r["due_date"]) else None,
                "rag": r["rag"], "criticality": r["criticality"], "owner": r["owner"],
                "unit": r["unit"], "status": r["bucket"],
            }
            for r in rows
            if (r["expiry_date"] or r["due_date"])
            and cursor <= (r["expiry_date"] or r["due_date"]) <= month_end
        ]
        items_in_month.sort(key=lambda i: i["date"] or "")
        out.append({
            "year": cursor.year,
            "month": cursor.month,
            "label": cursor.strftime("%B %Y"),
            "total": len(items_in_month),
            "items": items_in_month,
        })
        cursor = month_end + timedelta(days=1)
    return out


# --------------------------------------------------------------------------- #
# 7.3 Department user "My Work"
# --------------------------------------------------------------------------- #
def my_work(db: Session, user, *, today: date | None = None) -> dict:
    today = today or ist_today()
    scope = __import__("app.core.rbac", fromlist=["build_scope"]).build_scope(user)
    rows = build_rows(db, scope, filters={}, today=today)

    mine = [r for r in rows if r["owner_id"] == user.id or r["item_id"] in _delegated_item_ids(db, user)]
    delegated = [r for r in mine if r["owner_id"] == user.id and _has_delegate(db, r["item_id"])]

    def brief(row: dict) -> dict:
        return {
            "item_id": row["item_id"], "item_code": row["item_code"], "name": row["name"],
            "unit": row["unit"], "owner": row["owner"], "criticality": row["criticality"],
            "status": row["bucket"], "derived_status": row["derived_status"], "rag": row["rag"],
            "days_overdue": row["days_overdue"] or None, "days_left": row["days_left"],
            "expiry_date": row["expiry_date"], "cycle": row["cycle"],
            "escalation_level": row["escalation_level"], "department": row["department"],
        }

    open_items = sorted(
        [brief(r) for r in mine if r["bucket"] != ComplianceBucket.COMPLIED],
        key=lambda r: (r["days_left"] if r["days_left"] is not None else 999),
    )

    return {
        "generated_at": utcnow(),
        "open_items": open_items,
        "upcoming_90": [
            brief(r) for r in mine
            if r["days_left"] is not None and 0 <= r["days_left"] <= 90
        ],
        "awaiting_upload": [
            brief(r) for r in mine
            if r["workflow_status"] in (ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED)
        ],
        "delegated": [brief(r) for r in delegated],
        "overdue": [brief(r) for r in mine if r["bucket"] in (
            ComplianceBucket.EXPIRED, ComplianceBucket.OVERDUE)],
        "counts": {
            "open": len(open_items),
            "overdue": sum(1 for r in mine if r["bucket"] == ComplianceBucket.OVERDUE),
            "expired": sum(1 for r in mine if r["bucket"] == ComplianceBucket.EXPIRED),
            "escalated": sum(1 for r in mine if (r["escalation_level"] or 0) >= 2),
        },
    }


def _delegated_item_ids(db: Session, user) -> set[str]:
    """Items where an active delegation to this user is in force (AC-06)."""
    from app.models.auth import Delegation

    now = utcnow()
    rows = db.execute(
        select(Delegation).where(
            Delegation.to_user_id == user.id,
            Delegation.active.is_(True),
            Delegation.is_deleted.is_(False),
            Delegation.start_date <= now,
            Delegation.end_date >= now,
        )
    ).scalars().all()
    if not rows:
        return set()
    from_user_ids = [r.from_user_id for r in rows]
    return set(
        db.execute(
            select(ComplianceItem.id).where(
                ComplianceItem.owner_id.in_(from_user_ids),
                ComplianceItem.is_deleted.is_(False),
            )
        ).scalars().all()
    )


def _has_delegate(db: Session, item_id: str) -> bool:
    return db.execute(
        select(ComplianceItem.delegate_id).where(ComplianceItem.id == item_id)
    ).scalar_one_or_none() is not None
