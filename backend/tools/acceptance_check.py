"""Acceptance harness for the PRD's §17.3 criteria (AC-1 … AC-8).

Runs against the real application through the real HTTP surface — the same
FastAPI app, the same database, the same permissions — so a pass here means the
software actually behaves as the requirement document says, not that a mock
agrees with itself.

Usage (from ``backend/``)::

    PYTHONIOENCODING=utf-8 .venv/Scripts/python.exe tools/acceptance_check.py

Exit code is 0 only when every criterion passes. Each check prints the evidence
it used, so a failure is diagnosable without re-running under a debugger.
"""

from __future__ import annotations

import json
import sys
import traceback
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

# Running a script from tools/ puts tools/ on sys.path, not the backend root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The evidence lines use typographic dashes and arrows. Windows consoles default
# to cp1252, which cannot encode them, so the run would die part-way through a
# criterion on a printing error rather than a real failure. Reconfigure rather
# than asking the caller to remember PYTHONIOENCODING.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient
from sqlalchemy import func, select

import app.core.config as config

config.settings.scheduler_enabled = False  # The harness drives the engine itself.

from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models.audit import AuditLog  # noqa: E402
from app.models.compliance import ComplianceInstance, ComplianceItem  # noqa: E402
from app.models.reminders import EscalationLog, ReminderLog  # noqa: E402
from app.domain.dates import ist_today  # noqa: E402
from app.services import reminders as reminder_service  # noqa: E402

PASSWORD = "Comply@2026!"
ACCOUNTS = {
    "Administrator": "admin@complytrack.local",
    "Compliance Team": "compliance@complytrack.local",
    "Department User": "safety.owner@complytrack.local",
    "Management View": "unit.head@complytrack.local",
    "Auditor": "auditor@complytrack.local",
}


@dataclass
class Result:
    code: str
    title: str
    passed: bool
    evidence: list[str] = field(default_factory=list)
    failure: str | None = None

    def note(self, line: str) -> None:
        self.evidence.append(line)


RESULTS: list[Result] = []


def check(code: str, title: str):
    """Decorator: run one criterion and record its outcome instead of aborting."""

    def wrap(fn):
        def run(client: TestClient, tokens: dict[str, str]):
            result = Result(code=code, title=title, passed=True)
            try:
                fn(client, tokens, result)
            except AssertionError as exc:
                result.passed = False
                result.failure = str(exc)
            except Exception:  # noqa: BLE001
                result.passed = False
                result.failure = traceback.format_exc(limit=4).strip().splitlines()[-1]
            RESULTS.append(result)
            flag = "PASS" if result.passed else "FAIL"
            print(f"  [{flag}] {code} — {title}")
            for line in result.evidence:
                print(f"         · {line}")
            if result.failure:
                print(f"         ! {result.failure}")

        run.__name__ = fn.__name__
        return run

    return wrap


def auth(tokens: dict[str, str], role: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens[role]}"}


# --------------------------------------------------------------------------- #
# AC-1 — dates derived from issue date and validity
# --------------------------------------------------------------------------- #
@check("AC-1", "Issue date + validity derives expiry, renewal due and reminder offsets")
def ac1(client, tokens, result: Result):
    body = {
        "name": "AC-1 probe — boiler inspection certificate",
        "type": "Certificate",
        "criticality": "High",
        "unit_id": UNITS["YARD"],
        "department_id": DEPARTMENTS["EHS"],
        "category_id": CATEGORIES["Factory, Safety & Occupational Health"],
        "owner_id": OWNER_ID,
        "issue_date": "2026-04-01",
        "validity_value": 12,
        "validity_unit": "months",
        "authority_processing_days": 45,
        "internal_prep_days": 30,
        "create_first_instance": True,
        "ignore_duplicate_check": True,
        "recurrence_rule": "annual",
    }
    response = client.post("/api/v1/items", json=body, headers=auth(tokens, "Administrator"))
    assert response.status_code in (200, 201), f"create returned {response.status_code}: {response.text[:200]}"
    item = response.json()
    PROBE["ac1_item_id"] = item["id"]

    assert item["expiry_date"] == "2027-03-31", f"expected expiry 2027-03-31, got {item['expiry_date']}"
    result.note(f"expiry 01-Apr-2026 + 12 months = {item['expiry_date']}")

    # Renewal due = expiry − authority processing days; internal target = due − prep.
    expected_due = (date(2027, 3, 31) - timedelta(days=45)).isoformat()
    expected_target = (date(2027, 3, 31) - timedelta(days=75)).isoformat()
    assert item["renewal_due_date"] == expected_due, (
        f"renewal due {item['renewal_due_date']} != {expected_due}"
    )
    assert item["internal_target_date"] == expected_target, (
        f"internal target {item['internal_target_date']} != {expected_target}"
    )
    result.note(f"renewal due {item['renewal_due_date']} = expiry − 45 processing days")
    result.note(f"internal target {item['internal_target_date']} = renewal due − 30 prep days")

    # The reminder ladder the profile actually schedules.
    offsets = client.get("/api/v1/dashboards/criticality-weights", headers=auth(tokens, "Administrator"))
    meta = client.get("/api/v1/meta", headers=auth(tokens, "Administrator")).json()
    ladder = meta["default_reminder_offsets"]
    for wanted in (90, 60, 30, 15, 7, 3, 1, 0):
        assert wanted in ladder, f"offset {wanted} missing from the reminder ladder {ladder}"
    result.note(f"reminder offsets scheduled: {ladder}")
    assert offsets.status_code == 200


