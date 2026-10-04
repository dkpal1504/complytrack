"""AC-5: the dashboard, the register and the reports must tell one story.

The management cockpit counts items by compliance bucket. The same buckets are
the register's own ``bucket`` field and R1's ``summary``, so for any filter the
three must agree — a dashboard tile that no register query can reproduce is a
tile nobody can act on.
"""

from __future__ import annotations

import io
from collections import Counter

import openpyxl
import pytest
from fastapi.testclient import TestClient

from app.domain.enums import ComplianceBucket, DerivedStatus
from tests.conftest import login

ADMIN = "admin@complytrack.local"
BUCKETS = [bucket.value for bucket in ComplianceBucket]

# KPI drill codes that name a bucket (the others are "all" and the rolling
# 30-day window, which no single bucket can reproduce).
BUCKET_DRILLS = ["Complied", "Pending", "Under Process", "Overdue", "Expired"]


def _register(client: TestClient, headers, **params) -> dict:
    return client.get(
        "/api/v1/items",
        headers=headers,
        params={"page_size": 500, "include_archived": False, **params},
    ).json()


def _tally(rows: list[dict]) -> Counter:
    return Counter(row["bucket"] for row in rows)


def _split(client: TestClient, headers, **params) -> dict[str, int]:
    payload = client.get("/api/v1/dashboards/management", headers=headers, params=params).json()
    return {row["key"]: row["value"] for row in payload["status_split"]}


def _kpi(payload: dict, key: str) -> int:
    return next(kpi["value"] for kpi in payload["kpis"] if kpi["key"] == key)


