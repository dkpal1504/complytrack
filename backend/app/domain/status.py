"""Derived status, dashboard buckets, RAG colour and the Compliance Index.

Business rules 1 and 2 of PRD Section 6 and requirement RT-05 / EX-04.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.domain.enums import (
    CRITICALITY_WEIGHT,
    Applicability,
    BucketDrill,
    ComplianceBucket,
    DerivedStatus,
    ItemStatus,
    RagColour,
)

DEFAULT_REMINDER_WINDOW_DAYS = 90
AMBER_WINDOW_DAYS = 30
# The "Due in next 30 days" card's window (PRD Section 7 KPI 5).
DUE_SOON_DAYS = 30

# Workflow states that mean "the obligation is satisfied for this cycle".
SATISFIED_STATES = {ItemStatus.CLOSED, ItemStatus.RENEWED}
OPEN_STATES = {ItemStatus.PENDING, ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED, ItemStatus.QUERY_RAISED}
IN_FLIGHT_STATES = {ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED, ItemStatus.QUERY_RAISED}
# Reminders never fire for these (business rule 7).
REMINDER_SUPPRESSED_STATES = {ItemStatus.CLOSED, ItemStatus.NOT_APPLICABLE, ItemStatus.ON_HOLD}


@dataclass(frozen=True, slots=True)
class StatusInput:
    """Everything the status rules need, so they stay pure and testable."""

    workflow_status: str = ItemStatus.PENDING
    applicability: str = Applicability.APPLICABLE
    expiry_date: date | None = None
    renewal_due_date: date | None = None
    internal_target_date: date | None = None
    due_date: date | None = None
    is_perpetual: bool = False
    renewal_in_process: bool = False
    reminder_window_days: int = DEFAULT_REMINDER_WINDOW_DAYS


def is_not_applicable(state: StatusInput) -> bool:
    return (
        state.applicability == Applicability.NOT_APPLICABLE
        or state.workflow_status == ItemStatus.NOT_APPLICABLE
    )


def has_no_expiry(state: StatusInput) -> bool:
    return state.is_perpetual or state.expiry_date is None


def derive_status(state: StatusInput, today: date) -> DerivedStatus:
    """RT-05 derived status driving the register chip and filters."""
    if is_not_applicable(state):
        return DerivedStatus.NOT_APPLICABLE

    # A closed or renewed cycle is compliant regardless of the old expiry date.
    if state.workflow_status in SATISFIED_STATES:
        return DerivedStatus.VALID

    if has_no_expiry(state):
        return DerivedStatus.PERPETUAL

    expiry = state.expiry_date
    assert expiry is not None

    if today > expiry:
        return DerivedStatus.EXPIRED

    if state.renewal_due_date is not None and today >= state.renewal_due_date:
        return DerivedStatus.DUE_FOR_RENEWAL

    if (expiry - today).days <= state.reminder_window_days:
        return DerivedStatus.UPCOMING

    return DerivedStatus.VALID


def compliance_bucket(state: StatusInput, today: date) -> ComplianceBucket | None:
    """How the item counts on the management dashboard (business rule 1).

    Returns ``None`` for Not Applicable items, which are excluded from the
    denominator of the Compliance Index.
    """
    if is_not_applicable(state):
        return None

    if state.workflow_status in SATISFIED_STATES:
        return ComplianceBucket.COMPLIED

    # RT-07: applied before expiry with an acknowledgement on file. Legally this
    # reads as compliant, so it counts on the Complied side of the index.
    if state.renewal_in_process:
        return ComplianceBucket.COMPLIED

    if has_no_expiry(state):
        return ComplianceBucket.COMPLIED

    assert state.expiry_date is not None
    if today > state.expiry_date:
        return ComplianceBucket.EXPIRED

    if state.workflow_status in IN_FLIGHT_STATES:
        return ComplianceBucket.UNDER_PROCESS

    # Still Pending: overdue once a deadline has slipped.
    deadlines = [d for d in (state.due_date, state.internal_target_date) if d is not None]
    if deadlines and today > min(deadlines):
        return ComplianceBucket.OVERDUE

    return ComplianceBucket.PENDING


def rag_colour(state: StatusInput, today: date) -> RagColour:
    """RAG chip colour. Always paired with an icon and text for colour-blind safety."""
    if is_not_applicable(state):
        return RagColour.GREY

    bucket = compliance_bucket(state, today)
    if bucket in (ComplianceBucket.EXPIRED, ComplianceBucket.OVERDUE):
        return RagColour.RED
    if state.workflow_status in SATISFIED_STATES:
        return RagColour.GREEN

    days_left = countdown(state.expiry_date, today)
    if days_left is not None and days_left <= AMBER_WINDOW_DAYS:
        return RagColour.AMBER
    if bucket == ComplianceBucket.UNDER_PROCESS:
        return RagColour.AMBER if days_left is not None and days_left <= 90 else RagColour.GREEN
    return RagColour.GREEN


def countdown(target: date | None, today: date) -> int | None:
    return None if target is None else (target - today).days


def matches_drill(
    bucket: ComplianceBucket | None,
    expiry_date: date | None,
    today: date,
    drill: str,
) -> bool:
    """Whether an item is one of the rows a management KPI card counts.

    AC-5 requires the card's number and the register list it opens to agree
    exactly. The only way to guarantee that is for both to call this function
    rather than each re-expressing the rule: one definition, applied to the
    same rows on both sides.

    ``ALL`` is the "Total active obligations" card, whose denominator excludes
    Not Applicable items — the same exclusion the Compliance Index makes.
    """
    if bucket is None:
        return False
    if drill == BucketDrill.ALL:
        return True
    if drill == BucketDrill.DUE_30:
        # "Due in next 30 days": expiring within the window and not already
        # settled. An item that has complied is not due for anything.
        days_left = countdown(expiry_date, today)
        return (
            days_left is not None
            and 0 <= days_left <= DUE_SOON_DAYS
            and bucket != ComplianceBucket.COMPLIED
        )
    return bucket.value == drill


def ageing_bucket(days_pending: int) -> str:
    """RP-05 ageing buckets."""
    if days_pending <= 7:
        return "0-7 days"
    if days_pending <= 15:
        return "8-15 days"
    if days_pending <= 30:
        return "16-30 days"
    return "30+ days"


def compliance_index(
    entries: list[tuple[ComplianceBucket | None, str]],
) -> dict[str, float | int]:
    """Weighted Compliance Index (EX-04, Section 7.1 KPI 8).

    ``entries`` is a list of (bucket, criticality). Not Applicable items are
    dropped from both numerator and denominator.
    """
    counted = [(b, c) for b, c in entries if b is not None]
    total_weight = sum(CRITICALITY_WEIGHT.get(c, 1) for _, c in counted)
    complied_weight = sum(
        CRITICALITY_WEIGHT.get(c, 1) for b, c in counted if b == ComplianceBucket.COMPLIED
    )
    index = (complied_weight / total_weight * 100) if total_weight else 100.0
    return {
        "index": round(index, 1),
        "counted": len(counted),
        "complied": sum(1 for b, _ in counted if b == ComplianceBucket.COMPLIED),
        "total_weight": total_weight,
        "complied_weight": complied_weight,
    }


def status_counts(entries: list[ComplianceBucket | str | None]) -> dict[str, int]:
    """Bucket tallies, including an explicit ``not_applicable`` count.

    Accepts either the enum member or its string value, because the dashboards
    serialise buckets to strings before tallying them.
    """
    counts = {b.value: 0 for b in ComplianceBucket}
    not_applicable = 0
    for bucket in entries:
        if bucket is None:
            not_applicable += 1
        else:
            counts[ComplianceBucket(bucket).value] += 1
    counts["Not Applicable"] = not_applicable
    return counts