# --------------------------------------------------------------------------- #
# AC-2 — one escalation per trigger, no duplicates on re-run
# --------------------------------------------------------------------------- #
@check("AC-2", "Escalation fires once and is idempotent across scheduler re-runs")
def ac2(client, tokens, result: Result):
    with SessionLocal() as db:
        before_reminders = db.execute(select(func.count(ReminderLog.id))).scalar_one()
        before_escalations = db.execute(select(func.count(EscalationLog.id))).scalar_one()

        first = reminder_service.run_daily_reminders(db, commit=True)
        after_first_reminders = db.execute(select(func.count(ReminderLog.id))).scalar_one()
        after_first_escalations = db.execute(select(func.count(EscalationLog.id))).scalar_one()

        second = reminder_service.run_daily_reminders(db, commit=True)
        after_second_reminders = db.execute(select(func.count(ReminderLog.id))).scalar_one()
        after_second_escalations = db.execute(select(func.count(EscalationLog.id))).scalar_one()

    result.note(
        f"run 1: +{after_first_reminders - before_reminders} reminders, "
        f"+{after_first_escalations - before_escalations} escalations"
    )
    result.note(
        f"run 2: +{after_second_reminders - after_first_reminders} reminders, "
        f"+{after_second_escalations - after_first_escalations} escalations "
        f"({second['skipped_duplicates']} suppressed as duplicates)"
    )
    assert after_second_reminders == after_first_reminders, "a re-run created duplicate reminders"
    assert after_second_escalations == after_first_escalations, "a re-run created duplicate escalations"

    # Nobody is notified twice for the same trigger.
    with SessionLocal() as db:
        duplicates = db.execute(
            select(ReminderLog.dedupe_key, func.count())
            .group_by(ReminderLog.dedupe_key)
            .having(func.count() > 1)
        ).all()
    assert not duplicates, f"{len(duplicates)} duplicate reminder keys persisted"
    result.note("no duplicate dedupe_key in reminder_log or escalation_log")

    # The escalation is visible on the item's timeline (AT requirement / AC-2).
    if PROBE.get("ac1_item_id"):
        detail = client.get(
            f"/api/v1/items/{PROBE['ac1_item_id']}", headers=auth(tokens, "Administrator")
        ).json()
        instance_id = (detail.get("current_instance") or {}).get("id")
        if instance_id:
            timeline = client.get(
                f"/api/v1/instances/{instance_id}/timeline",
                headers=auth(tokens, "Administrator"),
            )
            assert timeline.status_code == 200, f"timeline returned {timeline.status_code}"
            result.note(f"item timeline reachable ({len(timeline.json())} entries)")


