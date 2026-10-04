"""Auth and user schemas."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.common import EmailAddress

from app.domain.enums import Role, UserStatus
from app.schemas.common import ORMModel


class LoginRequest(BaseModel):
    email: EmailAddress
    password: str = Field(min_length=1)
    totp_code: str | None = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserOut"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    email: EmailAddress
    mobile: str | None = None
    employee_id: str | None = None
    department_id: str | None = None
    unit_ids: list[str] = Field(default_factory=list)
    role: str = Role.DEPARTMENT
    status: str = UserStatus.ACTIVE
    mfa_enabled: bool = False


class UserCreate(UserBase):
    password: str | None = None


class UserUpdate(BaseModel):
    name: str | None = None
    email: EmailAddress | None = None
    mobile: str | None = None
    employee_id: str | None = None
    department_id: str | None = None
    unit_ids: list[str] | None = None
    role: str | None = None
    status: str | None = None
    mfa_enabled: bool | None = None
    password: str | None = None


class UserOut(ORMModel):
    id: str
    name: str
    email: str
    mobile: str | None
    employee_id: str | None
    department_id: str | None
    unit_ids: list[str] = Field(default_factory=list)
    role: str
    status: str
    mfa_enabled: bool
    last_login_at: datetime | None = None
    department_name: str | None = None


class MeOut(UserOut):
    roles: list[str] = Field(default_factory=list)
    permissions: list[str] = Field(default_factory=list)
    scope: dict = Field(default_factory=dict)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class MfaSetupOut(BaseModel):
    secret: str
    provisioning_uri: str


class MfaVerify(BaseModel):
    code: str


TokenPair.model_rebuild()
