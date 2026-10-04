"""Pure unit tests for the status engine (``app.domain.status``).

PRD business rules 1 and 2, requirement RT-05 and the Compliance Index
(EX-04). Every boundary — today equal to the expiry, today equal to the
renewal-due date, 30 and 90 days left — is pinned here.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.domain.status import (
    StatusInput,
    ageing_bucket,
    compliance_bucket,
    compliance_index,
    derive_status,
    rag_colour,
    status_counts,
)
from app.domain.enums import (
    Applicability,
    ComplianceBucket,
    DerivedStatus,
    ItemStatus,
    RagColour,
)

TODAY = date(2026, 6, 15)


# --------------------------------------------------------------------------- #
# derive_status
# --------------------------------------------------------------------------- #
def test_not_applicable_short_circuits_everything() -> None:
    state = StatusInput(
        applicability=Applicability.NOT_APPLICABLE,
        expiry_date=date(2020, 1, 1),  # long expired, still not applicable
    )
    assert derive_status(state, TODAY) == DerivedStatus.NOT_APPLICABLE


def test_not_applicable_workflow_state_also_short_circuits() -> None:
    state = StatusInput(workflow_status=ItemStatus.NOT_APPLICABLE)
    assert derive_status(state, TODAY) == DerivedStatus.NOT_APPLICABLE


@pytest.mark.parametrize("workflow_status", [ItemStatus.CLOSED, ItemStatus.RENEWED])
def test_satisfied_cycles_are_valid_even_past_the_old_expiry(workflow_status: str) -> None:
    state = StatusInput(workflow_status=workflow_status, expiry_date=date(2020, 1, 1))
    assert derive_status(state, TODAY) == DerivedStatus.VALID


def test_perpetual_item_is_valid_forever() -> None:
    assert derive_status(StatusInput(is_perpetual=True), TODAY) == DerivedStatus.PERPETUAL
    assert derive_status(StatusInput(expiry_date=None), TODAY) == DerivedStatus.PERPETUAL


def test_day_after_expiry_is_expired() -> None:
    state = StatusInput(expiry_date=date(2026, 6, 14))
    assert derive_status(state, TODAY) == DerivedStatus.EXPIRED


def test_today_equal_to_expiry_is_still_upcoming() -> None:
    # Business rule: an item is only Expired the day *after* its expiry date.
    state = StatusInput(expiry_date=TODAY)
    assert derive_status(state, TODAY) == DerivedStatus.UPCOMING


def test_today_equal_to_renewal_due_date_is_due_for_renewal() -> None:
    state = StatusInput(
        expiry_date=date(2026, 9, 30),
        renewal_due_date=TODAY,
    )
    assert derive_status(state, TODAY) == DerivedStatus.DUE_FOR_RENEWAL


def test_due_for_renewal_wins_over_the_reminder_window() -> None:
    # Expiry is 12 months away but the renewal-due date has passed.
    state = StatusInput(
        expiry_date=date(2027, 6, 15),
        renewal_due_date=date(2026, 6, 1),
    )
    assert derive_status(state, TODAY) == DerivedStatus.DUE_FOR_RENEWAL


@pytest.mark.parametrize("days_left", [30, 90])
def test_inside_the_reminder_window_is_upcoming(days_left: int) -> None:
    state = StatusInput(expiry_date=TODAY + timedelta(days=days_left))
    assert derive_status(state, TODAY) == DerivedStatus.UPCOMING


def test_just_outside_the_window_is_valid() -> None:
    state = StatusInput(expiry_date=date(2026, 9, 14))  # 91 days after TODAY
    assert derive_status(state, TODAY) == DerivedStatus.VALID


# --------------------------------------------------------------------------- #
# compliance_bucket
# --------------------------------------------------------------------------- #
def test_not_applicable_has_no_bucket() -> None:
    assert compliance_bucket(StatusInput(workflow_status=ItemStatus.NOT_APPLICABLE), TODAY) is None
    assert compliance_bucket(StatusInput(applicability=Applicability.NOT_APPLICABLE), TODAY) is None


@pytest.mark.parametrize("workflow_status", [ItemStatus.CLOSED, ItemStatus.RENEWED])
def test_satisfied_cycle_counts_as_complied(workflow_status: str) -> None:
    assert compliance_bucket(StatusInput(workflow_status=workflow_status), TODAY) == ComplianceBucket.COMPLIED


def test_renewal_in_process_counts_as_complied() -> None:
    # RT-07: applied before expiry with an acknowledgement on file.
    state = StatusInput(
        workflow_status=ItemStatus.SUBMITTED,
        expiry_date=date(2026, 7, 1),
        renewal_in_process=True,
    )
    assert compliance_bucket(state, TODAY) == ComplianceBucket.COMPLIED


def test_perpetual_obligation_counts_as_complied() -> None:
    assert compliance_bucket(StatusInput(is_perpetual=True), TODAY) == ComplianceBucket.COMPLIED


def test_expiry_wins_over_an_in_flight_workflow_state() -> None:
    state = StatusInput(workflow_status=ItemStatus.UNDER_PROCESS, expiry_date=date(2026, 5, 1))
    assert compliance_bucket(state, TODAY) == ComplianceBucket.EXPIRED


@pytest.mark.parametrize(
    "workflow_status",
    [ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED, ItemStatus.QUERY_RAISED],
)
def test_in_flight_states_are_under_process(workflow_status: str) -> None:
    state = StatusInput(workflow_status=workflow_status, expiry_date=date(2026, 12, 31))
    assert compliance_bucket(state, TODAY) == ComplianceBucket.UNDER_PROCESS


def test_pending_with_a_slipped_deadline_is_overdue() -> None:
    state = StatusInput(
        workflow_status=ItemStatus.PENDING,
        expiry_date=date(2026, 12, 31),
        internal_target_date=date(2026, 6, 1),
    )
    assert compliance_bucket(state, TODAY) == ComplianceBucket.OVERDUE


def test_pending_on_the_deadline_is_not_yet_overdue() -> None:
    state = StatusInput(
        workflow_status=ItemStatus.PENDING,
        expiry_date=date(2026, 12, 31),
        internal_target_date=TODAY,
    )
    assert compliance_bucket(state, TODAY) == ComplianceBucket.PENDING


def test_pending_with_no_deadline_at_all_is_pending() -> None:
    state = StatusInput(workflow_status=ItemStatus.PENDING, expiry_date=date(2026, 12, 31))
    assert compliance_bucket(state, TODAY) == ComplianceBucket.PENDING


# --------------------------------------------------------------------------- #
# rag_colour
# --------------------------------------------------------------------------- #
def test_not_applicable_is_grey() -> None:
    assert rag_colour(StatusInput(workflow_status=ItemStatus.NOT_APPLICABLE), TODAY) == RagColour.GREY


@pytest.mark.parametrize(
    "state",
    [
        StatusInput(expiry_date=date(2026, 1, 1)),  # expired
        StatusInput(  # overdue
            workflow_status=ItemStatus.PENDING,
            expiry_date=date(2026, 12, 31),
            internal_target_date=date(2026, 6, 1),
        ),
    ],
)
def test_expired_and_overdue_are_red(state: StatusInput) -> None:
    assert rag_colour(state, TODAY) == RagColour.RED


def test_complied_is_green() -> None:
    assert rag_colour(StatusInput(workflow_status=ItemStatus.CLOSED), TODAY) == RagColour.GREEN


@pytest.mark.parametrize("days_left", [0, 15, 30])
def test_within_amber_window_is_amber(days_left: int) -> None:
    state = StatusInput(expiry_date=TODAY + timedelta(days=days_left))
    assert rag_colour(state, TODAY) == RagColour.AMBER


def test_under_process_inside_ninety_days_is_amber_but_green_beyond() -> None:
    near = StatusInput(workflow_status=ItemStatus.UNDER_PROCESS, expiry_date=TODAY + timedelta(days=90))
    far = StatusInput(workflow_status=ItemStatus.UNDER_PROCESS, expiry_date=TODAY + timedelta(days=91))
    assert rag_colour(near, TODAY) == RagColour.AMBER
    assert rag_colour(far, TODAY) == RagColour.GREEN


def test_pending_outside_the_amber_window_is_green() -> None:
    state = StatusInput(workflow_status=ItemStatus.PENDING, expiry_date=TODAY + timedelta(days=60))
    assert rag_colour(state, TODAY) == RagColour.GREEN


# --------------------------------------------------------------------------- #
# ageing_bucket
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("days", "expected"),
    [(0, "0-7 days"), (7, "0-7 days"), (8, "8-15 days"), (15, "8-15 days"),
     (16, "16-30 days"), (30, "16-30 days"), (31, "30+ days")],
)
def test_ageing_bucket_boundaries(days: int, expected: str) -> None:
    assert ageing_bucket(days) == expected


# --------------------------------------------------------------------------- #
# compliance_index
# --------------------------------------------------------------------------- #
def test_compliance_index_weights_by_criticality() -> None:
    result = compliance_index([
        (ComplianceBucket.COMPLIED, "Critical"),   # 4
        (ComplianceBucket.EXPIRED, "High"),        # 3
        (ComplianceBucket.COMPLIED, "Medium"),     # 2
    ])
    assert result["total_weight"] == 9
    assert result["complied_weight"] == 6
    assert result["index"] == 66.7
    assert result["counted"] == 3
    assert result["complied"] == 2


@pytest.mark.parametrize(
    ("criticality", "weight"),
    [("Critical", 4), ("High", 3), ("Medium", 2), ("Low", 1)],
)
def test_each_criticality_weight(criticality: str, weight: int) -> None:
    assert compliance_index([(ComplianceBucket.COMPLIED, criticality)])["total_weight"] == weight


def test_not_applicable_items_leave_the_denominator() -> None:
    with_na = compliance_index([
        (ComplianceBucket.COMPLIED, "Critical"),
        (None, "Critical"),
        (None, "High"),
    ])
    assert with_na["counted"] == 1
    assert with_na["index"] == 100.0
    assert with_na["total_weight"] == 4


def test_empty_index_is_one_hundred() -> None:
    assert compliance_index([])["index"] == 100.0


def test_all_low_uncomplied_is_zero() -> None:
    result = compliance_index([
        (ComplianceBucket.PENDING, "Low"),
        (ComplianceBucket.OVERDUE, "Low"),
    ])
    assert result["index"] == 0.0
    assert result["total_weight"] == 2


# --------------------------------------------------------------------------- #
# status_counts
# --------------------------------------------------------------------------- #
def test_status_counts_tallies_every_bucket_plus_not_applicable() -> None:
    counts = status_counts([
        ComplianceBucket.COMPLIED,
        "Pending",
        ComplianceBucket.EXPIRED,
        None,
        None,
    ])
    assert counts == {
        "Complied": 1,
        "Under Process": 0,
        "Pending": 1,
        "Overdue": 0,
        "Expired": 1,
        "Not Applicable": 2,
    }


def test_the_shared_frozen_clock_matches_this_modules_today(frozen_today: date) -> None:
    """The conftest fixture and the module constant must not drift apart."""
    assert frozen_today == TODAY

    state = StatusInput(expiry_date=frozen_today + timedelta(days=120))
    assert derive_status(state, frozen_today) == DerivedStatus.VALID
    assert derive_status(state, frozen_today + timedelta(days=60)) == DerivedStatus.UPCOMING