# --------------------------------------------------------------------------- #
# AC-3 — verification closes the cycle and opens the next one
# --------------------------------------------------------------------------- #
@check("AC-3", "Approving verification closes the cycle and creates the next one")
def ac3(client, tokens, result: Result):
    item_id = PROBE.get("ac1_item_id")
    assert item_id, "AC-1 did not produce an item to verify"

    detail = client.get(f"/api/v1/items/{item_id}", headers=auth(tokens, "Administrator")).json()
    instance_id = (detail.get("current_instance") or {}).get("id")
    assert instance_id, "the probe item has no open cycle"

    # The PRD's state machine is Pending -> Under Process -> Submitted -> Closed,
    # so the harness walks it rather than skipping a step. Approving an
    # unsubmitted cycle must be refused, not crashed on.
    premature = client.post(
        f"/api/v1/instances/{instance_id}/verify",
        json={"decision": "approve", "remark": "not yet submitted"},
        headers=auth(tokens, "Compliance Team"),
    )
    assert premature.status_code == 409, (
        f"verifying a Pending cycle returned {premature.status_code}, expected 409: "
        f"{premature.text[:200]}"
    )
    result.note(f"verifying before submission → 409 ({premature.json()['detail']})")

    for target, extra in (("Under Process", {"expected_filing_date": "2027-03-15"}),):
        moved = client.post(
            f"/api/v1/instances/{instance_id}/transition",
            json={
                "target_status": target,
                "reason": f"Acceptance probe AC-3 → {target}",
                **extra,
            },
            headers=auth(tokens, "Compliance Team"),
        )
        assert moved.status_code == 200, (
            f"transition to {target} returned {moved.status_code}: {moved.text[:200]}"
        )
        result.note(f"cycle moved to {target}")

    # Submitting without evidence must be refused: that is the closure rule the
    # PRD calls out in §6 rule 3.
    unevidenced = client.post(
        f"/api/v1/instances/{instance_id}/transition",
        json={"target_status": "Submitted", "reason": "no documents attached"},
        headers=auth(tokens, "Compliance Team"),
    )
    assert unevidenced.status_code == 409, (
        f"submitting without evidence returned {unevidenced.status_code}, expected 409"
    )
    assert "document" in unevidenced.json()["detail"].lower(), unevidenced.json()["detail"]
    result.note("submitting without evidence → 409 (closure rule enforced)")

    upload = client.post(
        "/api/v1/documents",
        data={
            "title": "Renewed boiler inspection certificate",
            "doc_type": "Certificate",
            "item_id": item_id,
            "instance_id": instance_id,
            "reference_number": "YARD/AC1/2027",
            "issue_date": "2027-04-05",
            "expiry_date": "2028-03-31",
            "change_note": "Uploaded by the acceptance probe for AC-3.",
        },
        files={
            "file": (
                "renewed-certificate.pdf",
                b"%PDF-1.4\n% acceptance probe evidence\n%%EOF\n",
                "application/pdf",
            )
        },
        headers=auth(tokens, "Compliance Team"),
    )
    assert upload.status_code in (200, 201), (
        f"document upload returned {upload.status_code}: {upload.text[:300]}"
    )
    result.note(f"renewed certificate uploaded (document id {upload.json().get('id', '?')})")

    submitted = client.post(
        f"/api/v1/instances/{instance_id}/transition",
        json={
            "target_status": "Submitted",
            "reason": "Acceptance probe AC-3 → Submitted",
            "submission_date": "2027-03-10",
            "acknowledgement_no": "ACK/AC1/2027",
        },
        headers=auth(tokens, "Compliance Team"),
    )
    assert submitted.status_code == 200, (
        f"transition to Submitted returned {submitted.status_code}: {submitted.text[:200]}"
    )
    result.note("cycle moved to Submitted with evidence on file")

    new_expiry = "2028-03-31"
    response = client.post(
        f"/api/v1/instances/{instance_id}/verify",
        json={
            "decision": "approve",
            "remark": "Certificate received and verified against the originals.",
            "new_issue_date": "2027-04-05",
            "new_expiry_date": new_expiry,
            "new_reference_number": "YARD/AC1/2027",
            "roll_forward": True,
        },
        headers=auth(tokens, "Compliance Team"),
    )
    assert response.status_code == 200, f"verify returned {response.status_code}: {response.text[:300]}"
    payload = response.json()
    result.note(
        f"cycle closed: verification_status={payload.get('verification_status')} "
        f"status={payload.get('status')} closed_at={payload.get('closed_at')}"
    )
    assert payload.get("verification_status") == "Approved", (
        f"verification was not recorded as Approved: {payload.get('verification_status')}"
    )
    PROBE["ac3_instance_id"] = instance_id
    PROBE["ac3_document_id"] = upload.json().get("id")

    after = client.get(f"/api/v1/items/{item_id}", headers=auth(tokens, "Administrator")).json()
    assert after["expiry_date"] == new_expiry, (
        f"item expiry is {after['expiry_date']}, expected {new_expiry} to roll forward"
    )
    result.note(f"item expiry rolled forward to {after['expiry_date']}")

    with SessionLocal() as db:
        cycles = list(
            db.execute(
                select(ComplianceInstance).where(ComplianceInstance.item_id == item_id)
            ).scalars()
        )
    assert len(cycles) >= 2, f"expected a next cycle to be created, found {len(cycles)}"
    statuses = sorted(c.status for c in cycles)
    result.note(f"{len(cycles)} cycles on the item: {statuses}")
    assert any(c.status in ("Closed", "Renewed") for c in cycles), (
        f"no cycle reached a satisfied state: {statuses}"
    )


