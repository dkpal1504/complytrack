"""The date engine (PRD Section 6, business rule 2).

Pure functions, no database, no clock — every routine takes the dates it needs
as arguments so the edge cases (month-end, leap year, financial-year anchors,
holiday shift) are cheap to test exhaustively.

    Expiry            = IssueDate + Validity          (unless entered directly)
    RenewalDueDate    = Expiry - AuthorityProcessingDays
    InternalTargetDate= RenewalDueDate - InternalPrepDays
"""

from __future__ import annotations

import calendar
from datetime import date, datetime, time, timedelta, timezone

from app.domain.enums import ValidityUnit

IST = timezone(timedelta(hours=5, minutes=30))


# --------------------------------------------------------------------------- #
# Calendar primitives
# --------------------------------------------------------------------------- #
def add_months(value: date, months: int) -> date:
    """Add calendar months, clamping to the last valid day of the target month.

    31-Jan + 1 month -> 28-Feb (29 in a leap year), never 3-Mar.
    """
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def add_years(value: date, years: int) -> date:
    """Add years, clamping 29-Feb to 28-Feb in a non-leap target year."""
    year = value.year + years
    day = value.day
    if value.month == 2 and value.day == 29 and not calendar.isleap(year):
        day = 28
    return date(year, value.month, day)


def end_of_financial_year(value: date, fy_start_month: int = 4) -> date:
    """Last day of the financial year containing ``value`` (Apr-Mar default).

    01-Apr-2026 -> 31-Mar-2027; 15-Feb-2027 (still FY2026-27) -> 31-Mar-2027.
    """
    if value.month >= fy_start_month:
        end_year = value.year + 1
    else:
        end_year = value.year
    month_before = fy_start_month - 1 or 12
    year_of_month = end_year if fy_start_month > 1 else end_year - 1
    day = calendar.monthrange(year_of_month, month_before)[1]
    return date(year_of_month, month_before, day)


def financial_year_label(value: date, fy_start_month: int = 4) -> str:
    """'FY2026-27' for the financial year containing ``value``."""
    if value.month >= fy_start_month:
        start_year = value.year
    else:
        start_year = value.year - 1
    return f"FY{start_year}-{str(start_year + 1)[-2:]}"


def is_weekend(value: date) -> bool:
    return value.weekday() >= 5


def is_working_day(value: date, holidays: set[date] | frozenset[date] | None = None) -> bool:
    if is_weekend(value):
        return False
    return not (holidays and value in holidays)


def next_working_day(
    value: date, holidays: set[date] | frozenset[date] | None = None
) -> date:
    """First working day on or after ``value`` (RT-04)."""
    candidate = value
    # 10 days is far beyond any real weekend/holiday cluster; guards a hung loop.
    for _ in range(10):
        if is_working_day(candidate, holidays):
            return candidate
        candidate += timedelta(days=1)
    return candidate


def add_working_days(
    value: date, days: int, holidays: set[date] | frozenset[date] | None = None
) -> date:
    """Advance ``days`` working days from ``value`` (negative walks backwards)."""
    step = 1 if days >= 0 else -1
    remaining = abs(days)
    candidate = value
    while remaining:
        candidate += timedelta(days=step)
        if is_working_day(candidate, holidays):
            remaining -= 1
    return candidate


def countdown_days(target: date | None, today: date) -> int | None:
    """Signed days from ``today`` to ``target``; negative means overdue."""
    if target is None:
        return None
    return (target - today).days


