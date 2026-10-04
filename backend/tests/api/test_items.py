"""HTTP tests for the compliance register: search, CRUD, bulk actions, import/export."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.auth import User
from app.models.compliance import ComplianceItem
from app.models.org import Category, Department, IssuingAuthority, OrganisationUnit
from tests.conftest import login

ADMIN = "admin@complytrack.local"
OWNER = "safety.owner@complytrack.local"

XLSX_MAGIC = b"PK\x03\x04"


def _admin(client: TestClient) -> dict[str, str]:
    return login(client, ADMIN)


def _master_data(demo) -> dict[str, str]:
    """Names/ids of seeded master data, so tests never hard-code seed values."""
    unit = demo.execute(select(OrganisationUnit).limit(1)).scalar_one()
    department = demo.execute(
        select(Department).where(
            (Department.unit_id == unit.id) | (Department.unit_id.is_(None))
        ).limit(1)
    ).scalar_one()
    category = demo.execute(select(Category).limit(1)).scalar_one()
    authority = demo.execute(select(IssuingAuthority).limit(1)).scalar_one()
    owner = demo.execute(select(User).where(User.email == OWNER)).scalar_one()
    return {
        "unit_id": unit.id, "unit_name": unit.name,
        "department_id": department.id, "department_name": department.name,
        "category_id": category.id, "category_name": category.name,
        "authority_id": authority.id, "authority_name": authority.name,
        "owner_id": owner.id, "owner_email": owner.email,
    }


def _all_rows(client: TestClient, headers, **params) -> list[dict]:
    payload = client.get(
        "/api/v1/items", params={"page_size": 500, "include_archived": False, **params},
        headers=headers,
    ).json()
    return payload["items"]


# --------------------------------------------------------------------------- #
# Listing and filters (CD-07)
# --------------------------------------------------------------------------- #
def test_the_demo_register_lists_eighty_items(demo, client: TestClient) -> None:
    payload = client.get("/api/v1/items", params={"page_size": 500}, headers=_admin(client)).json()
    assert payload["total"] == 80
    assert len(payload["items"]) == 80
    assert payload["page"] == 1
    assert payload["pages"] == 1


def test_pagination_splits_the_register(demo, client: TestClient) -> None:
    headers = _admin(client)
    first = client.get("/api/v1/items", params={"page": 1, "page_size": 25}, headers=headers).json()
    second = client.get("/api/v1/items", params={"page": 2, "page_size": 25}, headers=headers).json()
    assert len(first["items"]) == 25
    assert len(second["items"]) == 25
    assert {r["id"] for r in first["items"]} & {r["id"] for r in second["items"]} == set()
    assert first["pages"] == 4


def test_page_size_is_bounded(demo, client: TestClient) -> None:
    assert client.get("/api/v1/items", params={"page_size": 1000}, headers=_admin(client)).status_code == 422


@pytest.mark.parametrize("field", ["unit_id", "department_id", "category_id", "criticality"])
def test_each_register_filter_is_applied(demo, client: TestClient, field: str) -> None:
    headers = _admin(client)
    value = _all_rows(client, headers)[0][field]
    rows = _all_rows(client, headers, **{field: value})
    assert rows, f"no rows returned for {field}={value}"
    assert all(row[field] == value for row in rows)


def test_search_narrows_the_register_to_matching_rows(demo, client: TestClient) -> None:
    headers = _admin(client)
    everything = _all_rows(client, headers)
    sample = everything[0]
    needle = sample["name"].split()[0]

    rows = _all_rows(client, headers, search=needle)
    assert sample["id"] in {row["id"] for row in rows}
    assert 0 < len(rows) < len(everything)
    assert {row["id"] for row in rows} <= {row["id"] for row in everything}


def test_search_is_case_insensitive(demo, client: TestClient) -> None:
    headers = _admin(client)
    sample = _all_rows(client, headers)[0]
    needle = sample["name"].split()[0]

    lower = {row["id"] for row in _all_rows(client, headers, search=needle.lower())}
    upper = {row["id"] for row in _all_rows(client, headers, search=needle.upper())}
    assert sample["id"] in lower
    assert lower == upper


def test_search_returns_nothing_for_an_unknown_term(demo, client: TestClient) -> None:
    rows = _all_rows(client, _admin(client), search="zzz-no-such-obligation-zzz")
    assert rows == []


def test_filter_by_workflow_status(demo, client: TestClient) -> None:
    headers = _admin(client)
    statuses = [r["current_instance"]["status"] for r in _all_rows(client, headers)
                if r.get("current_instance")]
    target = max(set(statuses), key=statuses.count)

    rows = _all_rows(client, headers, status=target)
    assert rows
    assert all(row["current_instance"]["status"] == target for row in rows)


def test_expiring_before_and_after_narrow_the_register(demo, client: TestClient) -> None:
    headers = _admin(client)
    rows = _all_rows(client, headers, expiring_before="2026-12-31")
    assert rows
    assert all(row["expiry_date"] is not None and row["expiry_date"] <= "2026-12-31" for row in rows)


def test_sorting_by_expiry_date_descends(demo, client: TestClient) -> None:
    headers = _admin(client)
    rows = _all_rows(client, headers, sort="expiry_date", direction="desc")
    dates = [row["expiry_date"] for row in rows if row["expiry_date"]]
    assert dates == sorted(dates, reverse=True)


def test_get_one_item_includes_its_cycles(demo, client: TestClient) -> None:
    headers = _admin(client)
    row = _all_rows(client, headers)[0]
    response = client.get(f"/api/v1/items/{row['id']}", headers=headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == row["id"]
    assert payload["item_code"] == row["item_code"]
    assert isinstance(payload["instances"], list) and payload["instances"]


def test_an_unknown_item_is_a_404(demo, client: TestClient) -> None:
    assert client.get("/api/v1/items/does-not-exist", headers=_admin(client)).status_code == 404


def test_status_options_describe_every_workflow_state(demo, client: TestClient) -> None:
    payload = client.get("/api/v1/items/status-options", headers=_admin(client)).json()
    assert "Pending" in payload["statuses"]
    assert payload["transitions"]["Pending"][0]["target"] == "Under Process"


def test_saved_views_are_offered(demo, client: TestClient) -> None:
    views = client.get("/api/v1/items/saved-views", headers=_admin(client)).json()
    assert {"key", "name", "columns"} <= set(views[0])


# --------------------------------------------------------------------------- #
# Create / update
# --------------------------------------------------------------------------- #
def _new_item_payload(master: dict[str, str], **overrides) -> dict:
    payload = {
        "name": "Boiler Inspection Certificate",
        "type": "Licence",
        "unit_id": master["unit_id"],
        "department_id": master["department_id"],
        "category_id": master["category_id"],
        "authority_id": master["authority_id"],
        "owner_id": master["owner_id"],
        "issue_date": "2026-04-01",
        "validity_value": 12,
        "validity_unit": "months",
        "criticality": "High",
        "reference_number": "TEST/2026/0001",
    }
    payload.update(overrides)
    return payload


def test_create_an_item_generates_a_code_and_a_first_cycle(demo, client: TestClient) -> None:
    master = _master_data(demo)
    response = client.post("/api/v1/items", headers=_admin(client), json=_new_item_payload(master))
    assert response.status_code == 201
    payload = response.json()
    assert payload["item_code"].startswith(f"{master['category_name'][:3].upper()}-")
    assert payload["name"] == "Boiler Inspection Certificate"
    # A period is inclusive of its first day (AC-1): issued 01-Apr-2026 for
    # 12 months, it is in force through 31-Mar-2027. RT-02 then opens the renewal
    # ``authority_processing_days`` (15) before expiry and prep work
    # ``internal_prep_days`` (15) before that.
    assert payload["expiry_date"] == "2027-03-31"
    assert payload["renewal_due_date"] == "2027-03-16"
    assert payload["internal_target_date"] == "2027-03-01"

    detail = client.get(f"/api/v1/items/{payload['id']}", headers=_admin(client)).json()
    assert detail["current_instance"]["status"] == "Pending"


def test_create_requires_the_mandatory_fields(demo, client: TestClient) -> None:
    response = client.post("/api/v1/items", headers=_admin(client), json={"name": "Nameless", "type": "Licence"})
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "Unit / Location is required." in detail
    assert "A named owner is required for every obligation." in detail


def test_create_rejects_a_licence_without_dates(demo, client: TestClient) -> None:
    master = _master_data(demo)
    payload = _new_item_payload(master)
    payload.pop("issue_date")
    payload.pop("validity_value")
    response = client.post("/api/v1/items", headers=_admin(client), json=payload)
    assert response.status_code == 400
    assert "issue date or an expiry date" in response.json()["detail"]


def test_a_duplicate_reference_is_a_conflict(demo, client: TestClient) -> None:
    master = _master_data(demo)
    payload = _new_item_payload(master, reference_number="DUPLICATE/001")
    headers = _admin(client)
    assert client.post("/api/v1/items", headers=headers, json=payload).status_code == 201

    again = client.post("/api/v1/items", headers=headers, json={**payload, "name": "Another name"})
    assert again.status_code == 409
    assert "already exists" in again.json()["detail"]


def test_patch_a_harmless_field_without_a_reason(demo, client: TestClient) -> None:
    headers = _admin(client)
    row = _all_rows(client, headers)[0]
    response = client.patch(
        f"/api/v1/items/{row['id']}", headers=headers, json={"remarks": "Chased the authority today."}
    )
    assert response.status_code == 200
    assert client.get(f"/api/v1/items/{row['id']}", headers=headers).json()["remarks"] == (
        "Chased the authority today."
    )


def test_patch_a_sensitive_field_needs_a_reason(demo, client: TestClient) -> None:
    headers = _admin(client)
    row = _all_rows(client, headers)[0]
    denied = client.patch(f"/api/v1/items/{row['id']}", headers=headers, json={"criticality": "Critical"})
    assert denied.status_code == 400
    assert "A reason is mandatory" in denied.json()["detail"]

    allowed = client.patch(
        f"/api/v1/items/{row['id']}",
        headers=headers,
        json={"criticality": "Critical", "reason": "Management escalated this obligation."},
    )
    assert allowed.status_code == 200
    assert allowed.json()["criticality"] == "Critical"


def test_patch_validates_the_payload(demo, client: TestClient) -> None:
    headers = _admin(client)
    row = _all_rows(client, headers)[0]
    assert client.patch(
        f"/api/v1/items/{row['id']}", headers=headers, json={"not_a_field": 1}
    ).status_code == 422


def test_every_edit_is_audited_with_a_reason(demo, client: TestClient) -> None:
    from app.models.audit import AuditLog

    headers = _admin(client)
    row = _all_rows(client, headers)[0]
    client.patch(
        f"/api/v1/items/{row['id']}",
        headers=headers,
        json={"owner_id": row["owner_id"], "reason": "Owner confirmed in the review meeting."},
    )
    entry = demo.execute(
        select(AuditLog).where(
            AuditLog.entity_id == row["id"], AuditLog.action == "update"
        ).order_by(AuditLog.ts_utc.desc())
    ).scalars().first()
    assert entry is not None
    assert entry.reason == "Owner confirmed in the review meeting."


# --------------------------------------------------------------------------- #
# Archive / restore (CD-08)
# --------------------------------------------------------------------------- #
def test_archive_hides_the_item_and_restore_brings_it_back(demo, client: TestClient) -> None:
    headers = _admin(client)
    row = _all_rows(client, headers)[0]

    archived = client.post(
        f"/api/v1/items/{row['id']}/archive",
        headers=headers,
        json={"reason": "This press was sold in March."},
    )
    assert archived.status_code == 200
    assert archived.json()["ok"] is True

    assert row["id"] not in {r["id"] for r in _all_rows(client, headers)}
    assert row["id"] in {
        r["id"] for r in _all_rows(client, headers, include_archived=True)
    }

    restored = client.post(
        f"/api/v1/items/{row['id']}/restore",
        headers=headers,
        json={"reason": "Archive was raised in error."},
    )
    assert restored.status_code == 200
    assert row["id"] in {r["id"] for r in _all_rows(client, headers)}


def test_archive_requires_a_reason(demo, client: TestClient) -> None:
    headers = _admin(client)
    row = _all_rows(client, headers)[0]
    response = client.post(f"/api/v1/items/{row['id']}/archive", headers=headers, json={"reason": ""})
    assert response.status_code == 422


def test_an_archived_item_can_no_longer_be_read(demo, client: TestClient) -> None:
    headers = _admin(client)
    row = _all_rows(client, headers)[0]
    client.post(
        f"/api/v1/items/{row['id']}/archive", headers=headers, json={"reason": "Sold the press."}
    )
    assert client.get(f"/api/v1/items/{row['id']}", headers=headers).status_code == 404


# --------------------------------------------------------------------------- #
# Bulk actions (OW-02)
# --------------------------------------------------------------------------- #
def test_bulk_reassign_moves_several_items(demo, client: TestClient) -> None:
    headers = _admin(client)
    rows = _all_rows(client, headers)[:3]
    compliance_team = demo.execute(
        select(User).where(User.email == "compliance@complytrack.local")
    ).scalar_one()

    response = client.post(
        "/api/v1/items/bulk/reassign",
        headers=headers,
        json={
            "item_ids": [r["id"] for r in rows],
            "owner_id": compliance_team.id,
            "reason": "Consolidating ownership with the Compliance Team.",
        },
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 3

    demo.expire_all()
    for row in rows:
        item = demo.get(ComplianceItem, row["id"])
        assert item.owner_id == compliance_team.id


def test_bulk_reassign_needs_a_selection(demo, client: TestClient) -> None:
    response = client.post(
        "/api/v1/items/bulk/reassign",
        headers=_admin(client),
        json={"item_ids": [], "reason": "Nothing selected on purpose."},
    )
    assert response.status_code == 400


def test_bulk_edit_sets_criticality(demo, client: TestClient) -> None:
    headers = _admin(client)
    rows = _all_rows(client, headers)[:2]
    response = client.post(
        "/api/v1/items/bulk/edit",
        headers=headers,
        json={
            "item_ids": [r["id"] for r in rows],
            "set_criticality": "Critical",
            "reason": "Board review reclassified these obligations.",
        },
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 2


# --------------------------------------------------------------------------- #
# Import / export (Section 12)
# --------------------------------------------------------------------------- #
COLUMNS = [
    "Unit", "Department", "Category", "Item Name", "Type", "Authority", "Reference No.",
    "Issue Date", "Validity (value)", "Validity (unit)", "Expiry Date", "Owner Email",
    "Criticality", "Recurrence",
]


def _csv_rows(master: dict[str, str], *references_and_owners: tuple[str, str]) -> bytes:
    """A well-formed import file, one row per ``(reference, owner email)`` pair."""
    import csv
    import io

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS)
    writer.writeheader()
    for reference, owner_email in references_and_owners:
        writer.writerow({
            "Unit": master["unit_name"],
            "Department": master["department_name"],
            "Category": master["category_name"],
            "Item Name": "Imported Licence",
            "Type": "Licence",
            "Authority": master["authority_name"],
            "Reference No.": reference,
            "Issue Date": "01-04-2026",
            "Validity (value)": 12,
            "Validity (unit)": "months",
            "Expiry Date": "",
            "Owner Email": owner_email,
            "Criticality": "High",
            "Recurrence": "annual",
        })
    return buffer.getvalue().encode("utf-8")


def test_import_preview_reports_rows_and_errors(demo, client: TestClient) -> None:
    master = _master_data(demo)
    body = _csv_rows(
        master,
        ("IMP/2026/0001", master["owner_email"]),
        ("IMP/2026/0002", "ghost@nowhere.local"),
    )

    response = client.post(
        "/api/v1/items/import/preview",
        headers=_admin(client),
        files={"file": ("import.csv", body, "text/csv")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total_rows"] == 2
    assert payload["valid_rows"] == 1
    assert len(payload["errors"]) == 1
    assert payload["errors"][0]["row"] == 3
    assert "ghost@nowhere.local" in payload["errors"][0]["message"]
    assert len(payload["preview"]) == 1
    assert payload["preview"][0]["reference_number"] == "IMP/2026/0001"


def test_import_commit_creates_the_valid_rows(demo, client: TestClient) -> None:
    master = _master_data(demo)
    headers = _admin(client)
    body = _csv_rows(master, ("IMP/2026/0003", master["owner_email"]))

    committed = client.post(
        "/api/v1/items/import/commit",
        headers=headers,
        files={"file": ("import.csv", body, "text/csv")},
    )
    assert committed.status_code == 200
    assert committed.json()["created"] == 1

    assert any(row["reference_number"] == "IMP/2026/0003" for row in _all_rows(client, headers))


def test_import_commit_refuses_a_file_with_any_bad_row(demo, client: TestClient) -> None:
    master = _master_data(demo)
    headers = _admin(client)
    body = _csv_rows(
        master,
        ("IMP/2026/0004", master["owner_email"]),
        ("IMP/2026/0005", "ghost@nowhere.local"),
    )

    committed = client.post(
        "/api/v1/items/import/commit",
        headers=headers,
        files={"file": ("import.csv", body, "text/csv")},
    )
    assert committed.status_code == 200
    payload = committed.json()
    assert payload["created"] == 0
    assert payload["skipped"] == 2

    references = {row["reference_number"] for row in _all_rows(client, headers)}
    assert "IMP/2026/0004" not in references


def test_import_rejects_a_file_without_the_required_columns(demo, client: TestClient) -> None:
    response = client.post(
        "/api/v1/items/import/preview",
        headers=_admin(client),
        files={"file": ("import.csv", b"Foo,Bar\n1,2\n", "text/csv")},
    )
    assert response.status_code == 400
    assert "Missing required column" in response.json()["detail"]


def test_import_template_and_register_export_are_excel_files(demo, client: TestClient) -> None:
    headers = _admin(client)

    template = client.get("/api/v1/items/export/template", headers=headers)
    assert template.status_code == 200
    assert template.content.startswith(XLSX_MAGIC)

    register = client.get("/api/v1/items/export/register", headers=headers)
    assert register.status_code == 200
    assert register.content.startswith(XLSX_MAGIC)
    assert "attachment" in register.headers["content-disposition"]


def test_import_is_refused_for_a_read_only_role(demo, client: TestClient) -> None:
    response = client.post(
        "/api/v1/items/import/preview",
        headers=login(client, "ceo@complytrack.local"),
        files={"file": ("import.csv", b"Unit,Item Name,Owner Email,Type\n", "text/csv")},
    )
    assert response.status_code == 403
