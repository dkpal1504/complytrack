"""HTTP tests for authentication: login, MFA, refresh, logout, /me.

Every request goes through the real FastAPI stack with a Bearer token minted by
the real endpoint, against the per-test SQLite database.
"""

from __future__ import annotations

import pyotp
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.security import hash_password
from app.db.seed import DEFAULT_PASSWORD
from app.models.auth import User
from tests.conftest import login

ADMIN = "admin@complytrack.local"


def test_login_returns_a_token_pair_and_the_user(demo, client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD})
    assert response.status_code == 200
    payload = response.json()
    assert payload["token_type"] == "bearer"
    assert payload["expires_in"] == settings.access_token_ttl_minutes * 60
    assert payload["access_token"] and payload["refresh_token"]
    assert payload["user"]["email"] == ADMIN
    assert payload["user"]["role"] == "Administrator"


def test_login_is_case_insensitive_on_the_email(demo, client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"email": ADMIN.upper(), "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200


def test_login_with_the_wrong_password_is_rejected(demo, client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": ADMIN, "password": "Wrong@1234"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect e-mail address or password."


def test_login_with_an_unknown_email_is_rejected(demo, client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"email": "nobody@complytrack.local", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect e-mail address or password."


def test_login_with_a_malformed_email_is_a_validation_error(demo, client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": "not-an-email", "password": "x"})
    assert response.status_code == 422


def test_repeated_failures_lock_the_account(demo, client: TestClient) -> None:
    for _ in range(settings.max_failed_logins):
        attempt = client.post("/api/v1/auth/login", json={"email": ADMIN, "password": "Wrong@1234"})
        assert attempt.status_code == 401

    locked = client.post("/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD})
    assert locked.status_code == 423
    assert "locked" in locked.json()["detail"].lower()


def test_an_inactive_account_cannot_sign_in(demo, client: TestClient) -> None:
    user = demo.query(User).filter(User.email == ADMIN).one()
    user.status = "Inactive"
    demo.commit()

    response = client.post("/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD})
    assert response.status_code == 403


def test_me_returns_roles_permissions_and_scope(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["email"] == ADMIN
    assert payload["roles"] == ["Administrator"]
    assert "manage_org" in payload["permissions"]
    assert "verify_close" not in payload["permissions"]  # segregation of duties
    assert payload["scope"] == {
        "all_units": True,
        "unit_ids": [],
        "all_departments": True,
        "department_id": payload["department_id"],
        "read_only": False,
    }


def test_me_scopes_a_department_user_to_their_own_rows(demo, client: TestClient) -> None:
    headers = login(client, "safety.owner@complytrack.local")
    scope = client.get("/api/v1/auth/me", headers=headers).json()["scope"]
    assert scope["all_units"] is False
    assert scope["all_departments"] is False
    assert scope["read_only"] is False


def test_me_marks_read_only_roles(demo, client: TestClient) -> None:
    headers = login(client, "auditor@complytrack.local")
    scope = client.get("/api/v1/auth/me", headers=headers).json()["scope"]
    assert scope["read_only"] is True


def test_me_without_a_token_is_unauthorised(demo, client: TestClient) -> None:
    assert client.get("/api/v1/auth/me").status_code == 401


def test_me_with_a_bogus_token_is_unauthorised(demo, client: TestClient) -> None:
    response = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-token"})
    assert response.status_code == 401


def test_refresh_rotates_the_token_and_revokes_the_old_one(demo, client: TestClient) -> None:
    first = client.post(
        "/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD}
    ).json()

    refreshed = client.post("/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert refreshed.status_code == 200
    assert refreshed.json()["refresh_token"] != first["refresh_token"]

    reused = client.post("/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert reused.status_code == 401


def test_refresh_with_an_unknown_token_is_rejected(demo, client: TestClient) -> None:
    response = client.post("/api/v1/auth/refresh", json={"refresh_token": "nope"})
    assert response.status_code == 401


def test_logout_revokes_the_refresh_token(demo, client: TestClient) -> None:
    session = client.post(
        "/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD}
    ).json()

    out = client.post("/api/v1/auth/logout", json={"refresh_token": session["refresh_token"]})
    assert out.status_code == 200
    assert out.json() == {"detail": "Signed out."}

    assert client.post(
        "/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}
    ).status_code == 401


def test_logout_with_an_unknown_token_is_still_a_success(demo, client: TestClient) -> None:
    response = client.post("/api/v1/auth/logout", json={"refresh_token": "nope"})
    assert response.status_code == 200


# --------------------------------------------------------------------------- #
# TOTP MFA
# --------------------------------------------------------------------------- #
def test_mfa_enrolment_then_login_requires_a_code(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)

    setup = client.post("/api/v1/auth/mfa/setup", headers=headers)
    assert setup.status_code == 200
    secret = setup.json()["secret"]
    assert setup.json()["provisioning_uri"].startswith("otpauth://totp/")

    verified = client.post(
        "/api/v1/auth/mfa/verify", headers=headers, json={"code": pyotp.TOTP(secret).now()}
    )
    assert verified.status_code == 200
    assert verified.json()["detail"] == "Two-factor authentication is now enabled."

    without_code = client.post(
        "/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD}
    )
    assert without_code.status_code == 401
    assert without_code.headers.get("X-MFA-Required") == "1"

    wrong_code = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN, "password": DEFAULT_PASSWORD, "totp_code": "000000"},
    )
    assert wrong_code.status_code == 401

    with_code = client.post(
        "/api/v1/auth/login",
        json={"email": ADMIN, "password": DEFAULT_PASSWORD, "totp_code": pyotp.TOTP(secret).now()},
    )
    assert with_code.status_code == 200


def test_mfa_disable_restores_password_only_login(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    secret = client.post("/api/v1/auth/mfa/setup", headers=headers).json()["secret"]
    client.post("/api/v1/auth/mfa/verify", headers=headers, json={"code": pyotp.TOTP(secret).now()})

    disabled = client.post("/api/v1/auth/mfa/disable", headers=headers)
    assert disabled.status_code == 200

    assert client.post(
        "/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD}
    ).status_code == 200


def test_mfa_verify_rejects_a_bad_code(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    client.post("/api/v1/auth/mfa/setup", headers=headers)
    response = client.post("/api/v1/auth/mfa/verify", headers=headers, json={"code": "123456"})
    assert response.status_code == 400


# --------------------------------------------------------------------------- #
# Password change
# --------------------------------------------------------------------------- #
def test_password_change_requires_the_current_password(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    response = client.post(
        "/api/v1/auth/password",
        headers=headers,
        json={"current_password": "Nope@1234", "new_password": "Brand@New9"},
    )
    assert response.status_code == 400


def test_password_change_enforces_the_policy(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    response = client.post(
        "/api/v1/auth/password",
        headers=headers,
        json={"current_password": DEFAULT_PASSWORD, "new_password": "weakpassword"},
    )
    assert response.status_code == 400
    assert "uppercase" in response.json()["detail"]


def test_password_change_lets_the_new_password_sign_in(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    changed = client.post(
        "/api/v1/auth/password",
        headers=headers,
        json={"current_password": DEFAULT_PASSWORD, "new_password": "Brand@New2026"},
    )
    assert changed.status_code == 200

    assert client.post(
        "/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD}
    ).status_code == 401
    assert client.post(
        "/api/v1/auth/login", json={"email": ADMIN, "password": "Brand@New2026"}
    ).status_code == 200


# --------------------------------------------------------------------------- #
# Entra ID SSO (must degrade cleanly when unconfigured — no network)
# --------------------------------------------------------------------------- #
def test_sso_config_reports_disabled_when_unconfigured(demo, client: TestClient) -> None:
    payload = client.get("/api/v1/auth/sso/config").json()
    assert payload["enabled"] is False


def test_sso_authorize_is_not_implemented_when_unconfigured(demo, client: TestClient) -> None:
    assert client.get("/api/v1/auth/sso/authorize").status_code == 501


def test_sso_callback_is_not_implemented_when_unconfigured(demo, client: TestClient) -> None:
    assert client.post("/api/v1/auth/sso/callback", params={"code": "x"}).status_code == 501


def test_login_audits_every_attempt(demo, client: TestClient) -> None:
    from sqlalchemy import select

    from app.models.audit import AuditLog

    login(client, ADMIN)
    client.post("/api/v1/auth/login", json={"email": ADMIN, "password": "Wrong@1234"})

    actions = set(demo.execute(select(AuditLog.action)).scalars().all())
    assert {"login", "login_failed"} <= actions


def test_a_session_that_is_no_longer_active_cannot_refresh(demo, client: TestClient) -> None:
    session = client.post(
        "/api/v1/auth/login", json={"email": ADMIN, "password": DEFAULT_PASSWORD}
    ).json()

    user = demo.query(User).filter(User.email == ADMIN).one()
    user.status = "Inactive"
    user.password_hash = hash_password(DEFAULT_PASSWORD)
    demo.commit()

    response = client.post("/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]})
    assert response.status_code == 403
