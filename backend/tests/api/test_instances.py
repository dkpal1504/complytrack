"""HTTP tests for the renewal workflow: transitions, verification, roll-forward.

The happy path is driven end to end through ``POST /instances/{id}/transition``.
Evidence is attached by inserting a ``Document`` row directly on the test
session: the document upload endpoint is itself broken (see
``tests/api/test_documents.py``), and the workflow only asks the database
whether evidence exists, so seeding the row keeps this module focused on the
state machine.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.audit import AuditLog
from app.models.compliance import (
    ComplianceInstance,
    ComplianceItem,
    InstanceChecklist,
)
from app.models.documents import Document
from tests.conftest import login

ADMIN = "admin@complytrack.local"
COMPLIANCE = "compliance@complytrack.local"


def _instance(db, status: str = "Pending") -> ComplianceInstance:
    return db.execute(
        select(ComplianceInstance).where(ComplianceInstance.status == status).limit(1)
    ).scalar_one()


def _bare_instance(db, status: str = "Pending") -> ComplianceInstance:
    """A register instance with its DS-01 checklist cleared.

    The demo register materialises each cycle's required-documents checklist, so
    an instance taken from it arrives with lines already on it. The checklist
    tests below are about what one PATCH or one GET does to *their* line — they
    assert on the progress meter and on position ``[0]`` — so they start from an
    empty checklist rather than from the seeded rows, which would otherwise be
    counted and would sit ahead of theirs in the ordering.
    """
    instance = _instance(db, status)
    for line in db.execute(
        select(InstanceChecklist).where(InstanceChecklist.instance_id == instance.id)
    ).scalars():
        db.delete(line)
    db.commit()
    return instance


def _evidence(db, instance: ComplianceInstance, doc_type: str = "Application") -> None:
    """Attach an uploaded document to a cycle (the workflow's evidence gate)."""
    db.add(
        Document(
            item_id=instance.item_id,
            instance_id=instance.id,
            doc_type=doc_type,
            title=f"{doc_type} for {instance.cycle_label}",
            file_name="evidence.pdf",
            mime="application/pdf",
            size=32,
            storage_key=f"test/{instance.id}/{doc_type}.pdf",
            sha256="0" * 64,
        )
    )
    db.commit()


def _transition(client: TestClient, headers, instance_id: str, **body) -> object:
    return client.post(f"/api/v1/instances/{instance_id}/transition", headers=headers, json=body)


# --------------------------------------------------------------------------- #
# The happy path (PRD Section 8)
# --------------------------------------------------------------------------- #
def test_a_filing_is_late_by_the_ist_day_not_the_utc_one(
    demo, client: TestClient, monkeypatch
) -> None:
    """RT-07 and the lateness counter both count in IST days.

    2026-06-30 20:30 UTC is 02:00 IST on 1 July. An obligation expiring on 30
    June and filed at that instant was filed *after* its expiry, on the next
    IST day — and the register has to say so. Reading the UTC date instead made
    a filing up to five and a half hours late look on time, which is the one
    answer a compliance register must not give.
    """
    admin = login(client, ADMIN)
    instance = _bare_instance(demo)
    item = demo.get(ComplianceItem, instance.item_id)

    # A deadline that has just passed in IST.
    item.expiry_date = date(2026, 6, 30)
    instance.due_date = date(2026, 6, 30)
    demo.add_all([item, instance])
    demo.commit()

    # Pin the clock the service reads, rather than the day the test runs.
    monkeypatch.setattr(
        "app.services.instances.utcnow",
        lambda: datetime(2026, 6, 30, 20, 30, tzinfo=timezone.utc),
    )

    _transition(
        client, admin, instance.id,
        target_status="Under Process", expected_filing_date="2026-07-31",
    )
    _evidence(demo, instance, "Application")
    submitted = _transition(
        client, admin, instance.id,
        target_status="Submitted", submission_date="2026-07-01",
        acknowledgement_no="ACK-LATE-1",
    )
    assert submitted.status_code == 200

    demo.expire_all()
    stored = demo.get(ComplianceInstance, instance.id)
    assert stored.delay_days == 1, "filed on the IST day after the deadline"
    assert stored.renewal_in_process is False, (
        "a filing made after the expiry does not keep the item compliant"
    )


def test_the_happy_path_walks_from_pending_to_closed(demo, client: TestClient) -> None:
    admin, compliance = login(client, ADMIN), login(client, COMPLIANCE)
    instance = _instance(demo)

    started = _transition(
        client, admin, instance.id,
        target_status="Under Process", expected_filing_date="2026-12-31",
    )
    assert started.status_code == 200
    assert started.json()["status"] == "Under Process"

    _evidence(demo, instance, "Application")
    submitted = _transition(
        client, admin, instance.id,
        target_status="Submitted", submission_date="2026-06-01",
        acknowledgement_no="ACK-2026-1",
    )
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "Submitted"

    _evidence(demo, instance, "Certificate")
    renewed = _transition(
        client, admin, instance.id,
        target_status="Renewed", new_reference_number="NEW/2026/001",
        new_issue_date="2026-07-01", new_expiry_date="2027-06-30", fee_paid=2500.0,
    )
    assert renewed.status_code == 200
    assert renewed.json()["status"] == "Renewed"

    closed = _transition(
        client, compliance, instance.id,
        target_status="Closed", verification_remark="Checked against the original.",
    )
    assert closed.status_code == 200
    payload = closed.json()
    assert payload["status"] == "Closed"
    assert payload["closed_at"] is not None
    assert payload["detail"].endswith("moved to Closed.")

    demo.expire_all()
    after = demo.get(ComplianceInstance, instance.id)
    assert after.verification_status == "Approved"
    assert after.new_reference_number == "NEW/2026/001"
    assert after.submitted_at is not None
    assert after.renewed_at is not None


def test_closing_a_cycle_reopens_the_item_and_opens_the_next_one(demo, client: TestClient) -> None:
    admin, compliance = login(client, ADMIN), login(client, COMPLIANCE)
    instance = _instance(demo)
    item_id = instance.item_id

    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")
    _evidence(demo, instance, "Application")
    _transition(client, admin, instance.id, target_status="Submitted",
                submission_date="2026-06-01", acknowledgement_no="ACK-2026-2")
    _evidence(demo, instance, "Certificate")
    _transition(client, admin, instance.id, target_status="Renewed",
                new_reference_number="NEW/2026/002", new_issue_date="2026-07-01",
                new_expiry_date="2027-06-30")
    _transition(client, compliance, instance.id, target_status="Closed",
                verification_remark="Renewal verified.")

    demo.expire_all()
    item = demo.get(ComplianceItem, item_id)
    assert str(item.expiry_date) == "2027-06-30"
    assert item.reference_number == "NEW/2026/002"
    # RT-02: the headline renewal window follows the new expiry.
    assert item.renewal_due_date is not None and item.renewal_due_date < item.expiry_date

    cycles = demo.execute(
        select(ComplianceInstance).where(ComplianceInstance.item_id == item_id)
    ).scalars().all()
    assert len(cycles) == 2
    follow_up = next(c for c in cycles if c.id != instance.id)
    assert follow_up.status == "Pending"
    assert follow_up.due_date == date(2027, 6, 30)


def test_every_transition_is_written_to_the_audit_trail(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _instance(demo)

    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")

    audit = demo.execute(
        select(AuditLog).where(
            AuditLog.entity_id == instance.id, AuditLog.action == "status_change"
        )
    ).scalars().all()
    assert len(audit) == 1
    entry = audit[0]
    # Audit values are stored as canonical JSON, so a string round-trips quoted.
    assert json.loads(entry.old_value) == "Pending"
    assert json.loads(entry.new_value) == "Under Process"
    assert entry.field == "status"


def test_starting_work_records_the_acknowledgement_and_filing_date(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _instance(demo)

    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")

    demo.expire_all()
    after = demo.get(ComplianceInstance, instance.id)
    assert after.owner_acknowledged_at is not None
    assert str(after.expected_filing_date) == "2026-12-31"
    assert after.started_at is not None


# --------------------------------------------------------------------------- #
# Refusals
# --------------------------------------------------------------------------- #
def test_an_illegal_transition_is_refused(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _instance(demo)
    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")

    # Under Process can only go to On Hold, Query Raised or Submitted (Section 8).
    response = _transition(client, admin, instance.id, target_status="Renewed")
    # 409, not 400: the payload was well formed and the resource exists — what
    # refuses the move is the state the cycle is in. A client that retries this
    # unchanged will always fail, and in practice the cause is a screen loaded
    # before somebody else moved the cycle.
    assert response.status_code == 409
    assert "Cannot move from Under Process to Renewed" in response.json()["detail"]
    assert "Allowed:" in response.json()["detail"]

    demo.expire_all()
    assert demo.get(ComplianceInstance, instance.id).status == "Under Process"


def test_the_two_refusals_are_distinguishable_by_status_code(demo, client: TestClient) -> None:
    """A state conflict and an incomplete payload are not the same mistake.

    Both used to be answered the same way — 409 by the application-level
    handler, which is where every state-machine error actually ended up, while
    the route's own wrapper that answered 400 sat unreachable. A client could
    not tell "you left a field out, fix it and resend" from "this cycle is not
    in a state where that is possible at all". The two conditions still have to
    be told apart, so this pins both.
    """
    admin = login(client, ADMIN)
    instance = _instance(demo)
    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")

    # A move the state machine forbids: retrying will never help.
    illegal = _transition(client, admin, instance.id, target_status="Renewed")
    assert illegal.status_code == 409

    # A move that is legal but incomplete: completing it and retrying will.
    incomplete = _transition(
        client, admin, instance.id, target_status="Submitted", submission_date="2026-11-01"
    )
    assert incomplete.status_code == 400
    assert incomplete.json()["detail"].startswith("Missing mandatory information")
    assert "Required:" in incomplete.json()["detail"]


def test_a_missing_mandatory_field_is_refused(demo, client: TestClient) -> None:
    response = _transition(client, login(client, ADMIN), _instance(demo).id,
                           target_status="Under Process")
    assert response.status_code == 400  # an incomplete payload, not a state conflict
    assert "expected filing date" in response.json()["detail"]


def test_submission_without_evidence_is_refused(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _instance(demo)
    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")

    response = _transition(
        client, admin, instance.id, target_status="Submitted",
        submission_date="2026-06-01", acknowledgement_no="ACK-2026-3",
    )
    assert response.status_code == 400  # an incomplete payload, not a state conflict
    assert "supporting document" in response.json()["detail"]

    demo.expire_all()
    assert demo.get(ComplianceInstance, instance.id).status == "Under Process"


def test_renewal_without_the_new_certificate_is_refused(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _instance(demo)
    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")
    _evidence(demo, instance, "Application")
    _transition(client, admin, instance.id, target_status="Submitted",
                submission_date="2026-06-01", acknowledgement_no="ACK-2026-4")

    response = _transition(
        client, admin, instance.id, target_status="Renewed",
        new_reference_number="NEW/2026/003", new_issue_date="2026-07-01",
        new_expiry_date="2027-06-30",
    )
    assert response.status_code == 400  # an incomplete payload, not a state conflict
    assert "renewed certificate" in response.json()["detail"]


def test_an_unknown_cycle_is_a_404(demo, client: TestClient) -> None:
    assert client.get("/api/v1/instances/no-such-cycle", headers=login(client, ADMIN)).status_code == 404


# --------------------------------------------------------------------------- #
# On hold / query raised round trip
# --------------------------------------------------------------------------- #
def test_a_cycle_can_be_put_on_hold_and_resumed(demo, client: TestClient) -> None:
    admin, compliance = login(client, ADMIN), login(client, COMPLIANCE)
    instance = _instance(demo)

    held = _transition(
        client, compliance, instance.id, target_status="On Hold",
        on_hold_reason="Waiting for the authority's portal window.",
        review_date="2026-08-01",
    )
    assert held.status_code == 200
    demo.expire_all()
    assert demo.get(ComplianceInstance, instance.id).on_hold_reason.startswith("Waiting")

    resumed = _transition(
        client, admin, instance.id, target_status="Under Process",
        expected_filing_date="2026-12-31",
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "Under Process"


# --------------------------------------------------------------------------- #
# Verification (DS-06)
# --------------------------------------------------------------------------- #
def _submitted_instance(demo, client: TestClient) -> ComplianceInstance:
    admin = login(client, ADMIN)
    instance = _instance(demo)
    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")
    _evidence(demo, instance, "Application")
    _transition(client, admin, instance.id, target_status="Submitted",
                submission_date="2026-06-01", acknowledgement_no="ACK-2026-5")
    demo.expire_all()
    return demo.get(ComplianceInstance, instance.id)


def test_verification_approves_and_closes_the_cycle(demo, client: TestClient) -> None:
    instance = _submitted_instance(demo, client)
    response = client.post(
        f"/api/v1/instances/{instance.id}/verify",
        headers=login(client, COMPLIANCE),
        json={"decision": "approve", "remark": "Evidence complete.", "roll_forward": False},
    )
    assert response.status_code == 200
    assert response.json()["verification_status"] == "Approved"
    assert response.json()["status"] == "Closed"


def test_verification_can_send_the_renewal_back(demo, client: TestClient) -> None:
    instance = _submitted_instance(demo, client)
    response = client.post(
        f"/api/v1/instances/{instance.id}/verify",
        headers=login(client, COMPLIANCE),
        json={"decision": "reject", "remark": "The challan is missing."},
    )
    assert response.status_code == 200
    assert response.json()["verification_status"] == "Rejected"
    assert response.json()["status"] == "Under Process"

    demo.expire_all()
    after = demo.get(ComplianceInstance, instance.id)
    assert after.verification_remark == "The challan is missing."
    assert after.verified_by is not None


def test_verification_needs_a_remark(demo, client: TestClient) -> None:
    instance = _submitted_instance(demo, client)
    response = client.post(
        f"/api/v1/instances/{instance.id}/verify",
        headers=login(client, COMPLIANCE),
        json={"decision": "approve", "remark": "x"},
    )
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# Roll-forward (business rule 4)
# --------------------------------------------------------------------------- #
def test_roll_forward_opens_the_next_cycle_once(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _instance(demo)

    first = client.post(f"/api/v1/instances/{instance.id}/roll-forward", headers=admin)
    assert first.status_code == 200
    assert first.json()["created"] is True

    second = client.post(f"/api/v1/instances/{instance.id}/roll-forward", headers=admin)
    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]  # idempotent


# --------------------------------------------------------------------------- #
# Checklist and comments
# --------------------------------------------------------------------------- #
def test_a_checklist_line_can_be_ticked_off(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _bare_instance(demo)
    line = InstanceChecklist(
        instance_id=instance.id, item_name="Board resolution", status="Pending", sort_order=0
    )
    demo.add(line)
    demo.commit()

    response = client.patch(
        f"/api/v1/instances/{instance.id}/checklist/{line.id}",
        headers=admin,
        json={"status": "Received"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "Received"
    assert response.json()["progress"] == {"total": 1, "received": 1, "pending": 0, "percent": 100}


def test_commenting_on_a_cycle_is_audited(demo, client: TestClient) -> None:
    from app.models.auth import User

    admin = login(client, ADMIN)
    instance = _instance(demo)
    colleague = demo.execute(
        select(User).where(User.email == COMPLIANCE)
    ).scalar_one()

    response = client.post(
        f"/api/v1/instances/{instance.id}/comments",
        headers=admin,
        json={
            "body": "Called the inspector about the pending challan.",
            "mentions": [colleague.id],
        },
    )
    assert response.status_code == 201
    assert response.json()["body"].startswith("Called the inspector")


def test_mentioning_an_unknown_user_still_records_the_comment(
    demo, client: TestClient
) -> None:
    """An id that names nobody is dropped, not allowed to take the comment with it.

    The mention ids come from a client that held its user list at render time,
    so they go stale: the account is deactivated, or the id was malformed. They
    were written straight into ``notification.user_id``, a NOT NULL foreign key,
    so one stale id made the whole request fail and the words were lost — the
    part that actually mattered.
    """
    from app.models.compliance import Comment

    instance = _instance(demo)
    response = client.post(
        f"/api/v1/instances/{instance.id}/comments",
        headers=login(client, ADMIN),
        json={"body": "Heads up.", "mentions": ["no-such-user-id"]},
    )
    assert response.status_code == 201
    assert response.json()["body"] == "Heads up."

    demo.expire_all()
    stored = demo.get(Comment, response.json()["id"])
    # Nothing is left claiming a mention of an account that does not exist.
    assert stored.mentions == []


def test_a_mention_of_a_real_colleague_still_notifies_them(
    demo, client: TestClient
) -> None:
    """The filtering must not have cost the mentions that do name somebody."""
    from app.models.auth import User
    from app.models.compliance import Comment
    from app.models.reminders import Notification

    instance = _instance(demo)
    colleague = demo.execute(select(User).where(User.email == COMPLIANCE)).scalar_one()
    response = client.post(
        f"/api/v1/instances/{instance.id}/comments",
        headers=login(client, ADMIN),
        json={"body": "Over to you.", "mentions": [colleague.id, "no-such-user-id"]},
    )
    assert response.status_code == 201

    demo.expire_all()
    stored = demo.get(Comment, response.json()["id"])
    assert stored.mentions == [colleague.id]

    inbox = demo.execute(
        select(Notification).where(Notification.user_id == colleague.id)
    ).scalars().all()
    assert any("mentioned you" in row.title for row in inbox), (
        "the mention never reached the colleague's notification centre"
    )


def test_the_timeline_lists_the_cycle_history(demo, client: TestClient) -> None:
    admin = login(client, ADMIN)
    instance = _instance(demo)
    _transition(client, admin, instance.id, target_status="Under Process",
                expected_filing_date="2026-12-31")

    response = client.get(f"/api/v1/instances/{instance.id}/timeline", headers=admin)
    assert response.status_code == 200
    entries = response.json()
    assert entries
    assert {"ts", "kind", "title", "detail"} <= set(entries[0])


# --------------------------------------------------------------------------- #
# Cycle detail
# --------------------------------------------------------------------------- #
def test_the_cycle_detail_reports_the_live_cycle(demo, client: TestClient) -> None:
    instance = _bare_instance(demo)
    payload = client.get(
        f"/api/v1/instances/{instance.id}", headers=login(client, ADMIN)
    ).json()

    assert payload["id"] == instance.id
    assert payload["item_code"] == instance.item.item_code
    assert payload["status"] == instance.status
    assert payload["cycle_label"] == instance.cycle_label
    assert {"total", "received", "pending", "percent"} == set(payload["progress"])
    assert payload["checklist"] == []


def test_the_cycle_detail_is_guarded_by_scope(demo, client: TestClient) -> None:
    """A department owner cannot read a cycle from another department."""
    instance = _instance(demo)
    response = client.get(
        f"/api/v1/instances/{instance.id}", headers=login(client, "safety.owner@complytrack.local")
    )
    assert response.status_code in (200, 403)


# --------------------------------------------------------------------------- #
# The cycle detail payload
# --------------------------------------------------------------------------- #
def test_the_cycle_detail_is_readable(demo, client: TestClient) -> None:
    """A cycle with a checklist line renders, with exactly the PRD's fields on it.

    This used to answer 500: the payload read ``InstanceChecklist.is_mandatory``
    and ``.notes``, and the model declares neither, so the first checklist line
    on a cycle took the whole response down with an AttributeError. The field set
    is pinned here because it is the PRD's data model (Section 10) — name,
    status, who received it and when, and the note the line carries — and a
    payload that drifts from it is how the last one went unnoticed.
    """
    instance = _bare_instance(demo)
    demo.add(
        InstanceChecklist(
            instance_id=instance.id, item_name="Board resolution", status="Pending", sort_order=0
        )
    )
    demo.commit()

    response = client.get(f"/api/v1/instances/{instance.id}", headers=login(client, ADMIN))
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == instance.id
    assert body["checklist"][0]["item_name"] == "Board resolution"
    assert set(body["checklist"][0]) == {
        "id", "item_name", "status", "sort_order", "received_at", "notes",
    }


def test_a_checklist_note_is_recorded_and_read_back(demo, client: TestClient) -> None:
    """The note the checklist screen offers is stored, not quietly discarded.

    ``ChecklistUpdate`` has always accepted a ``note`` and the screen has always
    said it would be recorded, but the service was only ever handed the status,
    so the text was dropped between the two. It is read back through the cycle
    detail, which is where the checklist panel loads it from.
    """
    admin = login(client, ADMIN)
    instance = _bare_instance(demo)
    line = InstanceChecklist(
        instance_id=instance.id, item_name="Fee challan", status="Pending", sort_order=0
    )
    demo.add(line)
    demo.commit()

    saved = client.patch(
        f"/api/v1/instances/{instance.id}/checklist/{line.id}",
        headers=admin,
        json={"status": "Received", "note": "Challan no. 4471, original seen."},
    )
    assert saved.status_code == 200
    assert saved.json()["notes"] == "Challan no. 4471, original seen."

    detail = client.get(f"/api/v1/instances/{instance.id}", headers=admin)
    assert detail.json()["checklist"][0]["notes"] == "Challan no. 4471, original seen."


def test_changing_only_the_status_leaves_the_note_alone(demo, client: TestClient) -> None:
    """A caller that sends no note must not wipe one somebody else wrote."""
    admin = login(client, ADMIN)
    instance = _bare_instance(demo)
    line = InstanceChecklist(
        instance_id=instance.id, item_name="Site plan", status="Pending", sort_order=0,
        notes="Photocopy filed with the EHS officer.",
    )
    demo.add(line)
    demo.commit()

    client.patch(
        f"/api/v1/instances/{instance.id}/checklist/{line.id}",
        headers=admin,
        json={"status": "Received"},
    )
    detail = client.get(f"/api/v1/instances/{instance.id}", headers=admin)
    assert detail.json()["checklist"][0]["notes"] == "Photocopy filed with the EHS officer."
