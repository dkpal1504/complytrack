"""Pure unit tests for the escalation matrix and reminder windows.

OW-04 (escalation ladder) and RM-01/RM-03 (which offset fires today, who is
notified at each level).
"""

from __future__ import annotations

import pytest

from app.domain.enums import Criticality, ItemStatus
from app.domain.escalation import (
    CRITICALITY_LEVEL_BUMP,
    DEFAULT_MATRIX,
    current_level,
    is_post_expiry,
    level_label,
    notify_roles_for,
    offset_label,
    offsets_for_today,
    recipients_for_offset,
    role_display,
)

OFFSETS = [90, 60, 30, 15, 7, 0]


# --------------------------------------------------------------------------- #
# current_level
# --------------------------------------------------------------------------- #
def test_far_out_item_sits_at_level_zero() -> None:
    assert current_level(days_to_anchor=120, workflow_status=ItemStatus.PENDING) == 0


def test_ninety_days_out_fires_level_zero() -> None:
    assert current_level(days_to_anchor=90, workflow_status=ItemStatus.PENDING) == 0


def test_fifteen_days_out_escalates_to_the_department_head() -> None:
    assert current_level(days_to_anchor=15, workflow_status=ItemStatus.PENDING) == 1


def test_fifteen_days_out_does_not_escalate_a_query_raised_item() -> None:
    # Level 1 only applies while the item is still Pending.
    assert current_level(days_to_anchor=15, workflow_status=ItemStatus.QUERY_RAISED) == 0


def test_seven_days_out_notifies_the_unit_head_and_compliance() -> None:
    assert current_level(days_to_anchor=7, workflow_status=ItemStatus.PENDING) == 2
    assert current_level(days_to_anchor=7, workflow_status=ItemStatus.QUERY_RAISED) == 2


def test_seven_days_out_does_not_fire_for_an_under_process_item() -> None:
    assert current_level(days_to_anchor=7, workflow_status=ItemStatus.UNDER_PROCESS) == 0


def test_on_the_anchor_date_is_overdue() -> None:
    assert current_level(days_to_anchor=0, workflow_status=ItemStatus.PENDING) == 3


@pytest.mark.parametrize("days_overdue", [1, 6])
def test_between_one_and_six_days_overdue_is_level_three(days_overdue: int) -> None:
    assert current_level(
        days_to_anchor=-days_overdue, workflow_status=ItemStatus.PENDING
    ) == 3


@pytest.mark.parametrize("days_overdue", [7, 30])
def test_seven_days_overdue_reaches_the_director(days_overdue: int) -> None:
    assert current_level(
        days_to_anchor=-days_overdue, workflow_status=ItemStatus.PENDING
    ) == 4


def test_critical_items_are_bumped_one_level_past_the_anchor() -> None:
    assert current_level(
        days_to_anchor=-1, workflow_status=ItemStatus.PENDING, criticality=Criticality.CRITICAL
    ) == 4


def test_low_items_are_softened_one_level_past_the_anchor() -> None:
    assert current_level(
        days_to_anchor=-1, workflow_status=ItemStatus.PENDING, criticality=Criticality.LOW
    ) == 2


def test_criticality_bump_only_applies_once_a_level_three_trigger_has_fired() -> None:
    # 15 days out is level 1; a Critical item does not jump to level 2 from that.
    assert current_level(
        days_to_anchor=15, workflow_status=ItemStatus.PENDING, criticality=Criticality.CRITICAL
    ) == 1


def test_escalation_never_de_escalates_below_the_recorded_level() -> None:
    assert current_level(
        days_to_anchor=120, workflow_status=ItemStatus.PENDING, already_at_level=4
    ) == 4


def test_the_matrix_is_not_filtered_by_criticality() -> None:
    # Guard: the ladder is fixed today; only the level bump varies by criticality.
    assert set(CRITICALITY_LEVEL_BUMP) == {
        Criticality.CRITICAL, Criticality.HIGH, Criticality.MEDIUM, Criticality.LOW,
    }
    assert len(DEFAULT_MATRIX) == 5


# --------------------------------------------------------------------------- #
# notify_roles_for / level_label
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("level", "roles"),
    [
        (0, ("owner",)),
        (1, ("owner", "department_head")),
        (2, ("owner", "department_head", "unit_head", "compliance")),
        (3, ("unit_head", "plant_head", "management")),
        (4, ("plant_head", "management", "director")),
    ],
)
def test_notify_roles_per_level(level: int, roles: tuple[str, ...]) -> None:
    assert notify_roles_for(level) == roles


def test_unknown_level_falls_back_to_the_owner() -> None:
    assert notify_roles_for(99) == ("owner",)


def test_level_labels() -> None:
    assert level_label(0) == "Reminder to owner"
    assert level_label(3) == "Plant Head / Management notified - overdue"
    assert level_label(4) == "Director / CEO notified - critical overdue"
    assert level_label(99) == "No escalation"


