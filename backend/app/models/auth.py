"""User accounts, sessions, and the push-token registry."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.db.types import UTCDateTime
from app.domain.enums import Role, UserStatus
from app.models.mixins import BaseColumns


class User(BaseColumns, Base):
    __tablename__ = "user"

    name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(250), unique=True, index=True)
    mobile: Mapped[str | None] = mapped_column(String(30), nullable=True)
    employee_id: Mapped[str | None] = mapped_column(String(60), nullable=True)

    department_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("department.id"), nullable=True, index=True
    )
    # A user may hold role(s) across several units (PRD Section 9, notes).
    unit_ids: Mapped[list[str]] = mapped_column(JSON, default=list)

    role: Mapped[str] = mapped_column(String(40), default=Role.DEPARTMENT, index=True)
    # Extra units where this user holds a wider role, e.g.
    # [{"role": "Compliance Team", "unit_id": "..."}]
    extra_roles: Mapped[list[dict]] = mapped_column(JSON, default=list)

    entra_object_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default=UserStatus.ACTIVE, index=True)

    password_hash: Mapped[str | None] = mapped_column(String(200), nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    mfa_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)

    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)

    # Web-push subscriptions (RM-02).
    device_tokens: Mapped[list[dict]] = mapped_column(JSON, default=list)

    department: Mapped["Department | None"] = relationship(foreign_keys=[department_id])  # noqa: F821

    @property
    def all_roles(self) -> list[str]:
        return [self.role, *(r.get("role") for r in (self.extra_roles or []) if r.get("role"))]

    @property
    def is_active_user(self) -> bool:
        return self.status == UserStatus.ACTIVE and not self.is_deleted


class SessionToken(BaseColumns, Base):
    """Refresh-token / device-session registry, so deactivation can force logout."""

    __tablename__ = "session_token"

    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    issued_at: Mapped[datetime] = mapped_column(UTCDateTime)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)


class Delegation(BaseColumns, Base):
    """AC-06: temporary owner substitution with start/end dates."""

    __tablename__ = "delegation"

    from_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), index=True)
    to_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id"), index=True)
    start_date: Mapped[datetime] = mapped_column(UTCDateTime)
    end_date: Mapped[datetime] = mapped_column(UTCDateTime)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
