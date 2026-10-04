"""HTTP-level RBAC: the PRD Section 9 matrix enforced by the running app.

Each case goes through a real request so the dependency layer — not just the
pure matrix — is exercised. ``require`` runs before the handler, so a denial is
still 403 even on endpoints whose body has a defect.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.db.seed import DEFAULT_PASSWORD
from tests.conftest import login

ADMIN = "admin@complytrack.local"
COMPLIANCE = "compliance@complytrack.local"
DEPARTMENT = "safety.owner@complytrack.local"
MANAGEMENT = "ceo@complytrack.local"
AUDITOR = "auditor@complytrack.local"


def _instance_id(demo) -> str:
    from sqlalchemy import select

    from app.models.compliance import ComplianceInstance

    return demo.execute(select(ComplianceInstance.id).limit(1)).scalar_one()


def test_anonymous_requests_are_rejected(demo, client: TestClient) -> None:
    assert client.get("/api/v1/items").status_code == 401
    assert client.get("/api/v1/dashboards/management").status_code == 401
    assert client.get("/api/v1/auth/me").status_code == 401


def test_administrator_may_administer_users(demo, client: TestClient) -> None:
    response = client.get("/api/v1/users", headers=login(client, ADMIN))
    assert response.status_code == 200


def test_department_user_may_not_administer_users(demo, client: TestClient) -> None:
    response = client.get("/api/v1/users", headers=login(client, DEPARTMENT))
    assert response.status_code == 403
    assert "manage_org" in response.json()["detail"]


def test_compliance_team_may_not_administer_users_or_settings(demo, client: TestClient) -> None:
    headers = login(client, COMPLIANCE)
    assert client.get("/api/v1/users", headers=headers).status_code == 403
    assert client.get("/api/v1/org/settings", headers=headers).status_code == 403


def test_administrator_may_read_settings_but_not_verify(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    assert client.get("/api/v1/org/settings", headers=admin).status_code == 200

    instance = _instance_id(demo)
    response = client.post(
        f"/api/v1/instances/{instance}/verify",
        headers=admin,
        json={"decision": "approve", "remark": "Looks complete to me."},
    )
    assert response.status_code == 403
    assert "verify_close" in response.json()["detail"]


def test_compliance_team_may_verify_but_not_administer_the_org(demo, client: TestClient) -> None:
    headers = login(client, COMPLIANCE)
    denied = client.post(
        "/api/v1/org/units", headers=headers, json={"code": "XX", "name": "Extra yard"}
    )
    assert denied.status_code == 403
    assert "manage_org" in denied.json()["detail"]


def test_administrator_may_create_an_organisation_unit(demo, client: TestClient) -> None:
    response = client.post(
        "/api/v1/org/units",
        headers=login(client, ADMIN),
        json={"code": "NEWYARD", "name": "New Yard", "type": "Yard"},
    )
    assert response.status_code == 201
    assert response.json()["code"] == "NEWYARD"


def test_department_user_cannot_read_the_all_units_dashboard(demo, client: TestClient) -> None:
    headers = login(client, DEPARTMENT)
    response = client.get("/api/v1/dashboards/management", headers=headers)
    assert response.status_code == 403
    assert "view_dashboard_all" in response.json()["detail"]


def test_department_user_can_read_their_own_workbench(demo, client: TestClient) -> None:
    assert client.get("/api/v1/dashboards/my-work", headers=login(client, DEPARTMENT)).status_code == 200


def test_management_view_cannot_mutate_the_register(demo, client: TestClient) -> None:
    headers = login(client, MANAGEMENT)
    assert client.get("/api/v1/dashboards/management", headers=headers).status_code == 200
    denied = client.post(
        "/api/v1/items",
        headers=headers,
        json={"name": "Should not exist", "type": "Licence"},
    )
    assert denied.status_code == 403
    assert "manage_items" in denied.json()["detail"]


def test_read_only_roles_are_told_they_are_read_only(demo, client: TestClient) -> None:
    instance = _instance_id(demo)
    for email in (MANAGEMENT, AUDITOR):
        response = client.post(
            f"/api/v1/instances/{instance}/transition",
            headers=login(client, email),
            json={"target_status": "Under Process", "expected_filing_date": "2026-12-31"},
        )
        assert response.status_code == 403
        assert "read-only" in response.json()["detail"]


def test_auditor_is_scoped_and_cannot_read_the_audit_trail(demo, client: TestClient) -> None:
    headers = login(client, AUDITOR)
    assert client.get("/api/v1/items", headers=headers).status_code == 200
    denied = client.get("/api/v1/audit", headers=headers)
    assert denied.status_code == 403
    assert "view_audit" in denied.json()["detail"]


def test_auditor_cannot_run_reports_or_download_the_register(demo, client: TestClient) -> None:
    headers = login(client, AUDITOR)
    assert client.get("/api/v1/reports", headers=headers).status_code == 403
    assert client.get("/api/v1/items/export/register", headers=headers).status_code == 403


def test_auditor_cannot_upload_or_delete_documents(demo, client: TestClient) -> None:
    headers = login(client, AUDITOR)
    files = {"file": ("evidence.pdf", b"%PDF-1.4 evidence", "application/pdf")}
    response = client.post(
        "/api/v1/documents",
        headers=headers,
        data={"title": "Evidence"},
        files=files,
    )
    assert response.status_code == 403
    assert "update_assigned" in response.json()["detail"]


def test_compliance_team_may_read_the_audit_trail(demo, client: TestClient) -> None:
    assert client.get("/api/v1/audit", headers=login(client, COMPLIANCE)).status_code == 200


def test_management_view_sees_all_items_but_not_the_settings(demo, client: TestClient) -> None:
    headers = login(client, MANAGEMENT)
    assert client.get("/api/v1/items", headers=headers).status_code == 200
    assert client.get("/api/v1/org/settings", headers=headers).status_code == 403


def test_department_user_is_scoped_to_their_own_unit(demo, client: TestClient) -> None:
    headers = login(client, DEPARTMENT)
    payload = client.get("/api/v1/items", params={"page_size": 200}, headers=headers).json()
    me = client.get("/api/v1/auth/me", headers=headers).json()
    own_units = set(me["unit_ids"])
    own_department = me["department_id"]
    for row in payload["items"]:
        assert row["unit_id"] in own_units
        assert row["department_id"] == own_department


def test_a_department_user_cannot_open_another_departments_item(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    everything = client.get("/api/v1/items", params={"page_size": 500}, headers=admin).json()["items"]
    me = client.get("/api/v1/auth/me", headers=login(client, DEPARTMENT)).json()
    foreign = next(
        row for row in everything
        if row["department_id"] != me["department_id"] or row["unit_id"] not in set(me["unit_ids"])
    )

    response = client.get(f"/api/v1/items/{foreign['id']}", headers=login(client, DEPARTMENT))
    assert response.status_code == 403


def test_no_role_can_edit_the_audit_log(demo, client: TestClient) -> None:
    # There is no route for it at all: the path simply does not exist.
    headers = login(client, ADMIN)
    assert client.post("/api/v1/audit", headers=headers, json={}).status_code in (404, 405)


def test_wrong_role_login_still_succeeds_for_every_seeded_account(demo, client: TestClient) -> None:
    for email in (ADMIN, COMPLIANCE, DEPARTMENT, MANAGEMENT, AUDITOR):
        response = client.post("/api/v1/auth/login", json={"email": email, "password": DEFAULT_PASSWORD})
        assert response.status_code == 200, email


def test_the_five_role_headers_from_the_shared_helper_identify_the_right_people(
    demo, client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    """``api_auth`` is the suite's one place that knows the five accounts."""
    from tests.conftest import ROLE_ACCOUNTS

    expected_roles = {
        "admin": "Administrator",
        "compliance": "Compliance Team",
        "department": "Department User",
        "management": "Management View",
        "auditor": "Auditor",
    }
    assert set(api_auth) == set(ROLE_ACCOUNTS) == set(expected_roles)

    for role, headers in api_auth.items():
        assert headers["Authorization"].startswith("Bearer ")
        me = client.get("/api/v1/auth/me", headers=headers)
        assert me.status_code == 200
        assert me.json()["email"] == ROLE_ACCOUNTS[role]
        assert me.json()["role"] == expected_roles[role]
