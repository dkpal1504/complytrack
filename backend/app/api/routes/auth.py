"""Authentication: local login with TOTP MFA, refresh, logout, Entra ID SSO."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.api.common import CurrentUser, DbSession, bad_request, serialise_me, serialise_user
from app.core.config import settings
from app.core.security import (
    WeakPasswordError,
    create_access_token,
    create_refresh_token_value,
    decode_access_token,
    hash_password,
    hash_token,
    new_totp_secret,
    totp_provisioning_uri,
    validate_password_policy,
    verify_password,
    verify_totp,
)
from app.db.types import utcnow
from app.domain.enums import UserStatus
from app.models.auth import SessionToken, User
from app.schemas.auth import (
    LoginRequest,
    MfaSetupOut,
    MfaVerify,
    PasswordChange,
    RefreshRequest,
    TokenPair,
)
from app.services import audit

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _issue_tokens(db: Session, user: User, request: Request) -> TokenPair:
    access = create_access_token(user_id=user.id, email=user.email, roles=user.all_roles)
    refresh_value = create_refresh_token_value()
    db.add(SessionToken(
        user_id=user.id,
        token_hash=hash_token(refresh_value),
        issued_at=utcnow(),
        expires_at=utcnow() + timedelta(days=settings.refresh_token_ttl_days),
        ip=request.client.host if request.client else None,
        user_agent=(request.headers.get("user-agent") or "")[:400] or None,
    ))
    db.commit()
    return TokenPair(
        access_token=access,
        refresh_token=refresh_value,
        expires_in=settings.access_token_ttl_minutes * 60,
        user=serialise_user(db, user),
    )


@router.post("/login", response_model=TokenPair, summary="Local sign-in")
def login(payload: LoginRequest, request: Request, db: DbSession) -> TokenPair:
    user = db.execute(
        select(User).where(User.email == payload.email.lower(), User.is_deleted.is_(False))
    ).scalar_one_or_none()

    generic = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect e-mail address or password.",
    )
    if user is None:
        raise generic

    # AC-04: account lockout after repeated failures.
    if user.locked_until and user.locked_until > utcnow():
        remaining = int((user.locked_until - utcnow()).total_seconds() // 60) + 1
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Account locked after repeated failed sign-ins. Try again in {remaining} minute(s).",
        )

    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not active. Contact your administrator.",
        )

    if not verify_password(payload.password, user.password_hash):
        user.failed_login_count = (user.failed_login_count or 0) + 1
        if user.failed_login_count >= settings.max_failed_logins:
            user.locked_until = utcnow() + timedelta(minutes=settings.lockout_minutes)
            user.failed_login_count = 0
            user.status = UserStatus.LOCKED
        db.add(user)
        db.commit()
        audit.write_audit(
            db, entity_type="user", entity_id=user.id, action="login_failed",
            reason=f"Failed sign-in attempt for {user.email}.",
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"), commit=True,
        )
        raise generic

    if user.mfa_enabled:
        if not payload.totp_code:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="A 6-digit authenticator code is required.",
                headers={"X-MFA-Required": "1"},
            )
        if not verify_totp(user.mfa_secret, payload.totp_code):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The authenticator code is incorrect or has expired.",
            )

    user.failed_login_count = 0
    user.locked_until = None
    if user.status == UserStatus.LOCKED:
        user.status = UserStatus.ACTIVE
    user.last_login_at = utcnow()
    db.add(user)
    db.commit()

    audit.write_audit(
        db, entity_type="user", entity_id=user.id, action="login",
        reason=f"Signed in as {user.role}.",
        user_id=user.id, user_email=user.email,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"), commit=True,
    )
    return _issue_tokens(db, user, request)


@router.post("/refresh", response_model=TokenPair, summary="Exchange a refresh token")
def refresh(payload: RefreshRequest, request: Request, db: DbSession) -> TokenPair:
    token_hash = hash_token(payload.refresh_token)
    session = db.execute(
        select(SessionToken).where(SessionToken.token_hash == token_hash)
    ).scalar_one_or_none()

    if session is None or session.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="This session is no longer valid.")
    if session.expires_at < utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="This session has expired. Please sign in again.")

    user = db.get(User, session.user_id)
    if user is None or user.status != UserStatus.ACTIVE or user.is_deleted:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="This account is no longer active.")

    session.revoked_at = utcnow()
    db.add(session)
    db.commit()
    return _issue_tokens(db, user, request)


@router.post("/logout", summary="Revoke the current session")
def logout(payload: RefreshRequest, db: DbSession) -> dict:
    session = db.execute(
        select(SessionToken).where(SessionToken.token_hash == hash_token(payload.refresh_token))
    ).scalar_one_or_none()
    if session is not None:
        session.revoked_at = utcnow()
        db.add(session)
        db.commit()
    return {"detail": "Signed out."}


@router.get("/me", summary="Current user, roles, permissions and data scope")
def me(user: CurrentUser, db: DbSession) -> dict:
    return serialise_me(db, user)


@router.post("/password", summary="Change your own password")
def change_password(
    payload: PasswordChange, request: Request, user: CurrentUser, db: DbSession
) -> dict:
    if not verify_password(payload.current_password, user.password_hash):
        raise bad_request("Your current password is incorrect.")
    try:
        validate_password_policy(payload.new_password)
    except WeakPasswordError as exc:
        raise bad_request(str(exc)) from exc

    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    db.add(user)
    db.commit()

    audit.write_audit(
        db, entity_type="user", entity_id=user.id, action="password_change",
        reason="User changed their own password.",
        user_id=user.id, user_email=user.email,
        ip=request.client.host if request.client else None, commit=True,
    )
    return {"detail": "Password updated."}


@router.post("/mfa/setup", response_model=MfaSetupOut, summary="Begin TOTP enrolment")
def mfa_setup(user: CurrentUser, db: DbSession) -> MfaSetupOut:
    secret = new_totp_secret()
    user.mfa_secret = secret
    db.add(user)
    db.commit()
    return MfaSetupOut(secret=secret, provisioning_uri=totp_provisioning_uri(secret, user.email))


@router.post("/mfa/verify", summary="Confirm TOTP enrolment")
def mfa_verify(payload: MfaVerify, request: Request, user: CurrentUser, db: DbSession) -> dict:
    if not verify_totp(user.mfa_secret, payload.code):
        raise bad_request("That code did not match. Check your authenticator app and try again.")
    user.mfa_enabled = True
    db.add(user)
    db.commit()
    audit.write_audit(
        db, entity_type="user", entity_id=user.id, action="mfa_enabled",
        user_id=user.id, user_email=user.email,
        ip=request.client.host if request.client else None, commit=True,
    )
    return {"detail": "Two-factor authentication is now enabled."}


@router.post("/mfa/disable", summary="Turn off TOTP (Admin only in practice)")
def mfa_disable(request: Request, user: CurrentUser, db: DbSession) -> dict:
    user.mfa_enabled = False
    user.mfa_secret = None
    db.add(user)
    db.commit()
    audit.write_audit(
        db, entity_type="user", entity_id=user.id, action="mfa_disabled",
        reason="Two-factor authentication turned off.",
        user_id=user.id, user_email=user.email,
        ip=request.client.host if request.client else None, commit=True,
    )
    return {"detail": "Two-factor authentication disabled."}


# --------------------------------------------------------------------------- #
# Entra ID (Azure AD) OIDC
# --------------------------------------------------------------------------- #
@router.get("/sso/config", summary="Is Entra ID SSO configured?")
def sso_config() -> dict:
    return {
        "enabled": bool(settings.entra_tenant_id and settings.entra_client_id),
        "authority": (
            f"https://login.microsoftonline.com/{settings.entra_tenant_id}"
            if settings.entra_tenant_id else None
        ),
        "client_id": settings.entra_client_id or None,
        "redirect_uri": settings.entra_redirect_uri,
        "scopes": ["openid", "profile", "email", "User.Read"],
    }


@router.get("/sso/authorize", summary="Start the Entra ID sign-in redirect")
def sso_authorize(state: str = "") -> dict:
    if not (settings.entra_tenant_id and settings.entra_client_id):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Entra ID SSO is not configured. Set ENTRA_TENANT_ID and ENTRA_CLIENT_ID, "
                   "or sign in with your local account.",
        )
    authorize_url = (
        f"https://login.microsoftonline.com/{settings.entra_tenant_id}/oauth2/v2.0/authorize"
        f"?client_id={settings.entra_client_id}"
        f"&response_type=code&redirect_uri={settings.entra_redirect_uri}"
        f"&response_mode=query&scope=openid%20profile%20email%20User.Read&state={state}"
    )
    return {"authorize_url": authorize_url}


@router.post("/sso/callback", response_model=TokenPair, summary="Complete the Entra ID sign-in")
def sso_callback(code: str, request: Request, db: DbSession) -> TokenPair:
    """Exchange the authorisation code, then match or provision the local user.

    The Graph call is intentionally isolated here so an air-gapped deployment
    can keep local auth only and leave this endpoint unconfigured.
    """
    if not (settings.entra_tenant_id and settings.entra_client_id):
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED,
                            detail="Entra ID SSO is not configured.")

    import httpx

    token_url = f"https://login.microsoftonline.com/{settings.entra_tenant_id}/oauth2/v2.0/token"
    data = {
        "client_id": settings.entra_client_id,
        "client_secret": settings.entra_client_secret,
        "code": code,
        "redirect_uri": settings.entra_redirect_uri,
        "grant_type": "authorization_code",
        "scope": "openid profile email User.Read",
    }
    try:
        response = httpx.post(token_url, data=data, timeout=20)
        response.raise_for_status()
        access_token = response.json()["access_token"]
        profile = httpx.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"}, timeout=20,
        ).json()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY,
                            detail=f"Could not complete the Entra ID sign-in: {exc}") from exc

    email = (profile.get("mail") or profile.get("userPrincipalName") or "").lower()
    if not email:
        raise bad_request("Entra ID did not return an e-mail address for this account.")

    user = db.execute(
        select(User).where(User.email == email, User.is_deleted.is_(False))
    ).scalar_one_or_none()

    if user is None:
        # JIT provisioning: a first-time SSO user lands as a Department User and
        # an Administrator must grant a wider role (Section 9).
        user = User(
            name=profile.get("displayName") or email,
            email=email,
            entra_object_id=profile.get("id"),
            role="Department User",
            status=UserStatus.ACTIVE,
        )
        db.add(user)
        db.flush()
        audit.write_audit(
            db, entity_type="user", entity_id=user.id, action="sso_provision",
            reason="Account provisioned on first Entra ID sign-in.",
            user_email=email, commit=True,
        )
    else:
        user.entra_object_id = profile.get("id") or user.entra_object_id

    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="This account is not active.")

    user.last_login_at = utcnow()
    db.add(user)
    db.commit()
    return _issue_tokens(db, user, request)
