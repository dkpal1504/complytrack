"""Pure unit tests for the recurrence engine (``app.domain.recurrence``).

RT-03: closing one cycle generates the next. The interesting cases are the
month-end clamps, leap years and the financial-year anchoring.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.domain import recurrence
from app.domain.enums import RecurrenceKind


# --------------------------------------------------------------------------- #
# next_due_date
# --------------------------------------------------------------------------- #
def test_none_rule_produces_no_next_cycle() -> None:
    assert recurrence.next_due_date(RecurrenceKind.NONE, date(2026, 6, 15)) is None


def test_monthly_clamps_the_month_end() -> None:
    assert recurrence.next_due_date(RecurrenceKind.MONTHLY, date(2026, 1, 31)) == date(2026, 2, 28)


def test_monthly_honours_an_explicit_day_of_month() -> None:
    assert recurrence.next_due_date(
        RecurrenceKind.MONTHLY, date(2026, 1, 20), day=15
    ) == date(2026, 2, 15)


def test_monthly_across_a_year_boundary() -> None:
    assert recurrence.next_due_date(RecurrenceKind.MONTHLY, date(2026, 12, 15)) == date(2027, 1, 15)


def test_quarterly_clamps_the_month_end() -> None:
    assert recurrence.next_due_date(RecurrenceKind.QUARTERLY, date(2026, 1, 31)) == date(2026, 4, 30)


def test_quarterly_honours_an_explicit_day() -> None:
    assert recurrence.next_due_date(
        RecurrenceKind.QUARTERLY, date(2026, 1, 31), day=15
    ) == date(2026, 4, 15)


def test_half_yearly() -> None:
    assert recurrence.next_due_date(RecurrenceKind.HALF_YEARLY, date(2026, 3, 15)) == date(2026, 9, 15)


def test_annual_clamps_the_leap_day() -> None:
    assert recurrence.next_due_date(RecurrenceKind.ANNUAL, date(2024, 2, 29)) == date(2025, 2, 28)


def test_annual_from_a_clamped_february_stays_on_the_28th() -> None:
    assert recurrence.next_due_date(RecurrenceKind.ANNUAL, date(2027, 2, 28)) == date(2028, 2, 28)


def test_financial_year_annual_advances_to_the_next_fy_end() -> None:
    # 10-May-2026 sits in FY2026-27, whose end is 31-Mar-2027; the next is 2028.
    assert recurrence.next_due_date(
        RecurrenceKind.FY_ANNUAL, date(2026, 5, 10)
    ) == date(2028, 3, 31)


def test_interval_uses_the_configured_month_count() -> None:
    assert recurrence.next_due_date(
        RecurrenceKind.INTERVAL, date(2026, 1, 31), interval_months=18
    ) == date(2027, 7, 31)


def test_interval_defaults_to_twelve_months() -> None:
    assert recurrence.next_due_date(RecurrenceKind.INTERVAL, date(2026, 2, 28)) == date(2027, 2, 28)


def test_unknown_rule_is_rejected() -> None:
    with pytest.raises(ValueError):
        recurrence.next_due_date("weekly", date(2026, 1, 1))


# --------------------------------------------------------------------------- #
# period_for
# --------------------------------------------------------------------------- #
def test_period_for_monthly_is_the_whole_month() -> None:
    assert recurrence.period_for(RecurrenceKind.MONTHLY, date(2026, 6, 15)) == (
        date(2026, 6, 1),
        date(2026, 6, 30),
    )


def test_period_for_quarterly_spans_three_months() -> None:
    assert recurrence.period_for(RecurrenceKind.QUARTERLY, date(2026, 6, 30)) == (
        date(2026, 4, 1),
        date(2026, 6, 30),
    )


def test_period_for_annual_ends_on_the_due_date() -> None:
    assert recurrence.period_for(RecurrenceKind.ANNUAL, date(2026, 6, 30)) == (
        date(2025, 6, 1),
        date(2026, 6, 30),
    )


def test_period_for_financial_year_ends_on_31_march() -> None:
    assert recurrence.period_for(RecurrenceKind.FY_ANNUAL, date(2026, 6, 30)) == (
        date(2026, 4, 1),
        date(2027, 3, 31),
    )


# --------------------------------------------------------------------------- #
# cycle_label
# --------------------------------------------------------------------------- #
def test_cycle_labels() -> None:
    assert recurrence.cycle_label(RecurrenceKind.MONTHLY, date(2026, 6, 15)) == "Jun-2026"
    assert recurrence.cycle_label(RecurrenceKind.QUARTERLY, date(2026, 6, 30)) == "Q1 FY2026-27"
    assert recurrence.cycle_label(RecurrenceKind.QUARTERLY, date(2026, 3, 31)) == "Q4 FY2025-26"
    assert recurrence.cycle_label(RecurrenceKind.HALF_YEARLY, date(2026, 10, 15)) == "H2 FY2026-27"
    assert recurrence.cycle_label(RecurrenceKind.ANNUAL, date(2026, 6, 30)) == "FY2026-27"
    assert recurrence.cycle_label(RecurrenceKind.INTERVAL, date(2026, 6, 15)) == "15-Jun-2026"


# --------------------------------------------------------------------------- #
# cycles_between
# --------------------------------------------------------------------------- #
def test_cycles_between_month_end_walks_every_clamped_month() -> None:
    assert recurrence.cycles_between(
        RecurrenceKind.MONTHLY, date(2026, 1, 31), date(2026, 4, 30), day=31
    ) == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_cycles_between_stops_at_the_end_date() -> None:
    assert recurrence.cycles_between(
        RecurrenceKind.QUARTERLY, date(2026, 1, 1), date(2026, 12, 31)
    ) == [date(2026, 1, 1), date(2026, 4, 1), date(2026, 7, 1), date(2026, 10, 1)]


def test_cycles_between_for_a_one_off_rule_returns_the_start_only() -> None:
    assert recurrence.cycles_between(
        RecurrenceKind.NONE, date(2026, 1, 1), date(2026, 12, 31)
    ) == [date(2026, 1, 1)]
    assert recurrence.cycles_between(
        RecurrenceKind.NONE, date(2026, 6, 1), date(2026, 1, 1)
    ) == []
