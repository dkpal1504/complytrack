"""The demo register has to satisfy the requirements it exists to demonstrate.

DS-01 — the required-documents checklist per obligation — is a "M" requirement,
and it is *the* thing the renewal workflow is worked through. The seed built the
register from the template library but never materialised a single checklist
line, so a fresh install showed an empty Checklist tab on every obligation and a
progress meter with nothing to count. Nothing failed, because no test looked at
what a fresh install actually contains.

These tests look at exactly that: the register as a new deployment gets it.
"""

from __future__ import annotations

from sqlalchemy import select

from app.db.demo import CHECKLIST_NOTE, NOT_REQUIRED_NOTE
from app.domain.enums import ChecklistStatus, ItemStatus
from app.models.compliance import (
    ComplianceInstance,
    ComplianceItem,
    InstanceChecklist,
)


def _lines_for(db, instance_id: str) -> list[InstanceChecklist]:
    return list(
        db.execute(
            select(InstanceChecklist)
            .where(InstanceChecklist.instance_id == instance_id)
            .order_by(InstanceChecklist.sort_order)
        ).scalars()
    )


def test_every_obligation_that_lists_documents_gets_a_checklist(demo) -> None:
    """One line per required document, in the template's order."""
    items = {
        item.id: item
        for item in demo.execute(select(ComplianceItem)).scalars()
    }
    instances = list(demo.execute(select(ComplianceInstance)).scalars())
    assert instances, "the demo register should not be empty"

    for instance in instances:
        item = items[instance.item_id]
        expected = list(item.required_documents or [])
        lines = _lines_for(demo, instance.id)
        assert [line.item_name for line in lines] == expected, (
            f"{item.item_code} lists {expected} but its cycle has "
            f"{[line.item_name for line in lines]}"
        )


def test_a_fresh_register_shows_all_three_checklist_states(demo) -> None:
    """Received, Pending and Not Required are all visible out of the box."""
    statuses = {
        status
        for (status,) in demo.execute(select(InstanceChecklist.status).distinct())
    }
    assert statuses == {
        ChecklistStatus.RECEIVED.value,
        ChecklistStatus.PENDING.value,
        ChecklistStatus.NOT_REQUIRED.value,
    }


def test_a_received_line_names_who_received_it_and_when(demo) -> None:
    """The PRD's line records the pair; a date with nobody against it is half a record."""
    lines = list(
        demo.execute(
            select(InstanceChecklist).where(
                InstanceChecklist.status == ChecklistStatus.RECEIVED.value
            )
        ).scalars()
    )
    assert lines
    for line in lines:
        assert line.received_at is not None, line.item_name
        assert line.received_by is not None, line.item_name

    # And the other way round: nothing is stamped received-by while still Pending.
    stragglers = demo.execute(
        select(InstanceChecklist).where(
            InstanceChecklist.status != ChecklistStatus.RECEIVED.value,
            InstanceChecklist.received_at.is_not(None),
        )
    ).scalars().all()
    assert stragglers == []


def test_the_two_demonstration_notes_are_present(demo) -> None:
    """The note field the checklist screen offers has something in it on install."""
    notes = {
        note
        for (note,) in demo.execute(
            select(InstanceChecklist.notes).where(InstanceChecklist.notes.is_not(None))
        )
    }
    assert CHECKLIST_NOTE in notes
    assert NOT_REQUIRED_NOTE in notes


def test_a_waived_line_does_not_hold_the_progress_meter_down(demo, client) -> None:
    """A cycle whose only outstanding line is "Not Required" is complete."""
    from tests.conftest import login

    from app.services.instances import instance_progress

    # The seed's "nearly_done" state is what an in-flight cycle gets.
    instance = demo.execute(
        select(ComplianceInstance).where(
            ComplianceInstance.status == ItemStatus.UNDER_PROCESS.value
        ).limit(1)
    ).scalar_one()
    lines = _lines_for(demo, instance.id)
    waived = [line for line in lines if line.status == ChecklistStatus.NOT_REQUIRED.value]
    assert waived, "the seed should show a waived line somewhere"

    progress = instance_progress(demo, instance.id)
    assert progress["total"] == len(lines)
    assert progress["pending"] == 0
    assert progress["percent"] == 100

    # And the API agrees with the service, since the panel renders this figure.
    body = client.get(
        f"/api/v1/instances/{instance.id}", headers=login(client, "admin@complytrack.local")
    ).json()
    assert body["progress"] == progress
