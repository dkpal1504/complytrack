"""Append-only, hash-chained audit log (AT-01 through AT-04).

Every entry hashes its own canonical payload together with the previous entry's
hash, so removing or editing a row breaks verification from that point on. No
API surface exists for updating or deleting these rows — by any role.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.types import utcnow
from app.domain.dates import IST, format_ist
from app.models.audit import AuditLog

GENESIS_HASH = "0" * 64

# Values that must never be written to the audit log in clear.
REDACTED_FIELDS = {"password", "password_hash", "mfa_secret", "token", "token_hash",
                   "secret_key", "smtp_password", "entra_client_secret"}


def _serialise(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (list, tuple, set)):
        return [_serialise(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _serialise(v) for k, v in value.items()}
    return str(value)


def _canonical(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def last_hash(db: Session) -> str:
    """The hash the next entry must chain onto.

    This is the **tip of the chain** — the entry nothing else claims as its
    predecessor — and not simply the most recent row by timestamp. Two entries
    can share a microsecond (a status change and the roll-forward it triggers),
    and ordering by timestamp then by uuid picks between them arbitrarily, which
    forks the chain. Entries added earlier in the same uncommitted transaction
    are not visible to a query at all, so those are taken first.
    """
    for pending in reversed(list(db.new)):
        if isinstance(pending, AuditLog):
            return pending.hash

    already_chained_onto = select(AuditLog.prev_hash).where(AuditLog.prev_hash.is_not(None))
    tip = db.execute(
        select(AuditLog.hash).where(AuditLog.hash.not_in(already_chained_onto)).limit(1)
    ).scalar_one_or_none()
    return tip or GENESIS_HASH


def write_audit(
    db: Session,
    *,
    entity_type: str,
    entity_id: str | None,
    action: str,
    field: str | None = None,
    old_value: Any = None,
    new_value: Any = None,
    changes: dict | None = None,
    reason: str | None = None,
    user_id: str | None = None,
    user_email: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
    ts: datetime | None = None,
    commit: bool = False,
) -> AuditLog:
    """Append one audit entry. Caller commits (usually alongside its own write)."""
    moment = ts or utcnow()

    if field in REDACTED_FIELDS:
        old_value = "***redacted***" if old_value is not None else None
        new_value = "***redacted***" if new_value is not None else None

    payload = {
        "ts_utc": moment.astimezone(timezone.utc).isoformat(),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "field": field,
        "old_value": _serialise(old_value),
        "new_value": _serialise(new_value),
        "changes": _serialise(changes),
        "reason": reason,
        "user_id": user_id,
    }
    prev = last_hash(db)
    digest = hashlib.sha256((prev + _canonical(payload)).encode("utf-8")).hexdigest()

    entry = AuditLog(
        ts_utc=moment,
        ts_ist=moment.astimezone(IST).strftime("%d-%b-%Y %H:%M:%S IST"),
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        field=field,
        old_value=None if old_value is None else _canonical(_serialise(old_value))[:8000],
        new_value=None if new_value is None else _canonical(_serialise(new_value))[:8000],
        changes=_serialise(changes),
        reason=reason,
        user_id=user_id,
        user_email=user_email,
        ip=ip,
        user_agent=(user_agent or "")[:400] or None,
        prev_hash=prev,
        hash=digest,
    )
    db.add(entry)
    if commit:
        db.commit()
    return entry


def diff_entity(before: dict, after: dict, *, ignore: set[str] | None = None) -> dict:
    """Field-level before/after map for an update."""
    skip = ignore or set()
    changes: dict[str, dict] = {}
    for key in set(before) | set(after):
        if key in skip:
            continue
        old, new = before.get(key), after.get(key)
        if _serialise(old) != _serialise(new):
            changes[key] = {"old": _serialise(old), "new": _serialise(new)}
    return changes


def verify_chain(db: Session) -> dict:
    """Re-walk the chain and report the first break — used by the audit report.

    The walk follows the ``prev_hash`` links rather than ordering by timestamp.
    Two writes can land in the same microsecond — a document upload and the
    status change it triggers, for instance — and their timestamps alone do not
    say which came first. Ordering by timestamp made the verifier cry tampering
    on a perfectly good trail, so the links themselves are the order.
    """
    rows = db.execute(select(AuditLog)).scalars().all()

    following: dict[str, list] = {}
    for row in rows:
        following.setdefault(row.prev_hash or GENESIS_HASH, []).append(row)

    def payload_of(row) -> dict:
        return {
            "ts_utc": row.ts_utc.astimezone(timezone.utc).isoformat(),
            "entity_type": row.entity_type,
            "entity_id": row.entity_id,
            "action": row.action,
            "field": row.field,
            "old_value": row.old_value if row.old_value is None else json.loads(row.old_value),
            "new_value": row.new_value if row.new_value is None else json.loads(row.new_value),
            "changes": row.changes,
            "reason": row.reason,
            "user_id": row.user_id,
        }

    prev = GENESIS_HASH
    seen: set[str] = set()
    walked = 0
    while True:
        candidates = following.get(prev, [])
        if not candidates:
            break
        if len(candidates) > 1:
            return {
                "intact": False,
                "entries": len(rows),
                "broken_at": candidates[1].id,
                "index": walked,
                "reason": f"two entries claim the same predecessor at {prev[:12]}",
            }
        row = candidates[0]
        if row.id in seen:  # pragma: no cover - defensive, a cycle would loop forever
            return {
                "intact": False,
                "entries": len(rows),
                "broken_at": row.id,
                "index": walked,
                "reason": "the chain loops back on itself",
            }
        expected = hashlib.sha256((prev + _canonical(payload_of(row))).encode("utf-8")).hexdigest()
        if expected != row.hash:
            return {
                "intact": False,
                "entries": len(rows),
                "broken_at": row.id,
                "index": walked,
                "reason": "entry hash mismatch",
            }
        seen.add(row.id)
        walked += 1
        prev = row.hash

    if walked != len(rows):
        # An entry whose predecessor is missing was inserted or its parent edited.
        orphan = next(r for r in rows if r.id not in seen)
        return {
            "intact": False,
            "entries": len(rows),
            "broken_at": orphan.id,
            "index": walked,
            "reason": "entry is not reachable from the start of the chain",
        }

    return {"intact": True, "entries": len(rows), "head": prev, "verified_at": format_ist(utcnow())}


def export_rows(db: Session, rows: list[AuditLog]) -> dict:
    """Tamper-evident export envelope (AT-03)."""
    body = [
        {
            "ts_utc": r.ts_utc.isoformat(),
            "ts_ist": r.ts_ist,
            "entity_type": r.entity_type,
            "entity_id": r.entity_id,
            "action": r.action,
            "field": r.field,
            "old_value": r.old_value,
            "new_value": r.new_value,
            "reason": r.reason,
            "user_email": r.user_email,
            "ip": r.ip,
            "hash": r.hash,
            "prev_hash": r.prev_hash,
        }
        for r in rows
    ]
    envelope = {"generated_at": utcnow().isoformat(), "rows": body}
    envelope["export_hash"] = hashlib.sha256(_canonical(envelope).encode("utf-8")).hexdigest()
    return envelope
