"""HTTP tests for the audit trail: search, facets, hash-chain verify and export.

The chain is tamper-evident rather than encrypted, so the interesting cases are
the ones that break a link: an edited value must make ``/audit/verify`` fail and
name the row that no longer matches its own hash.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.domain.dates import IST
from app.models.audit import AuditLog
from app.services import audit
from tests.api.test_items import _master_data
from tests.conftest import login

ADMIN = "admin@complytrack.local"
COMPLIANCE = "compliance@complytrack.local"
DEPARTMENT = "safety.owner@complytrack.local"
AUDITOR = "auditor@complytrack.local"

HEADERS_EXPECTED = {
    "id", "ts_utc", "ts_ist", "entity_type", "entity_id", "action", "field",
    "old_value", "new_value", "changes", "reason", "user_id", "user_email",
    "ip", "user_agent", "hash", "prev_hash",
}


def _rows(db, **filters) -> list[AuditLog]:
    stmt = select(AuditLog)
    for field, value in filters.items():
        stmt = stmt.where(getattr(AuditLog, field) == value)
    return list(db.execute(stmt).scalars().all())


def _trail(client: TestClient, headers, **params) -> dict:
    response = client.get("/api/v1/audit", headers=headers, params=params)
    assert response.status_code == 200
    return response.json()


# --------------------------------------------------------------------------- #
# Reading the trail
# --------------------------------------------------------------------------- #
def test_signing_in_is_recorded(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    payload = _trail(client, headers, entity_type="user", action="login")

    assert payload["total"] == 1
    row = payload["rows"][0]
    assert set(row) == HEADERS_EXPECTED
    assert row["user_email"] == ADMIN
    assert row["reason"] == "Signed in as Administrator."
    assert len(row["hash"]) == 64
    assert int(row["hash"], 16) >= 0
    assert row["prev_hash"] == audit.GENESIS_HASH, "the first entry chains to genesis"
    assert row["ts_ist"].endswith("IST")


def test_the_trail_pages_through_the_entries(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    first = _trail(client, headers, page_size=1)

    assert first["page"] == 1 and first["page_size"] == 1
    assert len(first["rows"]) == 1
    assert first["total"] >= 1

    beyond_the_end = _trail(client, headers, page=99, page_size=1)
    assert beyond_the_end["rows"] == []
    assert beyond_the_end["total"] == first["total"]

    assert client.get("/api/v1/audit", headers=headers, params={"page_size": 501}).status_code == 422
    assert client.get("/api/v1/audit", headers=headers, params={"page": 0}).status_code == 422


def test_the_trail_filters_by_entity_action_and_user(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    item = client.get("/api/v1/items", params={"page_size": 1}, headers=headers).json()["items"][0]
    new_criticality = "Low" if item["criticality"] != "Low" else "Critical"

    changed = client.patch(
        f"/api/v1/items/{item['id']}",
        headers=headers,
        json={"criticality": new_criticality, "reason": "Raised after the annual audit."},
    )
    assert changed.status_code == 200

    updates = _trail(client, headers, entity_type="compliance_item", action="update")
    assert updates["total"] == 1
    row = updates["rows"][0]
    assert row["entity_id"] == item["id"]
    assert row["reason"] == "Raised after the annual audit."
    assert row["field"] is None, "a patch is recorded as a field-level diff"
    assert row["changes"]["criticality"] == {"old": item["criticality"], "new": new_criticality}

    me = client.get("/api/v1/auth/me", headers=headers).json()
    assert _trail(client, headers, user_id=me["id"])["total"] == 2

    assert _trail(client, headers, entity_id=item["id"])["total"] == 1
    assert _trail(client, headers, entity_type="nothing_like_this")["total"] == 0


def test_the_trail_searches_reasons_and_users(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    item = client.get("/api/v1/items", params={"page_size": 1}, headers=headers).json()["items"][0]
    client.patch(
        f"/api/v1/items/{item['id']}",
        headers=headers,
        json={"criticality": "High", "reason": "Raised after the annual audit."},
    )

    assert _trail(client, headers, search="annual audit")["total"] == 1
    assert _trail(client, headers, search="ANNUAL")["total"] == 1, "search is case-insensitive"
    assert _trail(client, headers, search=ADMIN)["total"] == 2
    assert _trail(client, headers, search="no-such-word-anywhere")["total"] == 0


def test_the_trail_filters_by_period(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    entry = _trail(client, headers)["rows"][0]

    # A day on this screen is an IST day — the one the entry is rendered with —
    # so that is the day to filter by, not the UTC date underneath it.
    stored_day = datetime.fromisoformat(entry["ts_utc"]).astimezone(IST).date().isoformat()

    within = _trail(client, headers, period_from=stored_day, period_to=stored_day)
    assert within["total"] >= 1
    assert all(
        datetime.fromisoformat(row["ts_utc"]).astimezone(IST).date().isoformat() == stored_day
        for row in within["rows"]
    )

    # A window that ends the day before the entry holds nothing.
    earlier = _trail(client, headers, period_from="2000-01-01", period_to="2000-01-02")
    assert earlier["total"] == 0


def test_the_day_filter_means_an_ist_day(demo, client: TestClient) -> None:
    """A day in the trail is an IST day, the same day the entry is rendered in.

    The window used to be built from bare midnights against a UTC column, which
    is 05:30-to-05:30 IST: an entry logged at 02:00 IST fell out of its own day
    and into the day before. An auditor filtering for the day they can see on
    the screen would not find the entry.
    """
    headers = login(client, ADMIN)

    # 2026-03-10 02:00 IST == 2026-03-09 20:30 UTC — before the IST day starts,
    # after the UTC one did. Written through the service so the entry carries
    # the same rendered IST stamp, and the same chain, as any other.
    entry = audit.write_audit(
        demo,
        entity_type="compliance_item",
        entity_id="pinned-for-the-day-filter",
        action="update",
        user_id="someone",
        user_email="someone@complytrack.local",
        ts=datetime(2026, 3, 9, 20, 30, tzinfo=timezone.utc),
        commit=True,
    )
    assert entry.ts_ist.startswith("10-Mar-2026")

    that_day = _trail(client, headers, period_from="2026-03-10", period_to="2026-03-10")
    assert any(row["id"] == entry.id for row in that_day["rows"]), (
        "an entry made at 02:00 IST should be inside that IST day"
    )

    day_before = _trail(client, headers, period_from="2026-03-09", period_to="2026-03-09")
    assert not any(row["id"] == entry.id for row in day_before["rows"])


def test_the_facets_describe_what_is_on_file(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    item = client.get("/api/v1/items", params={"page_size": 1}, headers=headers).json()["items"][0]
    client.patch(
        f"/api/v1/items/{item['id']}", headers=headers,
        json={"criticality": "High", "reason": "Raised after the annual audit."},
    )

    facets = client.get("/api/v1/audit/facets", headers=headers).json()
    entities = {row["value"]: row["count"] for row in facets["entity_types"]}
    actions = {row["value"]: row["count"] for row in facets["actions"]}

    assert entities == {"user": 1, "compliance_item": 1}
    assert actions == {"login": 1, "update": 1}
    assert sum(entities.values()) == _trail(client, headers, page_size=500)["total"]


# --------------------------------------------------------------------------- #
# Verification (AT-03)
# --------------------------------------------------------------------------- #
def test_the_chain_verifies_intact_after_normal_work(demo, client: TestClient) -> None:
    admin, compliance = login(client, ADMIN), login(client, COMPLIANCE)
    master = _master_data(demo)
    template = client.get(
        "/api/v1/items", params={"page_size": 1}, headers=admin
    ).json()["items"][0]

    created = client.post(
        "/api/v1/items",
        headers=admin,
        json={
            "name": "Pressure vessel test certificate",
            "item_type": template["type"],
            "unit_id": master["unit_id"],
            "department_id": master["department_id"],
            "category_id": master["category_id"],
            "authority_id": master["authority_id"],
            "owner_id": master["owner_id"],
            "issue_date": "2026-01-01",
            "validity_value": 12,
            "reference_number": "PES/TEST/2026/1",
        },
    )
    assert created.status_code == 201, created.text
    item = created.json()

    patched = client.patch(
        f"/api/v1/items/{item['id']}",
        headers=admin,
        json={"criticality": "High", "reason": "Raised after the annual audit."},
    )
    assert patched.status_code == 200

    # Every action above wrote a link; the walk must still reach the tip.
    trail = _trail(client, compliance, page_size=500)
    verified = client.get("/api/v1/audit/verify", headers=compliance).json()
    assert verified["intact"] is True
    assert verified["entries"] == trail["total"] >= 3
    assert len(verified["head"]) == 64
    assert verified["head"] == audit.last_hash(demo)

    # The head is the entry nobody claims as their predecessor.
    claimed = {row["prev_hash"] for row in trail["rows"]}
    heads = [row["hash"] for row in trail["rows"] if row["hash"] not in claimed]
    assert verified["head"] in heads


def test_an_untouched_empty_log_is_intact(db) -> None:
    assert audit.verify_chain(db) == {
        "intact": True,
        "entries": 0,
        "head": audit.GENESIS_HASH,
        "verified_at": audit.verify_chain(db)["verified_at"],
    }


def test_editing_a_stored_entry_breaks_verification(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    item = client.get("/api/v1/items", params={"page_size": 1}, headers=headers).json()["items"][0]
    client.patch(
        f"/api/v1/items/{item['id']}", headers=headers,
        json={"criticality": "High", "reason": "Raised after the annual audit."},
    )

    tampered = _rows(demo, action="update")[0]
    tampered.new_value = '{"criticality": "Low"}'
    demo.commit()
    demo.expire_all()

    verified = client.get("/api/v1/audit/verify", headers=headers).json()
    assert verified["intact"] is False
    assert verified["broken_at"] == tampered.id
    assert verified["reason"] == "entry hash mismatch"

    # The trail still reads back, but the export flags the break honestly.
    export = client.get("/api/v1/audit/export", headers=headers, params={"fmt": "xlsx"})
    from openpyxl import load_workbook

    meta = load_workbook(io.BytesIO(export.content))["Metadata"]
    assert meta.cell(row=4, column=1).value == "Chain intact"
    assert meta.cell(row=4, column=2).value is False


def test_the_trail_cannot_be_rewritten_over_http(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    entry_id = _trail(client, headers)["rows"][0]["id"]

    for method in ("PATCH", "PUT", "DELETE", "POST"):
        response = client.request(method, f"/api/v1/audit/{entry_id}", headers=headers, json={})
        assert response.status_code in (404, 405), f"{method} must not reach the log"
    assert _trail(client, headers)["total"] == len(_rows(demo))


# --------------------------------------------------------------------------- #
# Export (AT-04)
# --------------------------------------------------------------------------- #
def test_the_csv_export_is_excel_ready_and_complete(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    trail = _trail(client, headers, page_size=500)
    export = client.get("/api/v1/audit/export", headers=headers, params={"fmt": "csv"})

    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")
    assert export.headers["content-disposition"] == 'attachment; filename="Audit_Trail.csv"'
    assert export.content.startswith(b"\xef\xbb\xbf")

    rows = list(csv.reader(io.StringIO(export.content.decode("utf-8-sig"))))
    assert rows[0][:4] == ["Timestamp (IST)", "Entity", "Entity ID", "Action"]
    assert len(rows) == trail["total"] + 1
    assert any(ADMIN in row for row in rows[1:])


def test_the_excel_export_is_the_default_and_carries_the_chain_state(
    demo, client: TestClient
) -> None:
    headers = login(client, ADMIN)
    trail = _trail(client, headers, page_size=500)
    export = client.get("/api/v1/audit/export", headers=headers)

    assert export.status_code == 200
    assert export.headers["content-disposition"] == 'attachment; filename="Audit_Trail.xlsx"'
    assert export.content.startswith(b"PK\x03\x04")

    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(export.content))
    assert workbook.sheetnames == ["Audit Trail", "Metadata"]
    assert workbook["Audit Trail"].max_row == trail["total"] + 1
    assert workbook["Audit Trail"].cell(row=1, column=1).value == "Timestamp (IST)"

    meta = {row[0]: row[1] for row in workbook["Metadata"].iter_rows(values_only=True)}
    assert meta["Rows"] == trail["total"]
    assert meta["Exported by"] == ADMIN
    assert meta["Chain intact"] is True


def test_an_unsupported_export_format_is_a_validation_error(demo, client: TestClient) -> None:
    assert client.get(
        "/api/v1/audit/export", headers=login(client, ADMIN), params={"fmt": "pdf"}
    ).status_code == 422


# --------------------------------------------------------------------------- #
# Access (PRD Section 9)
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("email", [ADMIN, COMPLIANCE])
def test_the_trail_is_open_to_the_oversight_roles(
    demo, client: TestClient, email: str
) -> None:
    headers = login(client, email)
    assert client.get("/api/v1/audit", headers=headers).status_code == 200
    assert client.get("/api/v1/audit/facets", headers=headers).status_code == 200
    assert client.get("/api/v1/audit/verify", headers=headers).status_code == 200
    assert client.get("/api/v1/audit/export", headers=headers).status_code == 200


@pytest.mark.parametrize("email", [DEPARTMENT, AUDITOR])
def test_a_scoped_role_cannot_read_the_whole_trail(
    demo, client: TestClient, email: str
) -> None:
    """Department Users see their own rows; Auditors only what a link shares."""
    headers = login(client, email)
    for path in ("/api/v1/audit", "/api/v1/audit/facets", "/api/v1/audit/verify",
                 "/api/v1/audit/export"):
        response = client.get(path, headers=headers)
        assert response.status_code == 403
        assert "does not permit" in response.json()["detail"]
