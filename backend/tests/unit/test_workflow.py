"""Pure unit tests for the workflow state machine (``app.domain.workflow``).

PRD Section 8: every legal transition, the mandatory-field gates, the role
matrix, the maker-checker rule for Critical items and the illegal moves that
must raise ``WorkflowError``.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.domain.enums import Criticality, ItemStatus, Role
from app.domain.workflow import (
    Transition,
    WorkflowError,
    available_transitions,
    default_criticality_requires_maker_checker,
    is_backward_move,
    is_closure,
    reminders_should_stop,
    resolve_role,
    validate_transition,
)

D1 = date(2026, 6, 15)
D2 = date(2026, 12, 31)

# Payloads that satisfy each transition's required fields.
FULL_PAYLOAD = {
    "expected_filing_date": D1,
    "submission_date": D1,
    "acknowledgement_no": "ACK-001",
    "new_reference_number": "PCC/2026/001",
    "new_issue_date": D1,
    "new_expiry_date": D2,
    "verification_remark": "Checked against the original.",
    "on_hold_reason": "Awaiting the authority's portal window.",
    "review_date": D2,
    "reason": "No longer applicable to this unit.",
}


def _validate(**overrides) -> Transition:
    kwargs = {
        "source": ItemStatus.PENDING,
        "target": ItemStatus.UNDER_PROCESS,
        "role": Role.ADMIN,
        "payload": dict(FULL_PAYLOAD),
        "has_evidence": True,
    }
    kwargs.update(overrides)
    return validate_transition(**kwargs)


# --------------------------------------------------------------------------- #
# Legal transitions
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("source", "target", "role", "label"),
    [
        (ItemStatus.PENDING, ItemStatus.UNDER_PROCESS, Role.ADMIN, "Start work"),
        (ItemStatus.QUERY_RAISED, ItemStatus.UNDER_PROCESS, Role.COMPLIANCE, "Respond to query"),
        (ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED, Role.ADMIN, "Mark submitted"),
        (ItemStatus.SUBMITTED, ItemStatus.RENEWED, Role.ADMIN, "Record renewal"),
        (ItemStatus.SUBMITTED, ItemStatus.RENEWED, Role.COMPLIANCE, "Record renewal"),
        (ItemStatus.RENEWED, ItemStatus.CLOSED, Role.COMPLIANCE, "Verify and close"),
        (ItemStatus.SUBMITTED, ItemStatus.CLOSED, Role.COMPLIANCE, "Verify and close (filing)"),
        (ItemStatus.PENDING, ItemStatus.ON_HOLD, Role.COMPLIANCE, "Put on hold"),
        (ItemStatus.UNDER_PROCESS, ItemStatus.ON_HOLD, Role.COMPLIANCE, "Put on hold"),
        (ItemStatus.ON_HOLD, ItemStatus.UNDER_PROCESS, Role.ADMIN, "Resume"),
        (ItemStatus.PENDING, ItemStatus.NOT_APPLICABLE, Role.COMPLIANCE, "Mark not applicable"),
        (ItemStatus.UNDER_PROCESS, ItemStatus.QUERY_RAISED, Role.COMPLIANCE, "Query raised by authority"),
    ],
)
def test_every_legal_transition_is_accepted(source: str, target: str, role: str, label: str) -> None:
    transition = _validate(source=source, target=target, role=role)
    assert (transition.source, transition.target) == (source, target)
    assert transition.label == label


def test_owner_resolves_by_user_id_and_may_start_work() -> None:
    # A Department User is not in OWNER_ROLES, but ownership resolves to "owner".
    transition = _validate(
        role=Role.DEPARTMENT,
        user_id="user-1",
        owner_id="user-1",
        delegate_id=None,
    )
    assert transition.label == "Start work"


def test_a_delegate_of_the_owner_may_act() -> None:
    transition = _validate(
        role=Role.DEPARTMENT,
        user_id="user-2",
        owner_id="user-1",
        delegate_id="user-2",
    )
    assert transition.label == "Start work"


def test_direct_close_is_allowed_only_when_explicitly_enabled() -> None:
    with pytest.raises(WorkflowError):
        _validate(source=ItemStatus.PENDING, target=ItemStatus.CLOSED, role=Role.COMPLIANCE)
    transition = _validate(
        source=ItemStatus.PENDING,
        target=ItemStatus.CLOSED,
        role=Role.COMPLIANCE,
        allow_direct_close=True,
    )
    assert transition.label == "Verify and close (filing)"


# --------------------------------------------------------------------------- #
# Illegal transitions
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("source", "target"),
    [
        (ItemStatus.PENDING, ItemStatus.SUBMITTED),
        (ItemStatus.PENDING, ItemStatus.RENEWED),
        (ItemStatus.UNDER_PROCESS, ItemStatus.CLOSED),
        (ItemStatus.UNDER_PROCESS, ItemStatus.RENEWED),
        (ItemStatus.SUBMITTED, ItemStatus.UNDER_PROCESS),
        (ItemStatus.RENEWED, ItemStatus.UNDER_PROCESS),
        (ItemStatus.CLOSED, ItemStatus.PENDING),
        (ItemStatus.ON_HOLD, ItemStatus.SUBMITTED),
        (ItemStatus.NOT_APPLICABLE, ItemStatus.UNDER_PROCESS),
    ],
)
def test_illegal_transitions_raise(source: str, target: str) -> None:
    with pytest.raises(WorkflowError):
        _validate(source=source, target=target, role=Role.COMPLIANCE)


def test_same_state_transition_is_rejected() -> None:
    with pytest.raises(WorkflowError, match="already"):
        _validate(source=ItemStatus.PENDING, target=ItemStatus.PENDING)


def test_role_that_does_not_own_the_item_cannot_start_work() -> None:
    with pytest.raises(WorkflowError, match="cannot perform"):
        _validate(role=Role.DEPARTMENT, user_id="user-9", owner_id="user-1")


def test_management_role_cannot_act_on_the_workflow() -> None:
    with pytest.raises(WorkflowError):
        _validate(role=Role.MANAGEMENT)


def test_administrator_cannot_verify_and_close() -> None:
    with pytest.raises(WorkflowError, match="cannot perform"):
        _validate(source=ItemStatus.RENEWED, target=ItemStatus.CLOSED, role=Role.ADMIN)


def test_administrator_cannot_put_an_item_on_hold() -> None:
    with pytest.raises(WorkflowError):
        _validate(source=ItemStatus.PENDING, target=ItemStatus.ON_HOLD, role=Role.ADMIN)


def test_auditor_cannot_act_on_the_workflow() -> None:
    with pytest.raises(WorkflowError):
        _validate(role=Role.AUDITOR)


# --------------------------------------------------------------------------- #
# Mandatory-field gating
# --------------------------------------------------------------------------- #
def test_submission_requires_a_submission_date() -> None:
    payload = dict(FULL_PAYLOAD)
    payload.pop("submission_date")
    with pytest.raises(WorkflowError) as excinfo:
        _validate(source=ItemStatus.UNDER_PROCESS, target=ItemStatus.SUBMITTED, payload=payload)
    assert "submission date" in excinfo.value.missing


def test_submission_requires_evidence() -> None:
    with pytest.raises(WorkflowError) as excinfo:
        _validate(
            source=ItemStatus.UNDER_PROCESS,
            target=ItemStatus.SUBMITTED,
            has_evidence=False,
        )
    assert any("document" in item for item in excinfo.value.missing)


def test_submission_requires_an_acknowledgement_number() -> None:
    payload = dict(FULL_PAYLOAD)
    payload.pop("acknowledgement_no")
    with pytest.raises(WorkflowError) as excinfo:
        _validate(source=ItemStatus.UNDER_PROCESS, target=ItemStatus.SUBMITTED, payload=payload)
    assert "acknowledgement no" in excinfo.value.missing


def test_start_work_requires_an_expected_filing_date() -> None:
    payload = dict(FULL_PAYLOAD)
    payload.pop("expected_filing_date")
    with pytest.raises(WorkflowError) as excinfo:
        _validate(source=ItemStatus.PENDING, target=ItemStatus.UNDER_PROCESS, payload=payload)
    assert "expected filing date" in excinfo.value.missing


def test_renewal_requires_the_renewed_certificate_upload() -> None:
    with pytest.raises(WorkflowError) as excinfo:
        _validate(
            source=ItemStatus.SUBMITTED,
            target=ItemStatus.RENEWED,
            has_evidence=False,
        )
    assert "renewed certificate upload" in excinfo.value.missing


def test_renewal_requires_the_new_dates_and_reference() -> None:
    payload = {key: value for key, value in FULL_PAYLOAD.items()
               if key not in {"new_reference_number", "new_issue_date", "new_expiry_date"}}
    with pytest.raises(WorkflowError) as excinfo:
        _validate(source=ItemStatus.SUBMITTED, target=ItemStatus.RENEWED, payload=payload)
    assert set(excinfo.value.missing) == {
        "new reference number", "new issue date", "new expiry date",
    }


def test_verification_requires_a_remark() -> None:
    payload = dict(FULL_PAYLOAD)
    payload.pop("verification_remark")
    with pytest.raises(WorkflowError) as excinfo:
        _validate(
            source=ItemStatus.RENEWED, target=ItemStatus.CLOSED,
            role=Role.COMPLIANCE, payload=payload,
        )
    assert "verification remark" in excinfo.value.missing


def test_on_hold_requires_a_review_date_and_a_reason() -> None:
    payload = {key: value for key, value in FULL_PAYLOAD.items()
               if key not in {"review_date", "on_hold_reason"}}
    with pytest.raises(WorkflowError) as excinfo:
        _validate(
            source=ItemStatus.PENDING, target=ItemStatus.ON_HOLD,
            role=Role.COMPLIANCE, payload=payload,
        )
    assert set(excinfo.value.missing) == {"on hold reason", "review date"}


def test_not_applicable_and_query_raised_require_a_reason() -> None:
    # ``reason`` is a required field on both transitions, so it is reported by
    # the missing-field gate rather than the later ``requires_reason`` gate.
    payload = {key: value for key, value in FULL_PAYLOAD.items()
               if key not in {"reason", "on_hold_reason"}}
    with pytest.raises(WorkflowError) as excinfo:
        _validate(
            source=ItemStatus.PENDING, target=ItemStatus.NOT_APPLICABLE,
            role=Role.COMPLIANCE, payload=payload,
        )
    assert "reason" in excinfo.value.missing

    with pytest.raises(WorkflowError) as excinfo:
        _validate(
            source=ItemStatus.UNDER_PROCESS, target=ItemStatus.QUERY_RAISED,
            role=Role.COMPLIANCE, payload=payload,
        )
    assert "reason" in excinfo.value.missing


def test_a_supplied_reason_satisfies_the_gate() -> None:
    transition = _validate(
        source=ItemStatus.PENDING, target=ItemStatus.NOT_APPLICABLE,
        role=Role.COMPLIANCE, payload=dict(FULL_PAYLOAD),
    )
    assert transition.target == ItemStatus.NOT_APPLICABLE


# --------------------------------------------------------------------------- #
# Maker-checker on Critical items
# --------------------------------------------------------------------------- #
def test_critical_item_cannot_be_closed_without_a_verified_actor() -> None:
    with pytest.raises(WorkflowError, match="Maker-checker"):
        _validate(
            source=ItemStatus.RENEWED,
            target=ItemStatus.CLOSED,
            role=Role.COMPLIANCE,
            is_critical=True,
            actor_verified=False,
        )


def test_critical_item_closes_when_the_verifier_is_a_different_person() -> None:
    transition = _validate(
        source=ItemStatus.RENEWED,
        target=ItemStatus.CLOSED,
        role=Role.COMPLIANCE,
        is_critical=True,
        actor_verified=True,
    )
    assert transition.target == ItemStatus.CLOSED


def test_non_critical_item_needs_no_maker_checker() -> None:
    transition = _validate(
        source=ItemStatus.RENEWED,
        target=ItemStatus.CLOSED,
        role=Role.COMPLIANCE,
        is_critical=False,
        actor_verified=False,
    )
    assert transition.target == ItemStatus.CLOSED


def test_default_criticality_requires_maker_checker_helper() -> None:
    assert default_criticality_requires_maker_checker(Criticality.CRITICAL) is True
    for other in (Criticality.HIGH, Criticality.MEDIUM, Criticality.LOW):
        assert default_criticality_requires_maker_checker(other) is False


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def test_available_transitions_for_pending() -> None:
    targets = {t.target for t in available_transitions(ItemStatus.PENDING)}
    assert targets == {
        ItemStatus.UNDER_PROCESS,
        ItemStatus.ON_HOLD,
        ItemStatus.NOT_APPLICABLE,
    }


def test_available_transitions_for_a_terminal_state_is_empty() -> None:
    assert available_transitions(ItemStatus.CLOSED) == []


def test_resolve_role_maps_the_owner_and_delegate_only() -> None:
    assert resolve_role(Role.DEPARTMENT, user_id="u1", owner_id="u1", delegate_id=None) == "owner"
    assert resolve_role(Role.DEPARTMENT, user_id="u2", owner_id="u1", delegate_id="u2") == "owner"
    assert resolve_role(Role.DEPARTMENT, user_id="u3", owner_id="u1", delegate_id="u2") == Role.DEPARTMENT
    assert resolve_role(Role.ADMIN, user_id=None, owner_id="u1", delegate_id=None) == Role.ADMIN


def test_is_backward_move() -> None:
    assert is_backward_move(ItemStatus.SUBMITTED, ItemStatus.UNDER_PROCESS) is True
    assert is_backward_move(ItemStatus.PENDING, ItemStatus.SUBMITTED) is False
    assert is_backward_move(ItemStatus.ON_HOLD, ItemStatus.PENDING) is False


def test_is_closure() -> None:
    assert is_closure(ItemStatus.CLOSED) is True
    assert is_closure(ItemStatus.RENEWED) is False


@pytest.mark.parametrize(
    "status",
    [ItemStatus.CLOSED, ItemStatus.NOT_APPLICABLE, ItemStatus.ON_HOLD],
)
def test_reminders_stop_for_terminal_and_paused_states(status: str) -> None:
    assert reminders_should_stop(status) is True


@pytest.mark.parametrize(
    "status",
    [ItemStatus.PENDING, ItemStatus.UNDER_PROCESS, ItemStatus.SUBMITTED, ItemStatus.QUERY_RAISED],
)
def test_reminders_continue_for_live_states(status: str) -> None:
    assert reminders_should_stop(status) is False
