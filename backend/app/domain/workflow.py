"""The instance state machine (PRD Section 8).

Pure transition validation: given where an instance is, where it wants to go,
who is asking and what they supplied, decide whether it is allowed. The service
layer is responsible for persisting the result.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.enums import Criticality, ItemStatus, Role


class WorkflowError(ValueError):
    """Raised with a human-readable reason when a transition is not permitted."""

    def __init__(self, message: str, *, missing: list[str] | None = None) -> None:
        super().__init__(message)
        self.missing = missing or []


@dataclass(frozen=True, slots=True)
class Transition:
    source: str
    target: str
    roles: tuple[str, ...]
    required_fields: tuple[str, ...] = ()
    requires_reason: bool = False
    label: str = ""


# Roles allowed to move an item forward. "owner" is resolved by the caller to
# the instance's owner/delegate.
OWNER_ROLES = ("owner", Role.ADMIN, Role.COMPLIANCE)
VERIFIER_ROLES = (Role.COMPLIANCE,)

TRANSITIONS: tuple[Transition, ...] = (
    Transition(
        ItemStatus.PENDING, ItemStatus.UNDER_PROCESS, OWNER_ROLES,
        required_fields=("expected_filing_date",),
        label="Start work",
    ),
    Transition(
        ItemStatus.QUERY_RAISED, ItemStatus.UNDER_PROCESS, OWNER_ROLES,
        required_fields=("expected_filing_date",),
        label="Respond to query",
    ),
    Transition(
        ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED, OWNER_ROLES,
        required_fields=("submission_date", "acknowledgement_no", "evidence"),
        label="Mark submitted",
    ),
    Transition(
        ItemStatus.SUBMITTED, ItemStatus.RENEWED, OWNER_ROLES + (Role.COMPLIANCE,),
        required_fields=("renewed_certificate", "new_reference_number",
                         "new_issue_date", "new_expiry_date"),
        label="Record renewal",
    ),
    Transition(
        ItemStatus.RENEWED, ItemStatus.CLOSED, VERIFIER_ROLES,
        required_fields=("verification_remark",),
        label="Verify and close",
    ),
    Transition(
        ItemStatus.SUBMITTED, ItemStatus.CLOSED, VERIFIER_ROLES,
        required_fields=("verification_remark",),
        label="Verify and close (filing)",
    ),
    Transition(
        ItemStatus.PENDING, ItemStatus.ON_HOLD, VERIFIER_ROLES,
        required_fields=("on_hold_reason", "review_date"), requires_reason=True,
        label="Put on hold",
    ),
    Transition(
        ItemStatus.UNDER_PROCESS, ItemStatus.ON_HOLD, VERIFIER_ROLES,
        required_fields=("on_hold_reason", "review_date"), requires_reason=True,
        label="Put on hold",
    ),
    Transition(
        ItemStatus.ON_HOLD, ItemStatus.UNDER_PROCESS, OWNER_ROLES,
        label="Resume",
    ),
    Transition(
        ItemStatus.PENDING, ItemStatus.NOT_APPLICABLE, VERIFIER_ROLES,
        required_fields=("reason",), requires_reason=True,
        label="Mark not applicable",
    ),
    Transition(
        ItemStatus.UNDER_PROCESS, ItemStatus.QUERY_RAISED, VERIFIER_ROLES,
        required_fields=("reason",), requires_reason=True,
        label="Query raised by authority",
    ),
)

# Any -> Closed is only valid for the states listed above; a Pending item can
# never jump straight to Closed.
BACKWARD_ORDER = {
    ItemStatus.PENDING: 0,
    ItemStatus.UNDER_PROCESS: 1,
    ItemStatus.SUBMITTED: 2,
    ItemStatus.RENEWED: 3,
    ItemStatus.CLOSED: 4,
}

_INDEX = {(t.source, t.target): t for t in TRANSITIONS}


def available_transitions(status: str) -> list[Transition]:
    return [t for t in TRANSITIONS if t.source == status]


def resolve_role(role: str, *, user_id: str | None, owner_id: str | None,
                 delegate_id: str | None) -> str:
    """Map a caller to 'owner' when they own or delegate the item."""
    if user_id and user_id in {owner_id, delegate_id}:
        return "owner"
    return role


def validate_transition(
    *,
    source: str,
    target: str,
    role: str,
    payload: dict,
    has_evidence: bool = False,
    is_critical: bool = False,
    allow_direct_close: bool = False,
    user_id: str | None = None,
    owner_id: str | None = None,
    delegate_id: str | None = None,
    actor_verified: bool = False,
) -> Transition:
    """Raise ``WorkflowError`` unless the move is permitted; else the Transition."""
    if source == target:
        raise WorkflowError(f"Item is already {target}.")

    effective_role = resolve_role(
        role, user_id=user_id, owner_id=owner_id, delegate_id=delegate_id
    )

    transition = _INDEX.get((source, target))

    # A filing template may skip the renewal leg entirely (Section 8 note).
    if transition is None and allow_direct_close and target == ItemStatus.CLOSED:
        transition = _INDEX[(ItemStatus.SUBMITTED, ItemStatus.CLOSED)]

    if transition is None:
        raise WorkflowError(
            f"Cannot move from {source} to {target}. "
            f"Allowed: {', '.join(sorted({t.target for t in available_transitions(source)})) or 'none'}."
        )

    if effective_role not in transition.roles:
        raise WorkflowError(
            f"Your role cannot perform '{transition.label}'. "
            "Only the Compliance Team verifies and closes items."
        )

    missing: list[str] = []
    for field_name in transition.required_fields:
        if field_name == "evidence":
            if not has_evidence:
                missing.append("supporting document (acknowledgement / challan / receipt)")
            continue
        if field_name == "renewed_certificate":
            if not has_evidence:
                missing.append("renewed certificate upload")
            continue
        if not payload.get(field_name):
            missing.append(field_name.replace("_", " "))

    if missing:
        raise WorkflowError(
            "Missing mandatory information: " + ", ".join(missing) + ".", missing=missing
        )

    # Maker-checker: owners cannot close their own Critical items (business rule 3).
    if target == ItemStatus.CLOSED:
        if is_critical and effective_role not in VERIFIER_ROLES:
            raise WorkflowError(
                "Maker-checker: a Critical item can only be closed by the Compliance Team."
            )
        if is_critical and not actor_verified:
            raise WorkflowError(
                "Maker-checker: the closing Compliance Team member must be a different "
                "person from the owner who submitted the renewal."
            )

    if transition.requires_reason and not (payload.get("reason") or payload.get("on_hold_reason")):
        # Carries `missing` like the required-field branch above: an absent
        # reason is a payload the caller can complete, not a state the resource
        # is stuck in, and the two are answered differently over HTTP.
        raise WorkflowError("A reason is mandatory for this action.", missing=["reason"])

    return transition


def is_backward_move(source: str, target: str) -> bool:
    a, b = BACKWARD_ORDER.get(source), BACKWARD_ORDER.get(target)
    if a is None or b is None:
        return False
    return b < a


def is_closure(state: str) -> bool:
    return state == ItemStatus.CLOSED


def reminders_should_stop(status: str) -> bool:
    return status in (ItemStatus.CLOSED, ItemStatus.NOT_APPLICABLE, ItemStatus.ON_HOLD)


def default_criticality_requires_maker_checker(criticality: str) -> bool:
    return criticality == Criticality.CRITICAL
