"""Append-only, hash-chained audit log (AT-01, AT-03)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.db.types import UTCDateTime, new_uuid


class AuditLog(Base):
    """No update/delete path exists for this table anywhere in the codebase."""

    __tablename__ = "audit_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    ts_utc: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    ts_ist: Mapped[str] = mapped_column(String(40))

    entity_type: Mapped[str] = mapped_column(String(80), index=True)
    entity_id: Mapped[str | None] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(60), index=True)

    field: Mapped[str | None] = mapped_column(String(120), nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    changes: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    user_email: Mapped[str | None] = mapped_column(String(250), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)

    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    hash: Mapped[str] = mapped_column(String(64), index=True)
