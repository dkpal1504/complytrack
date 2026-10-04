"""Small portable column helpers shared by every model."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, TypeDecorator


def new_uuid() -> str:
    return str(uuid.uuid4())


class UTCDateTime(TypeDecorator):
    """Always store UTC; always hand back timezone-aware datetimes.

    SQLite drops tzinfo, which would otherwise make reminder dedupe and audit
    ordering subtly wrong.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UUIDStr(String):
    """UUID primary keys stored as 36-char strings (PRD Section 10)."""

    def __init__(self) -> None:
        super().__init__(36)