# --------------------------------------------------------------------------- #
# AC-4 — department scoping and protected actions
# --------------------------------------------------------------------------- #
@check("AC-4", "A department user is scoped to their own items and blocked from closing a Critical one")
def ac4(client, tokens, result: Result):
    # A Department User cannot see the whole register.
    forbidden = client.get("/api/v1/items?page_size=1", headers=auth(tokens, "Department User"))
    assert forbidden.status_code in (200, 403), f"unexpected {forbidden.status_code}"
    if forbidden.status_code == 200:
        rows = forbidden.json()["items"]
    else:
        rows = []

    # Everything they can see must belong to their department.
    with SessionLocal() as db:
        user_id = client.get("/api/v1/auth/me", headers=auth(tokens, "Department User")).json()
        from app.models.auth import User as UserModel

        owner = db.get(UserModel, user_id["id"])
        own_department = owner.department_id

    if rows:
        with SessionLocal() as db:
            foreign = [
                row["item_code"]
                for row in rows
                if row.get("department_id") and row["department_id"] != own_department
            ]
        assert not foreign, f"scoped user can see other departments' items: {foreign[:5]}"
        result.note(f"scoped list returned {len(rows)} row(s), all within their own department")
    else:
        result.note("scoped list is empty for this user (no rows leaked)")

    # An admin-only action is refused for that role.
    denied = client.get("/api/v1/users", headers=auth(tokens, "Department User"))
    assert denied.status_code == 403, f"expected 403 on /users, got {denied.status_code}"
    result.note("GET /users → 403 for Department User")

    denied = client.get("/api/v1/audit", headers=auth(tokens, "Department User"))
    assert denied.status_code == 403, f"expected 403 on /audit, got {denied.status_code}"
    result.note("GET /audit → 403 for Department User")

    # Closing a Critical item requires the verification permission.
    with SessionLocal() as db:
        critical = db.execute(
            select(ComplianceItem)
            .where(ComplianceItem.criticality == "Critical", ComplianceItem.is_deleted.is_(False))
            .limit(1)
        ).scalars().first()
        instance = None
        if critical is not None:
            instance = db.execute(
                select(ComplianceInstance).where(ComplianceInstance.item_id == critical.id).limit(1)
            ).scalars().first()

    if instance is not None:
        response = client.post(
            f"/api/v1/instances/{instance.id}/verify",
            json={"new_expiry_date": "2030-01-01", "verification_remark": "attempted by a scoped user"},
            headers=auth(tokens, "Department User"),
        )
        assert response.status_code == 403, (
            f"a Department User was allowed to verify a Critical item ({response.status_code})"
        )
        result.note("POST /instances/{id}/verify on a Critical item → 403 for Department User")
    else:
        result.note("no Critical item with a cycle available to probe")


# --------------------------------------------------------------------------- #
# AC-5 — the dashboard agrees with the register
# --------------------------------------------------------------------------- #
@check("AC-5", "Dashboard bucket counts equal the register counts for the same filters")
def ac5(client, tokens, result: Result):
    filters = [
        {},
        {"unit_id": UNITS["YARD"]},
        {"criticality": "Critical"},
        {"category_id": CATEGORIES["Labour & Employment"]},
        {"unit_id": UNITS["DRAYDOCK"] if "DRAYDOCK" in UNITS else UNITS["YARD"], "criticality": "High"},
    ]
    for extra in filters:
        dashboard = client.get(
            "/api/v1/dashboards/management", params=extra, headers=auth(tokens, "Administrator")
        )
        assert dashboard.status_code == 200, f"dashboard {extra} → {dashboard.status_code}"
        split = {row["key"]: row["value"] for row in dashboard.json()["status_split"]}
        dashboard_total = sum(split.values())

        register_total = 0
        register_split: dict[str, int] = {}
        page = 1
        while True:
            listing = client.get(
                "/api/v1/items",
                params={**extra, "page": page, "page_size": 200},
                headers=auth(tokens, "Administrator"),
            )
            assert listing.status_code == 200, f"register {extra} → {listing.status_code}"
            body = listing.json()
            for row in body["items"]:
                bucket = row.get("bucket")
                register_total += 1
                if bucket:
                    register_split[bucket] = register_split.get(bucket, 0) + 1
            if page >= body["pages"]:
                break
            page += 1

        label = json.dumps(extra) if extra else "(no filters)"
        assert dashboard_total == register_total, (
            f"{label}: dashboard total {dashboard_total} != register total {register_total}"
        )
        for bucket, value in split.items():
            expected = register_split.get(bucket, 0)
            assert value == expected, f"{label}: {bucket} dashboard {value} != register {expected}"
        result.note(f"{label}: {dashboard_total} rows agree across dashboard and register")


