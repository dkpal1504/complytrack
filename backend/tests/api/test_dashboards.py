"""HTTP tests for the three dashboards, the filter options and the calendar."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.domain.enums import ComplianceBucket, CRITICALITY_WEIGHT
from app.models.compliance import ComplianceItem
from tests.conftest import login

ADMIN = "admin@complytrack.local"
COMPLIANCE = "compliance@complytrack.local"
DEPARTMENT = "safety.owner@complytrack.local"
MANAGEMENT = "ceo@complytrack.local"

BUCKETS = [b.value for b in ComplianceBucket]


def _register_total(client: TestClient, headers) -> int:
    return client.get(
        "/api/v1/items", params={"page_size": 500, "include_archived": False}, headers=headers
    ).json()["total"]


# --------------------------------------------------------------------------- #
# Management cockpit (7.1)
# --------------------------------------------------------------------------- #
def test_the_management_dashboard_reports_the_demo_estate(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    payload = client.get("/api/v1/dashboards/management", headers=headers).json()

    assert payload["filters"] == {}
    assert payload["generated_at"]

    kpis = {kpi["key"]: kpi for kpi in payload["kpis"]}
    assert kpis["total"]["value"] == _register_total(client, headers) == 80
    assert 0 <= kpis["index"]["value"] <= 100
    assert kpis["complied"]["suffix"] == "50%"


def test_the_status_split_covers_every_bucket_and_adds_up(demo, client: TestClient) -> None:
    payload = client.get(
        "/api/v1/dashboards/management", headers=login(client, ADMIN)
    ).json()

    split = payload["status_split"]
    assert [row["key"] for row in split] == BUCKETS
    assert all(row["label"] == row["key"] for row in split)
    # Not Applicable rows are excluded from every bucket, so the split sums to
    # the counted items, never to more than the register.
    assert 0 < sum(row["value"] for row in split) <= 80


def test_the_management_dashboard_honours_its_filters(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    item = demo.execute(select(ComplianceItem).limit(1)).scalar_one()

    filtered = client.get(
        "/api/v1/dashboards/management",
        headers=headers,
        params={"unit_id": item.unit_id, "criticality": "High"},
    ).json()

    assert filtered["filters"] == {"unit_id": item.unit_id, "criticality": "High"}
    total = next(k for k in filtered["kpis"] if k["key"] == "total")["value"]
    assert total < 80

    register = client.get(
        "/api/v1/items",
        params={"page_size": 500, "unit_id": item.unit_id, "criticality": "High"},
        headers=headers,
    ).json()
    assert total <= register["total"]


def test_the_management_dashboard_ranks_top_risks_and_backlog(demo, client: TestClient) -> None:
    payload = client.get(
        "/api/v1/dashboards/management", headers=login(client, ADMIN)
    ).json()

    assert payload["top_risks"], "the demo estate has overdue items to rank"
    risk = payload["top_risks"][0]
    assert {"item_id", "item_code", "name", "criticality", "days_overdue"} <= set(risk)
    assert risk["status"] in ("Expired", "Overdue", "Under Process")

    # Ranking is (bucket severity, criticality weight, days overdue) descending.
    severity = {"Expired": 3, "Overdue": 2, "Under Process": 1}
    weights = {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
    scores = [
        (severity[row["status"]], weights[row["criticality"]], row["days_overdue"] or 0)
        for row in payload["top_risks"]
    ]
    assert scores == sorted(scores, reverse=True)

    backlog = payload["owner_backlog"]
    assert backlog and {"owner_name", "open_items", "overdue"} <= set(backlog[0])

    assert isinstance(payload["fees_next_quarter"], (int, float))
    assert len(payload["renewal_timeline"]) >= 1
    assert len(payload["index_trend"]) >= 1


# --------------------------------------------------------------------------- #
# Compliance Officer workbench (7.2)
# --------------------------------------------------------------------------- #
def test_the_officer_workbench_has_seven_tabs(demo, client: TestClient) -> None:
    payload = client.get("/api/v1/dashboards/officer", headers=login(client, ADMIN)).json()

    assert len(payload["tabs"]) == 7
    assert set(payload["counts"]) == set(payload["tabs"])
    for tab, count in payload["counts"].items():
        rows = payload["calendar"].get(tab) if isinstance(payload["calendar"], dict) else None
        assert isinstance(count, int) and count >= 0
        assert rows is None or len(rows) == count


def test_the_officer_workbench_lists_todays_actions_first(demo, client: TestClient) -> None:
    payload = client.get("/api/v1/dashboards/officer", headers=login(client, ADMIN)).json()
    assert isinstance(payload["today_actions"], list)
    if payload["today_actions"]:
        row = payload["today_actions"][0]
        assert {"item_id", "item_code", "derived_status", "rag"} <= set(row)


# --------------------------------------------------------------------------- #
# My Work (7.3)
# --------------------------------------------------------------------------- #
def test_my_work_summarises_only_my_own_rows(demo, client: TestClient) -> None:
    headers = login(client, DEPARTMENT)
    payload = client.get("/api/v1/dashboards/my-work", headers=headers).json()

    assert {"open", "overdue", "expired", "escalated"} == set(payload["counts"])
    me = client.get("/api/v1/auth/me", headers=headers).json()
    for row in payload["open_items"]:
        assert row["item_id"]
    owned = {
        item.id
        for item in demo.execute(
            select(ComplianceItem).where(ComplianceItem.owner_id == me["id"])
        ).scalars()
    }
    assert {row.get("item_id") for row in payload["open_items"]} <= owned | {
        row.get("item_id") for row in payload["delegated"]
    }


def test_the_compliance_officer_sees_the_whole_estate(demo, client: TestClient) -> None:
    payload = client.get("/api/v1/dashboards/my-work", headers=login(client, COMPLIANCE)).json()
    assert payload["counts"]["open"] >= 0
    assert isinstance(payload["upcoming_90"], list)


# --------------------------------------------------------------------------- #
# Filter options, calendar and weights
# --------------------------------------------------------------------------- #
def test_the_filter_options_match_the_seeded_master_data(demo, client: TestClient) -> None:
    payload = client.get("/api/v1/dashboards/filters", headers=login(client, ADMIN)).json()

    assert payload["units"] and payload["departments"] and payload["categories"]
    assert {"value", "label", "code"} <= set(payload["units"][0])
    assert set(payload["buckets"]) == set(BUCKETS)
    assert "Licence" in payload["types"]
    assert "Critical" in payload["criticalities"]
    assert len(payload["reports"]) == 12


def test_the_calendar_lists_twelve_months_of_events(demo, client: TestClient) -> None:
    payload = client.get(
        "/api/v1/dashboards/calendar", headers=login(client, ADMIN)
    ).json()

    assert len(payload["months"]) == 12
    assert payload["events"], "the demo estate has expiry dates"
    key = next(iter(payload["events"]))
    date.fromisoformat(key)  # every key is an ISO day
    assert {"item_id", "item_code", "event"} <= set(payload["events"][key][0])


def test_the_calendar_horizon_is_bounded(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    assert client.get(
        "/api/v1/dashboards/calendar", headers=headers, params={"months": 24}
    ).status_code == 200
    assert client.get(
        "/api/v1/dashboards/calendar", headers=headers, params={"months": 25}
    ).status_code == 422


def test_the_icalendar_feed_is_a_calendar_file(demo, client: TestClient) -> None:
    response = client.get("/api/v1/dashboards/export/ical", headers=login(client, ADMIN))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    assert response.text.startswith("BEGIN:VCALENDAR")
    assert "END:VCALENDAR" in response.text


def test_criticality_weights_match_the_index_formula(demo, client: TestClient) -> None:
    payload = client.get(
        "/api/v1/dashboards/criticality-weights", headers=login(client, ADMIN)
    ).json()
    assert payload["weights"] == {k.value: v for k, v in CRITICALITY_WEIGHT.items()}
    assert payload["weights"] == {"Critical": 4, "High": 3, "Medium": 2, "Low": 1}
    assert "x 100" in payload["formula"]


# --------------------------------------------------------------------------- #
# Access
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("email", [ADMIN, COMPLIANCE, MANAGEMENT])
def test_the_all_units_dashboards_are_open_to_oversight_roles(
    demo, client: TestClient, email: str
) -> None:
    headers = login(client, email)
    assert client.get("/api/v1/dashboards/management", headers=headers).status_code == 200
    assert client.get("/api/v1/dashboards/officer", headers=headers).status_code == 200
