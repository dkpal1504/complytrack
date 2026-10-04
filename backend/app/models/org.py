"""Organisation, master data and reference entities."""

from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.domain.enums import AuthorityLevel, UnitType
from app.models.mixins import BaseColumns
from app.db.session import Base


class OrganisationUnit(BaseColumns, Base):
    """Plant, yard, dry dock, office or subsidiary (multi-entity capable)."""

    __tablename__ = "organisation_unit"

    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(30), default=UnitType.YARD)
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organisation_unit.id"), nullable=True
    )
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    gstin: Mapped[str | None] = mapped_column(String(20), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    departments: Mapped[list["Department"]] = relationship(back_populates="unit")


class Department(BaseColumns, Base):
    __tablename__ = "department"

    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    head_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("user.id", use_alter=True, name="fk_department_head"), nullable=True
    )
    unit_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("organisation_unit.id"), nullable=True, index=True
    )

    unit: Mapped[OrganisationUnit | None] = relationship(back_populates="departments")


class IssuingAuthority(BaseColumns, Base):
    __tablename__ = "issuing_authority"

    name: Mapped[str] = mapped_column(String(250), index=True)
    level: Mapped[str] = mapped_column(String(30), default=AuthorityLevel.STATE)
    website: Mapped[str | None] = mapped_column(String(300), nullable=True)
    contact: Mapped[str | None] = mapped_column(String(300), nullable=True)
    default_processing_days: Mapped[int] = mapped_column(Integer, default=15)


class Category(BaseColumns, Base):
    """Category and sub-category in one self-referencing table."""

    __tablename__ = "category"

    name: Mapped[str] = mapped_column(String(150), index=True)
    parent_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("category.id"), nullable=True, index=True
    )
    colour: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class LegalReference(BaseColumns, Base):
    __tablename__ = "legal_reference"

    act_rule_name: Mapped[str] = mapped_column(String(300), index=True)
    section: Mapped[str | None] = mapped_column(String(120), nullable=True)
    jurisdiction: Mapped[str | None] = mapped_column(String(80), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class HolidayCalendar(BaseColumns, Base):
    """State-wise holiday list used for working-day targets (RT-04)."""

    __tablename__ = "holiday_calendar"

    state: Mapped[str] = mapped_column(String(80), index=True, default="ALL")
    date: Mapped[date] = mapped_column(index=True)
    name: Mapped[str] = mapped_column(String(150))


class Setting(BaseColumns, Base):
    """Key/value settings: FY start, quiet hours, branding, SMTP, SSO."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    value: Mapped[dict | list | str | int | None] = mapped_column(JSON, nullable=True)
    description: Mapped[str | None] = mapped_column(String(400), nullable=True)