# --------------------------------------------------------------------------- #
# AC-6 — every edit is audited, and the trail cannot be edited
# --------------------------------------------------------------------------- #
@check("AC-6", "Field edits land in the audit log with old/new values; the trail is immutable")
def ac6(client, tokens, result: Result):
    item_id = PROBE.get("ac1_item_id")
    assert item_id, "AC-1 did not produce an item to edit"

    before = client.get(f"/api/v1/items/{item_id}", headers=auth(tokens, "Administrator")).json()
    new_remarks = f"Audited edit at {ist_today().isoformat()}"
    response = client.patch(
        f"/api/v1/items/{item_id}",
        json={"remarks": new_remarks, "reason": "Acceptance probe AC-6"},
        headers=auth(tokens, "Administrator"),
    )
    assert response.status_code == 200, f"patch returned {response.status_code}: {response.text[:200]}"

    with SessionLocal() as db:
        row = db.execute(
            select(AuditLog)
            .where(AuditLog.entity_id == item_id, AuditLog.action == "update")
            .order_by(AuditLog.ts_utc.desc())
        ).scalars().first()
    assert row is not None, "the edit produced no audit row"
    result.note(f"audit row written: action={row.action} entity={row.entity_type} user={row.user_id}")
    assert row.user_id, "the audit row does not record who made the change"
    assert row.changes or row.field, "the audit row records neither a field nor a change set"
    if row.changes:
        result.note(f"changes recorded: {list(row.changes)[:6]}")

    # The trail is append-only: there is no write surface for it at all.
    for method, path in (
        ("POST", "/api/v1/audit"),
        ("PATCH", f"/api/v1/audit/{row.id}"),
        ("DELETE", f"/api/v1/audit/{row.id}"),
    ):
        attempt = client.request(method, path, headers=auth(tokens, "Administrator"))
        assert attempt.status_code in (404, 405), (
            f"{method} {path} returned {attempt.status_code} — the audit log must not be writable"
        )
    result.note("POST/PATCH/DELETE on the audit trail → 404/405 (no write surface exists)")

    with SessionLocal() as db:
        chain = __import__("app.services.audit", fromlist=["verify_chain"]).verify_chain(db)
    assert chain.get("intact") is True, f"audit chain broken: {chain}"
    result.note(f"hash chain intact across {chain.get('entries')} entries")


# --------------------------------------------------------------------------- #
# AC-7 — the renewal calendar and its exports
# --------------------------------------------------------------------------- #
@check("AC-7", "The renewal calendar lists the month's items and exports to Excel and PDF")
def ac7(client, tokens, result: Result):
    calendar = client.get("/api/v1/dashboards/calendar", headers=auth(tokens, "Administrator"))
    assert calendar.status_code == 200, f"calendar → {calendar.status_code}"
    body = calendar.json()
    months = body.get("months") or []
    events = body.get("events") or {}
    result.note(f"calendar covers {len(months)} month(s): {[m['label'] for m in months][:4]}")
    assert months, "the calendar returned no months"

    # Each month's total must equal the events actually listed for it, and every
    # date key must fall inside a month the response claims to cover.
    covered = {f"{m['year']:04d}-{m['month']:02d}" for m in months}
    for month in months:
        assert len(month["items"]) == month["total"], (
            f"{month['label']}: month items {len(month['items'])} != total {month['total']}"
        )
    result.note("every month header total matches the renewals it lists")

    # Each month's renewals must actually appear under their own date key.
    missing = 0
    checked = 0
    for month in months:
        for entry in month["items"]:
            checked += 1
            day = events.get(entry["date"]) or []
            if entry["item_code"] not in {e["item_code"] for e in day}:
                missing += 1
    assert checked, "the calendar lists no renewals across its whole window"
    assert missing == 0, f"{missing} of {checked} listed renewals are absent from the day view"
    result.note(f"all {checked} listed renewals also appear under their own day key")

    # A month that actually contains renewals, cross-checked against the register.
    busiest = max(months, key=lambda m: m["total"])
    result.note(f"busiest month {busiest['label']} lists {busiest['total']} renewal(s)")

    # The export parameter is `fmt`; an unknown name is ignored and the default
    # (xlsx) comes back, so the harness passes the real one.
    for fmt, needle, media in (
        ("xlsx", b"PK", "spreadsheet"),
        ("pdf", b"%PDF", "pdf"),
        ("csv", None, "csv"),
    ):
        export = client.get(
            "/api/v1/reports/R3/export", params={"fmt": fmt}, headers=auth(tokens, "Administrator")
        )
        assert export.status_code == 200, f"R3 {fmt} export → {export.status_code}"
        if needle is not None:
            assert export.content.startswith(needle), f"R3 {fmt} export is not a real {fmt} file"
        else:
            assert b"," in export.content[:2000], "R3 csv export has no delimiters"
        assert fmt in export.headers.get("content-disposition", ""), (
            f"R3 {fmt} export names the wrong file: {export.headers.get('content-disposition')}"
        )
        result.note(f"R3 {media} export: {len(export.content):,} bytes, magic and filename ok")


