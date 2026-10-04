"""Shared schema helpers."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Annotated, Any, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

T = TypeVar("T")

# Pragmatic e-mail validation. The strict RFC validator rejects internal
# domains (``user@plant.local``) that are perfectly real on an on-premise
# shipyard network, so we only require the shape ``local@domain.tld``.
_EMAIL_SHAPE = re.compile(r"^[^@\s]{1,64}@[^@\s.]{1,190}(\.[^@\s.]{2,63})+$")


def _check_email(value: str) -> str:
    candidate = value.strip()
    if not _EMAIL_SHAPE.match(candidate):
        raise ValueError("Enter a valid e-mail address, for example name@company.in.")
    return candidate.lower()


EmailAddress = Annotated[str, AfterValidator(_check_email)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int = 1
    page_size: int = 25
    pages: int = 1


class Message(BaseModel):
    detail: str
    ok: bool = True


class Ref(ORMModel):
    id: str
    name: str


class DateRange(BaseModel):
    start: date | None = None
    end: date | None = None


NonEmptyStr = Annotated[str, Field(min_length=1, max_length=400)]
ReasonStr = Annotated[str, Field(min_length=3, max_length=2000)]


class AuditOut(ORMModel):
    id: str
    ts_utc: datetime
    ts_ist: str
    entity_type: str
    entity_id: str | None
    action: str
    field: str | None
    old_value: Any = None
    new_value: Any = None
    reason: str | None
    user_email: str | None
    ip: str | None
    hash: str
