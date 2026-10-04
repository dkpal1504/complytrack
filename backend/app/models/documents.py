"""Documents, versions and the file-integrity record (DS-03, DS-05, AT-05)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.db.types import UTCDateTime
from app.models.mixins import BaseColumns


class Document(BaseColumns, Base):
    __tablename__ = "document"

    item_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_item.id"), nullable=True, index=True
    )
    instance_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("compliance_instance.id"), nullable=True, index=True
    )
    finding_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    doc_type: Mapped[str] = mapped_column(String(40), default="Certificate", index=True)
    title: Mapped[str] = mapped_column(String(300))
    file_name: Mapped[str] = mapped_column(String(300))
    mime: Mapped[str | None] = mapped_column(String(150), nullable=True)
    size: Mapped[int] = mapped_column(Integer, default=0)
    storage_key: Mapped[str] = mapped_column(String(500))
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    version_no: Mapped[int] = mapped_column(Integer, default=1)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    supersedes_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # DS-03: a renewal upload must state the new reference/dates.
    reference_number: Mapped[str | None] = mapped_column(String(200), nullable=True)
    issue_date: Mapped[date | None] = mapped_column(nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(nullable=True)

    change_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    virus_scan_status: Mapped[str] = mapped_column(String(30), default="Clean")
    retention_until: Mapped[date | None] = mapped_column(nullable=True)
    legal_hold: Mapped[bool] = mapped_column(Boolean, default=False)
    download_count: Mapped[int] = mapped_column(Integer, default=0)
    last_downloaded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class ShareLink(BaseColumns, Base):
    """DS-09: time-limited, view-only link for auditors and inspectors."""

    __tablename__ = "share_link"

    token: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    scope_item_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    scope_unit_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_for: Mapped[str | None] = mapped_column(String(250), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    watermark: Mapped[bool] = mapped_column(Boolean, default=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