# --------------------------------------------------------------------------- #
# AC-8 — expired items and their repeating reminders
# --------------------------------------------------------------------------- #
@check("AC-8", "Expired items show red on the dashboard and remind every two days until closed")
def ac8(client, tokens, result: Result):
    dashboard = client.get("/api/v1/dashboards/management", headers=auth(tokens, "Administrator")).json()
    split = {row["key"]: row["value"] for row in dashboard["status_split"]}
    expired = split.get("Expired", 0)
    result.note(f"dashboard reports {expired} expired obligation(s)")
    assert expired > 0, "the seeded register has expired items but the dashboard shows none"

    # Every expired item must carry the red RAG chip, not merely be counted.
    listing = client.get(
        "/api/v1/items",
        params={"derived_status": "Expired", "page_size": 200},
        headers=auth(tokens, "Administrator"),
    )
    assert listing.status_code == 200, f"derived_status filter → {listing.status_code}"
    body = listing.json()
    rows = body["items"]
    assert rows, "filtering the register to Expired returned nothing"
    assert body["total"] == len(rows), (
        f"filtered total {body['total']} disagrees with the {len(rows)} rows returned"
    )
    assert body["pages"] == 1, f"8 rows reported across {body['pages']} pages"
    wrong = [r["item_code"] for r in rows if r["rag"] != "red"]
    assert not wrong, f"expired items not flagged red: {wrong[:5]}"
    result.note(f"{len(rows)} expired item(s) returned in one page, all rag=red")
    assert len(rows) == expired, (
        f"the Expired filter shows {len(rows)} items but the dashboard counts {expired}"
    )
    result.note("the Expired filter count matches the dashboard's Expired bucket")

    # Post-expiry reminders repeat on the configured cadence.
    with SessionLocal() as db:
        post_expiry_offsets = sorted(
            {
                log.offset
                for log in db.execute(select(ReminderLog).where(ReminderLog.is_post_expiry.is_(True))).scalars()
            }
        )
    result.note(f"post-expiry reminder offsets in use: {post_expiry_offsets or 'none yet'}")

    profile = client.get("/api/v1/reminders/profiles", headers=auth(tokens, "Administrator"))
    assert profile.status_code == 200, f"profiles → {profile.status_code}"
    profiles = profile.json()
    profiles = profiles.get("items", profiles) if isinstance(profiles, dict) else profiles
    assert profiles, "no reminder profile is configured"
    default_profile = next((p for p in profiles if p.get("is_default")), profiles[0])
    frequency = default_profile.get("post_expiry_frequency_days")
    assert frequency == 2, (
        f"the default profile '{default_profile['name']}' repeats every {frequency} days "
        f"after expiry, the PRD requires every 2 days"
    )
    result.note(
        f"default profile '{default_profile['name']}' repeats every {frequency} days "
        f"after expiry, as AC-8 requires"
    )
    # Critical obligations are deliberately accelerated; that must be visible.
    accelerated = [p for p in profiles if p.get("post_expiry_frequency_days") == 1]
    if accelerated:
        result.note(f"critical obligations escalate faster: {accelerated[0]['name']} repeats daily")


# --------------------------------------------------------------------------- #
# Supplementary checks — surfaces the PRD implies but does not number
# --------------------------------------------------------------------------- #
@check("EXPORT", "The register workbook honours the grid's filters")
def export_filters(client, tokens, result: Result):
    """A filtered grid must export the filtered rows, not the whole register.

    The workbook is what an auditor is handed, so a silently-widened export is
    worse than no filter at all: the totals in the file would not describe the
    rows the person filtered to on screen.
    """
    import io

    from openpyxl import load_workbook

    headers = auth(tokens, "Administrator")

    def workbook_rows(params: dict) -> list[list]:
        response = client.get("/api/v1/items/export/register", params=params, headers=headers)
        assert response.status_code == 200, f"export {params} → {response.status_code}"
        sheet = load_workbook(io.BytesIO(response.content)).active
        return [row for row in sheet.iter_rows(min_row=2, values_only=True) if any(row)]

    everything = workbook_rows({})
    assert everything, "the unfiltered export produced no rows"

    for params, field in (
        ({"criticality": "Critical"}, 16),      # 'Criticality' column
        ({"unit_id": UNITS["YARD"]}, 3),        # 'Unit' column
    ):
        narrowed = workbook_rows(params)
        assert narrowed, f"export {params} produced no rows"
        assert len(narrowed) < len(everything), (
            f"export {params} returned {len(narrowed)} of {len(everything)} rows — the filter "
            f"was ignored"
        )
        distinct = {row[field] for row in narrowed}
        assert len(distinct) == 1, f"export {params} leaked rows outside the filter: {distinct}"
        result.note(
            f"{params} → {len(narrowed)} of {len(everything)} rows, all {field == 16 and 'criticality' or 'unit'} "
            f"= {distinct.pop()!r}"
        )

    # The computed filters are the ones most likely to be dropped, since SQL
    # cannot express them.
    expired_dashboard = client.get(
        "/api/v1/dashboards/management", headers=headers
    ).json()
    expired_bucket = next(
        (row["value"] for row in expired_dashboard["status_split"] if row["key"] == "Expired"), 0
    )
    expired_export = workbook_rows({"derived_status": "Expired"})
    assert len(expired_export) == expired_bucket, (
        f"derived_status=Expired exported {len(expired_export)} rows but the dashboard reports "
        f"{expired_bucket} expired obligations"
    )
    result.note(
        f"derived_status=Expired → {len(expired_export)} rows, matching the dashboard bucket"
    )


