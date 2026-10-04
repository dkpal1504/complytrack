"""FastAPI dependencies: authentication, RBAC guards and request context."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core import rbac
from app.core.security import decode_access_token
from app.db.session import get_db
from app.domain.enums import Role, UserStatus
from app.models.auth import User

bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


class AuthError(HTTPException):
    def __init__(self, detail: str, code: int = status.HTTP_401_UNAUTHORIZED) -> None:
        super().__init__(status_code=code, detail=detail,
                         headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: DbSession,
) -> User:
    if credentials is None or not credentials.credentials:
        raise AuthError("Not authenticated.")

    try:
        payload = decode_access_token(credentials.credentials)
    except ValueError as exc:
        raise AuthError(str(exc)) from exc

    user = db.get(User, payload.get("sub"))
    if user is None or user.is_deleted:
        raise AuthError("Account not found.")
    if user.status != UserStatus.ACTIVE:
        raise AuthError("Account is not active.", status.HTTP_403_FORBIDDEN)

    # AC-04: a forced logout on deactivation must bite immediately, even if the
    # access token has not expired yet.
    token_iat = payload.get("iat")
    if user.last_login_at and token_iat:
        if token_iat < int(user.last_login_at.timestamp()):
            raise AuthError("Session has been invalidated. Please sign in again.")

    request.state.user = user
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require(permission: str):
    """Dependency factory enforcing one capability from the Section 9 matrix."""

    def _guard(user: CurrentUser) -> User:
        if not rbac.has_permission(user.all_roles, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role does not permit this action ({permission}).",
            )
        return user

    return _guard


def require_any(*permissions: str):
    def _guard(user: CurrentUser) -> User:
        granted = rbac.permissions_for(user.all_roles)
        if not any(p in granted for p in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your role does not permit this action.",
            )
        return user

    return _guard


def require_writable(user: CurrentUser) -> User:
    """Management and Auditor are read-only everywhere (Section 9)."""
    if rbac.is_read_only(user.all_roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your role has read-only access to the compliance register.",
        )
    return user


def get_scope(user: CurrentUser) -> rbac.Scope:
    return rbac.build_scope(user)


CurrentScope = Annotated[rbac.Scope, Depends(get_scope)]


def client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def request_context(request: Request) -> dict:
    """Actor + device context stamped onto every audit row."""
    user: User | None = getattr(request.state, "user", None)
    return {
        "user_id": user.id if user else None,
        "user_email": user.email if user else None,
        "ip": client_ip(request),
        "user_agent": request.headers.get("user-agent"),
    }


Context = Annotated[dict, Depends(request_context)]


def is_compliance_or_admin(user: User) -> bool:
    roles = user.all_roles
    return Role.COMPLIANCE in roles or Role.ADMIN in roles
