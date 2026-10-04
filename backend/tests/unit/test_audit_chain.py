"""Append-only audit log hash chain (AT-01 through AT-04).

This module needs a database session (the log is a table), but no network and
no application server: it writes to the per-test SQLite file from ``conftest``.

The chain is only as strong as the order in which entries are persisted, so
both the healthy paths and the tamper cases are pinned here.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select, update

from app.models.audit import AuditLog
from app.services import audit

BASE_TS = datetime(2026, 6, 15, 6, 0, tzinfo=timezone.utc)


def _write(db, *, index: int, action: str = "update", **kwargs) -> AuditLog:
    """Write one entry with a strictly increasing timestamp, then commit."""
    return audit.write_audit(
        db,
        entity_type="compliance_item",
        entity_id="item-1",
        action=action,
        ts=BASE_TS + timedelta(seconds=index),
        **kwargs,
    )


# --------------------------------------------------------------------------- #
# The healthy chain
# --------------------------------------------------------------------------- #
def test_an_empty_log_verifies_intact(db) -> None:
    result = audit.verify_chain(db)
    assert result["intact"] is True
    assert result["entries"] == 0
    assert result["head"] == audit.GENESIS_HASH


def test_the_first_entry_links_to_the_genesis_hash(db) -> None:
    entry = _write(db, index=0, action="create", new_value={"name": "Factory Licence"})
    db.commit()
    assert entry.prev_hash == audit.GENESIS_HASH


def test_committed_entries_form_a_verifiable_chain(db) -> None:
    first = _write(db, index=0, action="create", new_value={"name": "Factory Licence"})
    db.commit()
    second = _write(db, index=1, new_value={"criticality": "High"}, old_value={"criticality": "Medium"})
    db.commit()
    third = _write(db, index=2, action="archive", reason="Sold the press")
    db.commit()

    assert second.prev_hash == first.hash
    assert third.prev_hash == second.hash

    result = audit.verify_chain(db)
    assert result["intact"] is True
    assert result["entries"] == 3
    assert result["head"] == third.hash


def test_entries_flushed_between_writes_still_chain(db) -> None:
    # Callers that batch several writes in one transaction must flush, because
    # ``last_hash`` reads persisted rows only.
    first = _write(db, index=0, action="create")
    db.flush()
    second = _write(db, index=1)
    db.flush()
    db.commit()

    assert second.prev_hash == first.hash
    assert audit.verify_chain(db)["intact"] is True


def test_the_head_hash_reports_the_newest_entry(db) -> None:
    _write(db, index=0, action="create")
    db.commit()
    newest = _write(db, index=1, action="archive")
    db.commit()
    assert audit.last_hash(db) == newest.hash


# --------------------------------------------------------------------------- #
# Tamper detection
# --------------------------------------------------------------------------- #
def test_editing_a_stored_value_is_detected(db) -> None:
    first = _write(db, index=0, action="create", new_value={"name": "Factory Licence"})
    db.commit()
    _write(db, index=1, action="update", new_value={"name": "Renamed"})
    db.commit()

    db.execute(
        update(AuditLog).where(AuditLog.id == first.id).values(new_value='"tampered"')
    )
    db.commit()
    db.expire_all()

    result = audit.verify_chain(db)
    assert result["intact"] is False
    assert result["broken_at"] == first.id
    assert result["index"] == 0
    assert result["reason"] == "entry hash mismatch"


def test_deleting_a_middle_entry_is_detected(db) -> None:
    _write(db, index=0, action="create")
    db.commit()
    middle = _write(db, index=1, action="update")
    db.commit()
    last = _write(db, index=2, action="archive")
    db.commit()

    db.execute(delete(AuditLog).where(AuditLog.id == middle.id))
    db.commit()
    db.expire_all()

    # The walk follows prev_hash links, so the entry after the hole is the one
    # that is no longer reachable from genesis.
    result = audit.verify_chain(db)
    assert result["intact"] is False
    assert result["reason"] == "entry is not reachable from the start of the chain"
    assert result["broken_at"] == last.id
    assert result["index"] == 1


def test_rewriting_a_whole_entry_is_detected(db) -> None:
    first = _write(db, index=0, action="create")
    db.commit()
    _write(db, index=1, action="update")
    db.commit()

    # Rewrite the stored hash to match a re-hashed payload — the next entry's
    # prev_hash no longer points at it.
    db.execute(
        update(AuditLog).where(AuditLog.id == first.id).values(hash="f" * 64)
    )
    db.commit()
    db.expire_all()

    assert audit.verify_chain(db)["intact"] is False


# --------------------------------------------------------------------------- #
# Redaction and serialisation
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "field",
    ["password", "password_hash", "mfa_secret", "token", "smtp_password"],
)
def test_secrets_are_redacted_before_they_are_hashed(db, field: str) -> None:
    entry = _write(db, index=0, action="update", field=field, old_value="hunter2", new_value="s3cret")
    db.commit()
    assert "hunter2" not in (entry.old_value or "")
    assert "s3cret" not in (entry.new_value or "")
    assert "redacted" in (entry.new_value or "")
    # The redacted (not the original) value is what the chain protects.
    assert audit.verify_chain(db)["intact"] is True


def test_a_non_sensitive_field_is_stored_in_clear(db) -> None:
    entry = _write(db, index=0, action="update", field="criticality",
                   old_value="Medium", new_value="High")
    db.commit()
    assert "High" in (entry.new_value or "")
    assert audit.verify_chain(db)["intact"] is True


def test_diff_entity_reports_only_changed_fields() -> None:
    changes = audit.diff_entity(
        {"name": "A", "criticality": "Medium", "owner_id": "u1"},
        {"name": "A", "criticality": "High", "owner_id": "u2"},
    )
    assert changes == {
        "criticality": {"old": "Medium", "new": "High"},
        "owner_id": {"old": "u1", "new": "u2"},
    }


def test_diff_entity_can_ignore_fields() -> None:
    assert audit.diff_entity({"a": 1}, {"a": 2}, ignore={"a"}) == {}


def test_export_envelope_carries_a_hash_of_its_own_rows(db) -> None:
    _write(db, index=0, action="create", user_email="admin@complytrack.local")
    db.commit()
    rows = db.execute(select(AuditLog)).scalars().all()

    envelope = audit.export_rows(db, rows)
    assert envelope["rows"] and envelope["rows"][0]["hash"]
    assert len(envelope["export_hash"]) == 64

    # The hash must cover the envelope body (everything except the hash itself).
    body = {"generated_at": envelope["generated_at"], "rows": envelope["rows"]}
    expected = hashlib.sha256(
        audit._canonical(body).encode("utf-8")
    ).hexdigest()
    assert envelope["export_hash"] == expected

    # The exported rows carry the same hashes as the stored entries.
    assert envelope["rows"][0]["hash"] == rows[0].hash
    assert envelope["rows"][0]["prev_hash"] == audit.GENESIS_HASH


# --------------------------------------------------------------------------- #
# Batched writes in one transaction
# --------------------------------------------------------------------------- #
def test_batched_writes_keep_the_chain_intact(db) -> None:
    # Three entries, one commit — exactly what bulk_reassign does. ``last_hash``
    # takes entries still pending in the session first, so no flush is needed.
    first = _write(db, index=0, action="reassign")
    second = _write(db, index=1, action="reassign")
    third = _write(db, index=2, action="reassign")
    db.commit()

    assert second.prev_hash == first.hash
    assert third.prev_hash == second.hash
    assert audit.verify_chain(db)["intact"] is True


def test_a_forked_chain_is_rejected(db) -> None:
    """Two entries claiming the same predecessor means one of them is a forgery."""
    first = _write(db, index=0, action="create")
    db.commit()
    _write(db, index=1, action="update")
    db.commit()
    # Rewrite the second entry's predecessor back to genesis: now both rows
    # claim the same parent.
    db.execute(update(AuditLog).where(AuditLog.prev_hash == first.hash).values(prev_hash=audit.GENESIS_HASH))
    db.commit()
    db.expire_all()

    result = audit.verify_chain(db)
    assert result["intact"] is False
    assert "same predecessor" in result["reason"]