# --------------------------------------------------------------------------- #
# One estate, three views
# --------------------------------------------------------------------------- #
def test_the_dashboard_split_equals_the_register_bucket_tally(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    register = _register(client, headers)
    assert register["total"] == 80

    tally = _tally(register["items"])
    assert set(tally) <= set(BUCKETS)
    assert dict(tally) == _split(client, headers)


def test_the_dashboard_split_equals_the_register_report(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    summary = client.get("/api/v1/reports/R1", headers=headers).json()["summary"]

    assert summary["total"] == 80
    for bucket, value in _split(client, headers).items():
        assert summary[bucket] == value, f"R1 summary disagrees on {bucket}"


def test_the_dashboard_total_equals_the_register_total(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    payload = client.get("/api/v1/dashboards/management", headers=headers).json()

    assert _kpi(payload, "total") == _register(client, headers)["total"]
    for bucket in BUCKET_DRILLS:
        key = bucket.lower().replace(" ", "_")
        aliases = {"complied": "complied", "pending": "pending",
                   "under_process": "under_process", "overdue": "overdue",
                   "expired": "expired"}
        assert _kpi(payload, aliases[key]) == _split(client, headers)[bucket]


# --------------------------------------------------------------------------- #
# Same filters, same numbers
# --------------------------------------------------------------------------- #
def test_every_filter_narrows_both_views_identically(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    rows = _register(client, headers)["items"]
    unit_id = rows[0]["unit_id"]
    criticality = rows[0]["criticality"]

    for params in (
        {"unit_id": unit_id},
        {"criticality": criticality},
        {"unit_id": unit_id, "criticality": criticality},
    ):
        register = _register(client, headers, **params)
        dashboard = client.get(
            "/api/v1/dashboards/management", headers=headers, params=params
        ).json()

        assert _kpi(dashboard, "total") == register["total"], params
        assert {
            row["key"]: row["value"] for row in dashboard["status_split"]
        } == {
            bucket: count for bucket, count in _tally(register["items"]).items()
        }, params


def test_the_unit_breakdown_adds_up_to_the_company_split(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    payload = client.get("/api/v1/dashboards/management", headers=headers).json()

    per_unit = Counter()
    for row in payload["unit_status"]:
        assert row["total"] == sum(row["values"].values())
        per_unit.update(row["values"])

    assert dict(per_unit) == _split(client, headers)
    assert sum(row["total"] for row in payload["unit_status"]) == _kpi(payload, "total")


def test_the_department_breakdown_never_exceeds_the_estate(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    payload = client.get("/api/v1/dashboards/management", headers=headers).json()
    split = _split(client, headers)

    for row in payload["department_status"]:
        assert row["total"] == sum(row["values"].values())
        for bucket, value in row["values"].items():
            assert value <= split[bucket]


# --------------------------------------------------------------------------- #
# The register's own computed filter
# --------------------------------------------------------------------------- #
def test_the_register_derived_filter_uses_the_derived_vocabulary(
    demo, client: TestClient
) -> None:
    headers = login(client, ADMIN)
    counts = {
        status.value: _register(client, headers, derived_status=status.value)["total"]
        for status in DerivedStatus
    }
    assert sum(counts.values()) == 80
    assert counts[DerivedStatus.VALID.value] > 0
    # Only one name is shared with the dashboard vocabulary, and there the two
    # views agree exactly.
    assert counts[DerivedStatus.EXPIRED.value] == _split(client, headers)[
        ComplianceBucket.EXPIRED.value
    ]


@pytest.mark.parametrize("bucket", BUCKET_DRILLS)
def test_every_bucket_tile_drills_through_to_its_own_rows(
    demo, client: TestClient, bucket: str
) -> None:
    """AC-5: "each card drills to the underlying list"."""
    headers = login(client, ADMIN)
    drilled = _register(client, headers, bucket=bucket)

    assert drilled["total"] == _split(client, headers)[bucket]
    assert drilled["total"] > 0
    assert all(row["bucket"] == bucket for row in drilled["items"])


def test_every_kpi_card_reports_its_own_drill_target_and_that_target_agrees(
    demo, client: TestClient
) -> None:
    """The card's number and the list it opens are the same count.

    Walked from the payload rather than from a list written here, so a card
    added to the dashboard without a working drill target fails this.
    """
    headers = login(client, ADMIN)
    payload = client.get("/api/v1/dashboards/management", headers=headers).json()

    for kpi in payload["kpis"]:
        if kpi["key"] == "index":  # A percentage, not a count of rows.
            continue
        drill = kpi["drill"]
        assert drill, f"{kpi['key']} offers no drill-down"
        drilled = _register(client, headers, bucket=drill)
        assert drilled["total"] == kpi["value"], (
            f"drilling into {kpi['key']} showed {drilled['total']} rows, "
            f"the card says {kpi['value']}"
        )


def test_the_total_tile_drills_to_everything_the_register_shows(
    demo, client: TestClient
) -> None:
    headers = login(client, ADMIN)
    payload = client.get("/api/v1/dashboards/management", headers=headers).json()

    assert _register(client, headers, bucket="all")["total"] == _kpi(payload, "total")
    assert _kpi(payload, "total") == _register(client, headers)["total"]


def test_the_due_soon_tile_drills_to_the_items_expiring_inside_its_window(
    demo, client: TestClient
) -> None:
    """The one card that is a window rather than a bucket."""
    headers = login(client, ADMIN)
    payload = client.get("/api/v1/dashboards/management", headers=headers).json()
    drilled = _register(client, headers, bucket="due30")

    assert drilled["total"] == _kpi(payload, "due_30")
    assert drilled["total"] > 0
    for row in drilled["items"]:
        assert row["bucket"] != "Complied"
        assert 0 <= row["days_left"] <= 30


def test_the_drill_filter_narrows_exactly_as_the_card_did_under_other_filters(
    demo, client: TestClient
) -> None:
    """A drill composes with the filters the dashboard was read under."""
    headers = login(client, ADMIN)
    rows = _register(client, headers)["items"]
    unit_id = rows[0]["unit_id"]

    for drill in ("all", "due30", *BUCKET_DRILLS):
        payload = client.get(
            "/api/v1/dashboards/management", headers=headers, params={"unit_id": unit_id}
        ).json()
        drilled = _register(client, headers, bucket=drill, unit_id=unit_id)
        expected = next(
            (k["value"] for k in payload["kpis"] if k["drill"] == drill), None
        )
        if expected is None:
            continue  # The index card shares "all"; nothing else is skipped.
        assert drilled["total"] == expected, f"{drill} lost rows under a unit filter"


def test_the_register_derived_filter_uses_the_derived_vocabulary(
    demo, client: TestClient
) -> None:
    headers = login(client, ADMIN)
    counts = {
        status.value: _register(client, headers, derived_status=status.value)["total"]
        for status in DerivedStatus
    }
    assert sum(counts.values()) == 80
    assert counts[DerivedStatus.VALID.value] > 0
    # Only one name is shared with the dashboard vocabulary, and there the two
    # views agree exactly.
    assert counts[DerivedStatus.EXPIRED.value] == _split(client, headers)[
        ComplianceBucket.EXPIRED.value
    ]


def test_the_register_refuses_a_drill_code_that_names_nothing(
    demo, client: TestClient
) -> None:
    """A typo in a link must fail loudly, not silently show an empty register."""
    headers = login(client, ADMIN)
    response = client.get("/api/v1/items", headers=headers, params={"bucket": "Complaint"})
    assert response.status_code == 422


def test_the_export_honours_the_drill_filter(demo, client: TestClient) -> None:
    """What the user clicked is what lands in the workbook."""
    headers = login(client, ADMIN)
    total = _register(client, headers, bucket="Expired")["total"]

    response = client.get(
        "/api/v1/items/export/register", headers=headers, params={"bucket": "Expired"}
    )
    assert response.status_code == 200
    sheet = openpyxl.load_workbook(io.BytesIO(response.content)).active
    assert sheet.max_row - 1 == total  # Minus the header row.
