"""Reusable column mixins (PRD Section 10: every table carries the same audit columns)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.types import UTCDateTime, new_uuid, utcnow


class UUIDPk:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class SoftDelete:
    """CD-08: soft delete only — archived rows stay searchable with a reason."""

    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    deleted_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("user.id"), nullable=True)
    delete_reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)


class Authored:
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class BaseColumns(UUIDPk, Timestamped, Authored, SoftDelete):
    """The standard column set: id, timestamps, authorship, soft delete."""
