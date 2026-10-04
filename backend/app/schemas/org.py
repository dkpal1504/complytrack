"""Master-data schemas: units, departments, authorities, categories, legal refs."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.domain.enums import AuthorityLevel, UnitType
from app.schemas.common import ORMModel


class UnitBase(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=200)
    type: str = UnitType.YARD
    parent_id: str | None = None
    address: str | None = None
    state: str | None = None
    gstin: str | None = None
    active: bool = True


class UnitCreate(UnitBase):
    pass


class UnitUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    parent_id: str | None = None
    address: str | None = None
    state: str | None = None
    gstin: str | None = None
    active: bool | None = None


class UnitOut(ORMModel):
    id: str
    code: str
    name: str
    type: str
    parent_id: str | None = None
    state: str | None = None
    address: str | None = None
    gstin: str | None = None
    active: bool
    item_count: int = 0


class DepartmentBase(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=2, max_length=200)
    head_user_id: str | None = None
    unit_id: str | None = None


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    name: str | None = None
    head_user_id: str | None = None
    unit_id: str | None = None


class DepartmentOut(ORMModel):
    id: str
    code: str
    name: str
    head_user_id: str | None = None
    head_user_name: str | None = None
    unit_id: str | None = None
    unit_name: str | None = None
    item_count: int = 0
    user_count: int = 0


class AuthorityBase(BaseModel):
    name: str = Field(min_length=2, max_length=250)
    level: str = AuthorityLevel.STATE
    website: str | None = None
    contact: str | None = None
    default_processing_days: int = 15


class AuthorityCreate(AuthorityBase):
    pass


class AuthorityUpdate(BaseModel):
    name: str | None = None
    level: str | None = None
    website: str | None = None
    contact: str | None = None
    default_processing_days: int | None = None


class AuthorityOut(ORMModel):
    id: str
    name: str
    level: str
    website: str | None = None
    contact: str | None = None
    default_processing_days: int
    item_count: int = 0


class CategoryBase(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    parent_id: str | None = None
    colour: str | None = None
    sort_order: int = 0


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: str | None = None
    parent_id: str | None = None
    colour: str | None = None
    sort_order: int | None = None


class CategoryOut(ORMModel):
    id: str
    name: str
    parent_id: str | None = None
    parent_name: str | None = None
    colour: str | None = None
    sort_order: int = 0
    item_count: int = 0
    children: list["CategoryOut"] = Field(default_factory=list)


class LegalReferenceCreate(BaseModel):
    act_rule_name: str = Field(min_length=2, max_length=300)
    section: str | None = None
    jurisdiction: str | None = None
    description: str | None = None


class LegalReferenceOut(ORMModel):
    id: str
    act_rule_name: str
    section: str | None = None
    jurisdiction: str | None = None
    description: str | None = None


class HolidayCreate(BaseModel):
    state: str = "ALL"
    date: date
    name: str = Field(min_length=2, max_length=150)


class HolidayOut(ORMModel):
    id: str
    state: str
    date: date
    name: str


class SettingOut(ORMModel):
    id: str
    key: str
    value: object | None = None
    description: str | None = None


class SettingUpdate(BaseModel):
    value: object | None = None


CategoryOut.model_rebuild()
