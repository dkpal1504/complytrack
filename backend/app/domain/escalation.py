"""Escalation matrix (OW-04) and reminder scheduling windows (RM-01).

Pure decision functions: give them the numbers, they return who to notify and
at what level. The service layer turns that into logs, mail and notifications.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.enums import Criticality, ItemStatus, Role


@dataclass(frozen=True, slots=True)
class EscalationLevel:
    level: int
    trigger_days: int           # measured against the anchor date
    trigger_direction: str      # "before" | "after"
    status_condition: tuple[str, ...]
    notify_roles: tuple[str, ...]
    label: str


# Default matrix from OW-04.
DEFAULT_MATRIX: tuple[EscalationLevel, ...] = (
    EscalationLevel(0, 90, "before", (), ("owner",), "Reminder to owner"),
    EscalationLevel(1, 15, "before", (ItemStatus.PENDING,),
                    ("owner", "department_head"), "Department Head notified"),
    EscalationLevel(2, 7, "before",
                    (ItemStatus.PENDING, ItemStatus.QUERY_RAISED),
                    ("owner", "department_head", "unit_head", "compliance"),
                    "Unit Head and Compliance Team notified"),
    EscalationLevel(3, 0, "after", (), ("unit_head", "plant_head", "management"),
                    "Plant Head / Management notified - overdue"),
    EscalationLevel(4, 7, "after", (), ("plant_head", "management", "director"),
                    "Director / CEO notified - critical overdue"),
)

# Critical items skip the softer levels: the clock is halved (business rule 6
# allows calendar-day timers; this keeps critical exposure visible early).
CRITICALITY_LEVEL_BUMP: dict[str, int] = {
    Criticality.CRITICAL: 1,
    Criticality.HIGH: 0,
    Criticality.MEDIUM: 0,
    Criticality.LOW: -1,
}


def _levels_for(criticality: str) -> list[EscalationLevel]:
    return list(DEFAULT_MATRIX)


def current_level(
    *,
    days_to_anchor: int,
    workflow_status: str,
    criticality: str = Criticality.MEDIUM,
    already_at_level: int = 0,
) -> int:
    """The highest escalation level whose trigger has fired.

    ``days_to_anchor`` is signed: negative means the anchor date has passed.
    """
    level = 0
    bump = CRITICALITY_LEVEL_BUMP.get(criticality, 0)
    for rule in _levels_for(criticality):
        if rule.trigger_direction == "before":
            fired = days_to_anchor <= rule.trigger_days and days_to_anchor >= 0
        else:
            fired = days_to_anchor <= -rule.trigger_days
        if not fired:
            continue
        if rule.status_condition and workflow_status not in rule.status_condition:
            continue
        level = max(level, rule.level)

    if level >= 3 and bump:
        level = min(level + bump, 4)
    return max(level, already_at_level)


def notify_roles_for(level: int) -> tuple[str, ...]:
    for rule in DEFAULT_MATRIX:
        if rule.level == level:
            return rule.notify_roles
    return ("owner",)


def level_label(level: int) -> str:
    for rule in DEFAULT_MATRIX:
        if rule.level == level:
            return rule.label
    return "No escalation"


# --------------------------------------------------------------------------- #
# Reminder windows
# --------------------------------------------------------------------------- #
def offsets_for_today(
    *,
    days_to_anchor: int,
    offsets: list[int],
    post_expiry_frequency_days: int = 2,
    already_sent_offsets: set[int] | None = None,
) -> int | None:
    """Which offset reminder is due today, if any.

    Returns the offset to send (0 = "on the day"), or ``None``. Idempotency is
    the caller's job via the ``reminder_log`` dedupe key, but returning a single
    offset per run keeps the semantics obvious.
    """
    already_sent = already_sent_offsets or set()

    if days_to_anchor >= 0:
        # Exact-day match on the configured offsets.
        if days_to_anchor in offsets and days_to_anchor not in already_sent:
            return days_to_anchor
        return None

    overdue_days = -days_to_anchor
    if overdue_days % max(post_expiry_frequency_days, 1) == 0:
        return -overdue_days          # negative offset marks "post expiry"
    return None


def is_post_expiry(offset: int) -> bool:
    return offset < 0


def offset_label(offset: int) -> str:
    if offset == 0:
        return "on the due date"
    if offset > 0:
        return f"{offset} days before"
    return f"{-offset} days overdue"


def recipients_for_offset(
    *,
    offset: int,
    recipients_by_offset: dict,
    owner_id: str | None,
    delegate_id: str | None,
    department_head_id: str | None,
    unit_head_id: str | None,
    compliance_ids: list[str],
    management_ids: list[str],
) -> list[str]:
    """RM-03: resolve the recipient list for one offset.

    Falls back to the default ladder when the profile has no explicit mapping.
    """
    key = str(offset)
    roles = recipients_by_offset.get(key) if recipients_by_offset else None

    if roles is None:
        if offset < 0:                       # post-expiry: widen the audience
            roles = ["owner", "delegate", "department_head", "unit_head", "compliance", "management"]
        elif offset <= 1:
            roles = ["owner", "delegate", "department_head", "unit_head", "compliance"]
        elif offset <= 15:
            roles = ["owner", "delegate", "department_head", "compliance"]
        elif offset <= 30:
            roles = ["owner", "delegate", "compliance"]
        else:
            roles = ["owner", "delegate"]

    mapping = {
        "owner": [owner_id],
        "delegate": [delegate_id],
        "department_head": [department_head_id],
        "unit_head": [unit_head_id],
        "compliance": compliance_ids,
        "management": management_ids,
    }

    out: list[str] = []
    for role_name in roles:
        for user_id in mapping.get(role_name, []):
            if user_id and user_id not in out:
                out.append(user_id)
    return out


def role_display(role_key: str) -> str:
    return {
        "owner": "Owner",
        "delegate": "Delegate",
        "department_head": "Department Head",
        "unit_head": "Unit Head",
        "plant_head": "Plant Head",
        "compliance": "Compliance Team",
        "management": "Management",
        "director": "Director / CEO",
    }.get(role_key, role_key.replace("_", " ").title())