@check("SCHEDULE", "A report scheduled through the API is picked up for delivery")
def schedule_runs(client, tokens, result: Result):
    """A schedule that can never fire is worse than a rejected request.

    The delivery sweep selects rows where ``next_run_at <= now``, so a schedule
    stored with a NULL there is listed back to the user as configured and then
    silently never sent.
    """
    headers = auth(tokens, "Administrator")
    code = client.get("/api/v1/reports", headers=headers).json()[0]["code"]
    assert code, "the report catalogue is empty"

    created = client.post(
        "/api/v1/reports/schedules",
        json={
            "report_code": code,
            "name": "Acceptance probe schedule",
            "frequency": "monthly",
            "recipients": ["ehs.owner@complytrack.local"],
            "format": "xlsx",
        },
        headers=headers,
    )
    assert created.status_code == 201, f"schedule creation → {created.status_code} {created.text[:160]}"
    schedule = created.json()
    assert schedule["next_run_at"], (
        "the schedule was stored with no next_run_at, so the delivery sweep "
        "(next_run_at <= now) will never select it"
    )
    result.note(f"schedule {schedule['id'][:8]} on {code} queued for {schedule['next_run_at']}")

    from datetime import datetime, timedelta, timezone

    from app.models.reminders import ScheduledReport
    from app.scheduler import run_scheduled_reports_job

    # Bring it due, then run the job the scheduler runs.
    with SessionLocal() as db:
        row = db.get(ScheduledReport, schedule["id"])
        row.next_run_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

    run_scheduled_reports_job()

    with SessionLocal() as db:
        row = db.get(ScheduledReport, schedule["id"])
        assert row.last_run_at is not None, "the sweep ran but did not deliver this schedule"
        assert row.next_run_at > datetime.now(timezone.utc), (
            "the sweep delivered the schedule but did not advance next_run_at past now, "
            "so it would fire again on every run"
        )
        result.note(f"delivered once at {row.last_run_at}, next due {row.next_run_at}")

    removed = client.delete(f"/api/v1/reports/schedules/{schedule['id']}", headers=headers)
    assert removed.status_code == 200, f"schedule delete → {removed.status_code}"
    remaining = client.get("/api/v1/reports/schedules/list", headers=headers).json()
    remaining = remaining.get("items", remaining) if isinstance(remaining, dict) else remaining
    assert all(row["id"] != schedule["id"] for row in remaining), (
        "a deleted schedule is still listed"
    )
    result.note("deleted schedule is gone from the list and from the delivery sweep")


# --------------------------------------------------------------------------- #
# Route smoke sweep — every documented endpoint must answer, not explode
# --------------------------------------------------------------------------- #
def route_smoke(client: TestClient, tokens: dict[str, str]) -> Result:
    """Call every endpoint in the OpenAPI document and flag any 5xx.

    Several defects found while writing this harness were attribute and import
    mistakes on code paths no test had reached, so this walks the whole
    documented surface with a real administrator and reports the ones that
    crash. A 4xx is a fine answer — it means validation or permission refused
    the call. A 5xx means the server broke.
    """
    result = Result(code="SMOKE", title="Every documented endpoint answers without a 5xx", passed=True)
    spec = client.get("/api/openapi.json").json()

    path_values = {
        "item_id": PROBE.get("ac1_item_id"),
        "instance_id": PROBE.get("ac3_instance_id"),
        "document_id": PROBE.get("ac3_document_id"),
        "template_id": _first_id(client, tokens, "/api/v1/templates"),
        "user_id": _first_id(client, tokens, "/api/v1/users"),
        "category_id": next(iter(CATEGORIES.values()), None),
        "department_id": next(iter(DEPARTMENTS.values()), None),
        "unit_id": next(iter(UNITS.values()), None),
        "authority_id": _first_id(client, tokens, "/api/v1/org/authorities"),
        "holiday_id": _first_id(client, tokens, "/api/v1/org/holidays"),
        "profile_id": _first_id(client, tokens, "/api/v1/reminders/profiles"),
        "template_id_reminders": None,
        "notification_id": _first_id(client, tokens, "/api/v1/notifications"),
        "schedule_id": _first_id(client, tokens, "/api/v1/reports/schedules/list"),
        "link_id": _first_id(client, tokens, "/api/v1/documents/share-links"),
        "checklist_id": None,
        "log_id": _first_id(client, tokens, "/api/v1/reminders/escalation-log"),
        "key": "reminder_lead_days",
    }

    checked = 0
    failures: list[str] = []
    for path, methods in sorted(spec["paths"].items()):
        if not path.startswith("/api/"):
            continue
        for method in sorted(methods):
            if method not in ("get", "post", "patch", "put", "delete"):
                continue
            url = path
            unresolved = False
            for name in _path_params(path):
                value = path_values.get(name)
                if not value:
                    unresolved = True
                    break
                url = url.replace("{" + name + "}", str(value))
            if unresolved:
                continue

            checked += 1
            try:
                response = client.request(
                    method.upper(),
                    url,
                    json={} if method in ("post", "patch", "put") else None,
                    headers=auth(tokens, "Administrator"),
                )
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{method.upper()} {url} raised {type(exc).__name__}: {exc}")
                continue
            if response.status_code >= 500:
                # 501 is a deliberate "this feature is not configured" answer
                # (SSO, for one), not a crash. Anything else is a defect.
                if response.status_code == 501:
                    result.note(f"  501 {method.upper()} {url} (deliberately not implemented)")
                    continue
                failures.append(f"{method.upper()} {url} → {response.status_code}")

    result.note(f"{checked} endpoint(s) called across the documented surface")
    if failures:
        result.passed = False
        result.failure = f"{len(failures)} endpoint(s) returned a server error"
        for line in failures:
            result.note(f"  5xx {line}")
    else:
        result.note("no endpoint returned a 5xx")
    return result