# --------------------------------------------------------------------------- #
# Validity / expiry
# --------------------------------------------------------------------------- #
def compute_expiry(
    issue_date: date | None,
    validity_value: int | None,
    validity_unit: str,
    *,
    fy_start_month: int = 4,
    fixed_month: int | None = None,
    fixed_day: int | None = None,
) -> date | None:
    """Derive the expiry date from an issue date and a validity period.

    A validity period is **inclusive of its first day**: something issued on
    01-Apr-2026 and valid for 12 months is in force through 31-Mar-2027, not
    until 01-Apr-2027. That is what AC-1 of the PRD asserts and what "valid for
    twelve months from 1 April" means to the people who hold these licences, so
    the day count added is one day short of the anniversary.

    Units that name their own end date (end of financial year, end of calendar
    year, a fixed annual date) are already end-dated and take no adjustment.
    """
    if validity_unit == ValidityUnit.NONE:
        return None
    if issue_date is None:
        return None

    if validity_unit == ValidityUnit.DAYS:
        return _inclusive_end(issue_date, issue_date + timedelta(days=validity_value or 0))
    if validity_unit == ValidityUnit.MONTHS:
        return _inclusive_end(issue_date, add_months(issue_date, validity_value or 0))
    if validity_unit == ValidityUnit.YEARS:
        return _inclusive_end(issue_date, add_years(issue_date, validity_value or 0))
    if validity_unit == ValidityUnit.EOFY:
        # "Valid until end of financial year" — add any whole years first.
        return end_of_financial_year(add_years(issue_date, validity_value or 0), fy_start_month)
    if validity_unit == ValidityUnit.EOCY:
        return date(issue_date.year + (validity_value or 0), 12, 31)
    if validity_unit == ValidityUnit.FIXED_ANNUAL:
        month = fixed_month or issue_date.month
        day = fixed_day or issue_date.day
        day = min(day, calendar.monthrange(issue_date.year, month)[1])
        candidate = date(issue_date.year, month, day)
        # The fixed date must fall after the issue date; else take next year's.
        if candidate <= issue_date:
            year = issue_date.year + 1 + (validity_value or 0)
            day = min(fixed_day or issue_date.day, calendar.monthrange(year, month)[1])
            candidate = date(year, month, day)
        return add_years(candidate, validity_value or 0)
    raise ValueError(f"Unknown validity unit: {validity_unit!r}")


def _inclusive_end(issue_date: date, period_end: date) -> date:
    """Step back a day so the period covers its start date too.

    A zero-length or backwards period would otherwise expire before it was
    issued, which no real licence does, so those are left alone.
    """
    if period_end <= issue_date:
        return period_end
    return period_end - timedelta(days=1)


def compute_renewal_due_date(expiry_date: date | None, authority_processing_days: int) -> date | None:
    """RT-02: start the renewal this many days before expiry."""
    if expiry_date is None:
        return None
    return expiry_date - timedelta(days=authority_processing_days)


def compute_internal_target_date(renewal_due_date: date | None, internal_prep_days: int) -> date | None:
    """RT-02: the "start renewal by" date shown on the dashboard."""
    if renewal_due_date is None:
        return None
    return renewal_due_date - timedelta(days=internal_prep_days)


def compute_dates(
    *,
    issue_date: date | None,
    validity_value: int | None,
    validity_unit: str,
    authority_processing_days: int = 0,
    internal_prep_days: int = 0,
    explicit_expiry: date | None = None,
    fy_start_month: int = 4,
    fixed_month: int | None = None,
    fixed_day: int | None = None,
) -> dict[str, date | None]:
    """One call returning expiry, renewal-due and internal-target dates.

    An explicitly entered expiry always wins (RT-01).
    """
    expiry = explicit_expiry or compute_expiry(
        issue_date,
        validity_value,
        validity_unit,
        fy_start_month=fy_start_month,
        fixed_month=fixed_month,
        fixed_day=fixed_day,
    )
    renewal_due = compute_renewal_due_date(expiry, authority_processing_days)
    internal_target = compute_internal_target_date(renewal_due, internal_prep_days)
    return {
        "expiry_date": expiry,
        "renewal_due_date": renewal_due,
        "internal_target_date": internal_target,
    }


def reminder_anchor_date(
    *,
    anchor_on: str,
    expiry_date: date | None,
    renewal_due_date: date | None,
    statutory_due_date: date | None,
) -> date | None:
    """Which date the reminder offsets count back from (business rule 2).

    Licences anchor on the renewal-due date so that "30 days before" still
    leaves the authority's processing time. Filings anchor on the statutory
    due date.
    """
    if anchor_on == "expiry":
        return expiry_date
    if anchor_on == "statutory_due":
        return statutory_due_date or renewal_due_date
    return renewal_due_date or expiry_date or statutory_due_date


# --------------------------------------------------------------------------- #
# Time-zone helpers (NFR: display IST, store UTC)
# --------------------------------------------------------------------------- #
def to_ist(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(IST)


def ist_today(now: datetime | None = None) -> date:
    """The current date in IST — reminders must not fire on the wrong day."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(IST).date()


def ist_day_start(day: date) -> datetime:
    """Midnight IST on ``day``, as the UTC instant the database stores.

    A calendar day in this establishment is an IST one: the day every screen
    counts in, renders in and filters by. Filtering a UTC column with a bare
    midnight would filter 05:30-to-05:30 instead, so a row recorded at 02:00
    IST would fall out of its own day and into the day before.
    """
    return datetime.combine(day, time.min, tzinfo=IST).astimezone(timezone.utc)


def format_ist(value: datetime | None) -> str:
    if value is None:
        return ""
    return to_ist(value).strftime("%d-%b-%Y %H:%M IST")
