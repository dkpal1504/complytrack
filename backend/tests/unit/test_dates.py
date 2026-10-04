"""Pure unit tests for the date engine (``app.domain.dates``).

Covers PRD Section 14: validity/expiry calculation and the working-day /
financial-year arithmetic, plus the IST conversion that decides which calendar
day a reminder belongs to.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from app.domain import dates
from app.domain.enums import ValidityUnit

UTC = timezone.utc


# --------------------------------------------------------------------------- #
# Calendar primitives
# --------------------------------------------------------------------------- #
def test_add_months_clamps_to_month_end() -> None:
    assert dates.add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)


def test_add_months_clamps_to_leap_february() -> None:
    assert dates.add_months(date(2024, 1, 31), 1) == date(2024, 2, 29)


def test_add_months_rolls_backwards_across_the_year() -> None:
    assert dates.add_months(date(2026, 3, 31), -1) == date(2026, 2, 28)
    assert dates.add_months(date(2026, 11, 30), 3) == date(2027, 2, 28)


def test_add_months_keeps_the_day_when_it_exists() -> None:
    assert dates.add_months(date(2026, 6, 15), 12) == date(2027, 6, 15)


def test_add_years_clamps_the_leap_day() -> None:
    assert dates.add_years(date(2024, 2, 29), 1) == date(2025, 2, 28)
    assert dates.add_years(date(2024, 2, 29), 4) == date(2028, 2, 29)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (date(2026, 4, 1), date(2027, 3, 31)),
        (date(2027, 2, 15), date(2027, 3, 31)),
        (date(2026, 3, 31), date(2026, 3, 31)),
    ],
)
def test_end_of_financial_year(value: date, expected: date) -> None:
    assert dates.end_of_financial_year(value) == expected


def test_financial_year_label() -> None:
    assert dates.financial_year_label(date(2026, 4, 1)) == "FY2026-27"
    assert dates.financial_year_label(date(2026, 3, 31)) == "FY2025-26"


def test_is_weekend() -> None:
    assert dates.is_weekend(date(2026, 10, 3)) is True   # Saturday
    assert dates.is_weekend(date(2026, 10, 5)) is False  # Monday


def test_holiday_is_not_a_working_day() -> None:
    holiday = date(2026, 1, 26)  # a Monday
    assert dates.is_working_day(holiday) is True
    assert dates.is_working_day(holiday, {holiday}) is False


def test_next_working_day_skips_the_weekend() -> None:
    assert dates.next_working_day(date(2026, 10, 3)) == date(2026, 10, 5)
    assert dates.next_working_day(date(2026, 10, 5)) == date(2026, 10, 5)


def test_add_working_days_forwards_and_backwards() -> None:
    assert dates.add_working_days(date(2026, 10, 2), 1) == date(2026, 10, 5)
    assert dates.add_working_days(date(2026, 10, 5), -1) == date(2026, 10, 2)


def test_countdown_days() -> None:
    assert dates.countdown_days(date(2026, 10, 10), date(2026, 10, 3)) == 7
    assert dates.countdown_days(date(2026, 9, 30), date(2026, 10, 3)) == -3
    assert dates.countdown_days(None, date(2026, 10, 3)) is None


# --------------------------------------------------------------------------- #
# Validity / expiry
# --------------------------------------------------------------------------- #
def test_compute_expiry_in_months_clamps_the_month_end() -> None:
    # The period covers its first day, so a 1-month validity from 31 Jan ends
    # the day before the (clamped) anniversary.
    assert dates.compute_expiry(date(2026, 1, 31), 1, ValidityUnit.MONTHS) == date(2026, 2, 27)


def test_compute_expiry_in_days() -> None:
    # 30 days from 1 Jan covers 1–30 Jan inclusive; the 31st is day 31.
    assert dates.compute_expiry(date(2026, 1, 1), 30, ValidityUnit.DAYS) == date(2026, 1, 30)


def test_compute_expiry_in_years_clamps_the_leap_day() -> None:
    assert dates.compute_expiry(date(2024, 2, 29), 1, ValidityUnit.YEARS) == date(2025, 2, 27)


def test_compute_expiry_covers_its_first_day() -> None:
    """AC-1: 12 months from 01-Apr-2026 expires 31-Mar-2027, not 01-Apr-2027."""
    assert dates.compute_expiry(date(2026, 4, 1), 12, ValidityUnit.MONTHS) == date(2027, 3, 31)


def test_compute_expiry_never_precedes_the_issue_date() -> None:
    # A degenerate period must not produce an expiry before the issue date.
    assert dates.compute_expiry(date(2026, 4, 1), 0, ValidityUnit.MONTHS) == date(2026, 4, 1)
    assert dates.compute_expiry(date(2026, 4, 1), 0, ValidityUnit.DAYS) == date(2026, 4, 1)


def test_compute_expiry_end_of_financial_year() -> None:
    assert dates.compute_expiry(date(2026, 4, 1), 0, ValidityUnit.EOFY) == date(2027, 3, 31)


def test_compute_expiry_end_of_calendar_year() -> None:
    assert dates.compute_expiry(date(2026, 5, 5), 0, ValidityUnit.EOCY) == date(2026, 12, 31)
    assert dates.compute_expiry(date(2026, 5, 5), 1, ValidityUnit.EOCY) == date(2027, 12, 31)


def test_compute_expiry_fixed_annual_rolls_to_next_year_when_passed() -> None:
    assert dates.compute_expiry(
        date(2026, 5, 5), 0, ValidityUnit.FIXED_ANNUAL, fixed_month=6, fixed_day=30
    ) == date(2026, 6, 30)
    assert dates.compute_expiry(
        date(2026, 7, 1), 0, ValidityUnit.FIXED_ANNUAL, fixed_month=6, fixed_day=30
    ) == date(2027, 6, 30)


def test_compute_expiry_without_an_issue_date_is_none() -> None:
    assert dates.compute_expiry(None, 12, ValidityUnit.MONTHS) is None


def test_compute_expiry_honours_the_no_expiry_unit() -> None:
    assert dates.compute_expiry(date(2026, 1, 1), 12, ValidityUnit.NONE) is None


def test_compute_expiry_rejects_an_unknown_unit() -> None:
    with pytest.raises(ValueError):
        dates.compute_expiry(date(2026, 1, 1), 12, "fortnightly")


def test_renewal_and_internal_target_are_offset_backwards() -> None:
    assert dates.compute_renewal_due_date(date(2026, 10, 1), 15) == date(2026, 9, 16)
    assert dates.compute_internal_target_date(date(2026, 9, 16), 15) == date(2026, 9, 1)
    assert dates.compute_renewal_due_date(None, 15) is None
    assert dates.compute_internal_target_date(None, 15) is None


def test_compute_dates_prefers_an_explicit_expiry() -> None:
    computed = dates.compute_dates(
        issue_date=date(2026, 1, 1),
        validity_value=5,
        validity_unit=ValidityUnit.YEARS,
        authority_processing_days=30,
        internal_prep_days=10,
        explicit_expiry=date(2026, 6, 30),
    )
    assert computed == {
        "expiry_date": date(2026, 6, 30),
        "renewal_due_date": date(2026, 5, 31),
        "internal_target_date": date(2026, 5, 21),
    }


def test_compute_dates_derives_from_validity_when_no_expiry_is_entered() -> None:
    computed = dates.compute_dates(
        issue_date=date(2026, 4, 1),
        validity_value=12,
        validity_unit=ValidityUnit.MONTHS,
        authority_processing_days=30,
        internal_prep_days=15,
    )
    assert computed["expiry_date"] == date(2027, 3, 31)
    assert computed["renewal_due_date"] == date(2027, 3, 1)
    assert computed["internal_target_date"] == date(2027, 2, 14)


# --------------------------------------------------------------------------- #
# Reminder anchor
# --------------------------------------------------------------------------- #
def test_reminder_anchor_respects_the_configured_anchor() -> None:
    expiry, renewal, statutory = date(2026, 12, 31), date(2026, 12, 1), date(2026, 11, 15)
    assert dates.reminder_anchor_date(
        anchor_on="expiry", expiry_date=expiry,
        renewal_due_date=renewal, statutory_due_date=statutory,
    ) == expiry
    assert dates.reminder_anchor_date(
        anchor_on="statutory_due", expiry_date=expiry,
        renewal_due_date=renewal, statutory_due_date=statutory,
    ) == statutory
    assert dates.reminder_anchor_date(
        anchor_on="renewal_due_date", expiry_date=expiry,
        renewal_due_date=renewal, statutory_due_date=statutory,
    ) == renewal


def test_reminder_anchor_falls_back_when_the_preferred_date_is_missing() -> None:
    expiry = date(2026, 12, 31)
    # "statutory_due" falls back to the renewal-due date, and "statutory_due" /
    # "renewal_due_date" never fall back to the expiry date.
    assert dates.reminder_anchor_date(
        anchor_on="statutory_due", expiry_date=expiry,
        renewal_due_date=date(2026, 12, 1), statutory_due_date=None,
    ) == date(2026, 12, 1)
    assert dates.reminder_anchor_date(
        anchor_on="statutory_due", expiry_date=expiry,
        renewal_due_date=None, statutory_due_date=None,
    ) is None
    # The default branch falls back renewal-due -> expiry -> statutory-due.
    assert dates.reminder_anchor_date(
        anchor_on="renewal_due_date", expiry_date=expiry,
        renewal_due_date=None, statutory_due_date=None,
    ) == expiry
    assert dates.reminder_anchor_date(
        anchor_on="renewal_due_date", expiry_date=None,
        renewal_due_date=None, statutory_due_date=None,
    ) is None


# --------------------------------------------------------------------------- #
# IST conversion
# --------------------------------------------------------------------------- #
def test_to_ist_shifts_utc_by_five_and_a_half_hours() -> None:
    converted = dates.to_ist(datetime(2026, 1, 1, 0, 0, tzinfo=UTC))
    assert converted.hour == 5 and converted.minute == 30
    assert converted.utcoffset() == timedelta(hours=5, minutes=30)


def test_to_ist_treats_a_naive_timestamp_as_utc() -> None:
    assert dates.to_ist(datetime(2026, 1, 1, 0, 0)) == dates.to_ist(
        datetime(2026, 1, 1, 0, 0, tzinfo=UTC)
    )


def test_ist_today_rolls_over_at_ist_midnight() -> None:
    # 18:00 UTC is 23:30 IST the same day; 19:00 UTC is 00:30 IST the next day.
    assert dates.ist_today(datetime(2026, 1, 1, 18, 0, tzinfo=UTC)) == date(2026, 1, 1)
    assert dates.ist_today(datetime(2026, 1, 1, 19, 0, tzinfo=UTC)) == date(2026, 1, 2)


def test_ist_today_accepts_a_naive_timestamp() -> None:
    assert dates.ist_today(datetime(2026, 1, 1, 19, 0)) == date(2026, 1, 2)


def test_format_ist() -> None:
    assert dates.format_ist(None) == ""
    assert dates.format_ist(datetime(2026, 1, 1, 6, 15, tzinfo=UTC)) == "01-Jan-2026 11:45 IST"