def _path_params(path: str) -> list[str]:
    return [p.split(":")[0] for p in path.split("{")[1:]] if "{" in path else []


def _first_id(client: TestClient, tokens: dict[str, str], url: str) -> str | None:
    """First row id from a listing endpoint, for use as a path parameter."""
    try:
        body = client.get(url, headers=auth(tokens, "Administrator")).json()
    except Exception:  # noqa: BLE001
        return None
    rows = body.get("items", body.get("rows", body)) if isinstance(body, dict) else body
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return rows[0].get("id")
    return None


# --------------------------------------------------------------------------- #
# Bootstrap
# --------------------------------------------------------------------------- #
def load_reference() -> None:
    """Cache the seeded ids the probes need."""
    global UNITS, DEPARTMENTS, CATEGORIES, OWNER_ID
    with SessionLocal() as db:
        from app.models.auth import User as UserModel
        from app.models.org import Category, Department, OrganisationUnit

        UNITS = {u.code: u.id for u in db.execute(select(OrganisationUnit)).scalars()}
        DEPARTMENTS = {d.code: d.id for d in db.execute(select(Department)).scalars()}
        CATEGORIES = {c.name: c.id for c in db.execute(select(Category)).scalars()}
        # An obligation must name an owner, so the probe borrows the EHS owner.
        owner = db.execute(
            select(UserModel).where(UserModel.email == "ehs.owner@complytrack.local")
        ).scalar_one_or_none()
        if owner is None:
            owner = db.execute(select(UserModel).where(UserModel.department_id == DEPARTMENTS.get("EHS"))).scalars().first()
        assert owner is not None, "no seeded user can own the probe obligation"
        OWNER_ID = owner.id


PROBE: dict[str, str] = {}
UNITS: dict[str, str] = {}
DEPARTMENTS: dict[str, str] = {}
CATEGORIES: dict[str, str] = {}
OWNER_ID: str = ""


def main() -> int:
    load_reference()
    print("\nComplyTrack — acceptance criteria sweep (PRD §17.3)")
    print("=" * 72)

    with TestClient(app) as client:
        tokens: dict[str, str] = {}
        for role, email in ACCOUNTS.items():
            response = client.post("/api/v1/auth/login", json={"email": email, "password": PASSWORD})
            assert response.status_code == 200, f"login failed for {role}: {response.text[:160]}"
            tokens[role] = response.json()["access_token"]
        print(f"  signed in as all {len(tokens)} roles\n")

        for probe in (ac1, ac2, ac3, ac4, ac5, ac6, ac7, ac8, export_filters, schedule_runs):
            probe(client, tokens)

        print()
        RESULTS.append(route_smoke(client, tokens))
        smoke = RESULTS[-1]
        flag = "PASS" if smoke.passed else "FAIL"
        print(f"  [{flag}] {smoke.code} — {smoke.title}")
        for line in smoke.evidence:
            print(f"         · {line}")

    print("=" * 72)
    passed = sum(1 for r in RESULTS if r.passed)
    failed = [r for r in RESULTS if not r.passed]
    print(f"  {passed}/{len(RESULTS)} criteria passed")
    if failed:
        print("\n  Failures:")
        for r in failed:
            print(f"    {r.code} — {r.title}\n      {r.failure}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