# --------------------------------------------------------------------------- #
# offsets_for_today
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("days_to_anchor", [90, 60, 30, 15, 7, 0])
def test_an_exact_offset_day_fires(days_to_anchor: int) -> None:
    assert offsets_for_today(days_to_anchor=days_to_anchor, offsets=OFFSETS) == days_to_anchor


@pytest.mark.parametrize("days_to_anchor", [89, 45, 31, 1])
def test_a_non_offset_day_fires_nothing(days_to_anchor: int) -> None:
    assert offsets_for_today(days_to_anchor=days_to_anchor, offsets=OFFSETS) is None


def test_an_already_sent_offset_is_not_repeated() -> None:
    assert offsets_for_today(
        days_to_anchor=30, offsets=OFFSETS, already_sent_offsets={30}
    ) is None


def test_post_expiry_reminders_follow_the_configured_frequency() -> None:
    assert offsets_for_today(days_to_anchor=-2, offsets=OFFSETS, post_expiry_frequency_days=2) == -2
    assert offsets_for_today(days_to_anchor=-4, offsets=OFFSETS, post_expiry_frequency_days=2) == -4
    assert offsets_for_today(days_to_anchor=-1, offsets=OFFSETS, post_expiry_frequency_days=2) is None
    assert offsets_for_today(days_to_anchor=-3, offsets=OFFSETS, post_expiry_frequency_days=2) is None


def test_daily_post_expiry_frequency_fires_every_day() -> None:
    for overdue in (1, 2, 3, 10):
        assert offsets_for_today(
            days_to_anchor=-overdue, offsets=OFFSETS, post_expiry_frequency_days=1
        ) == -overdue


def test_a_zero_frequency_is_treated_as_one_day() -> None:
    assert offsets_for_today(
        days_to_anchor=-3, offsets=OFFSETS, post_expiry_frequency_days=0
    ) == -3


def test_is_post_expiry_and_offset_labels() -> None:
    assert is_post_expiry(-2) is True
    assert is_post_expiry(0) is False
    assert is_post_expiry(15) is False

    assert offset_label(0) == "on the due date"
    assert offset_label(15) == "15 days before"
    assert offset_label(-5) == "5 days overdue"


# --------------------------------------------------------------------------- #
# recipients_for_offset
# --------------------------------------------------------------------------- #
def _recipients(offset: int, **overrides) -> list[str]:
    kwargs = {
        "owner_id": "owner-1",
        "delegate_id": "delegate-1",
        "department_head_id": "dept-head-1",
        "unit_head_id": "unit-head-1",
        "compliance_ids": ["comp-1", "comp-2"],
        "management_ids": ["mgmt-1"],
    }
    kwargs.update(overrides)
    return recipients_for_offset(
        offset=offset, recipients_by_offset={}, **kwargs
    )


def test_post_expiry_widens_the_audience_to_management() -> None:
    assert _recipients(-2) == [
        "owner-1", "delegate-1", "dept-head-1", "unit-head-1",
        "comp-1", "comp-2", "mgmt-1",
    ]


def test_late_offsets_narrow_to_owner_and_delegate() -> None:
    assert _recipients(60) == ["owner-1", "delegate-1"]


def test_thirty_day_offset_includes_compliance() -> None:
    assert _recipients(30) == ["owner-1", "delegate-1", "comp-1", "comp-2"]


def test_fifteen_day_offset_includes_the_department_head() -> None:
    assert _recipients(15) == ["owner-1", "delegate-1", "dept-head-1", "comp-1", "comp-2"]


def test_zero_offset_includes_the_unit_head_but_not_management() -> None:
    assert _recipients(0) == [
        "owner-1", "delegate-1", "dept-head-1", "unit-head-1", "comp-1", "comp-2",
    ]


def test_an_explicit_profile_mapping_overrides_the_default_ladder() -> None:
    recipients = recipients_for_offset(
        offset=30,
        recipients_by_offset={"30": ["compliance"]},
        owner_id="owner-1",
        delegate_id=None,
        department_head_id=None,
        unit_head_id=None,
        compliance_ids=["comp-1"],
        management_ids=[],
    )
    assert recipients == ["comp-1"]


def test_missing_user_ids_are_dropped_and_duplicates_collapse() -> None:
    recipients = recipients_for_offset(
        offset=60,  # owner + delegate only
        recipients_by_offset={},
        owner_id="same-person",
        delegate_id="same-person",
        department_head_id=None,
        unit_head_id=None,
        compliance_ids=[],
        management_ids=[],
    )
    assert recipients == ["same-person"]


def test_role_display_names() -> None:
    assert role_display("plant_head") == "Plant Head"
    assert role_display("director") == "Director / CEO"
    assert role_display("field_engineer") == "Field Engineer"
