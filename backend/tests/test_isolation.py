"""The suite's own safety rails.

Every other module trusts these guarantees, so they are pinned here rather than
just documented in ``conftest``: the live development database and outbox must
never be opened, the scheduler must never start, and no test may reach the
network.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import settings
from app.db.seed import DEFAULT_PASSWORD
from app.db.session import engine
from app.scheduler import get_scheduler
from tests.conftest import FROZEN_TODAY, ROLE_ACCOUNTS


def test_the_app_is_bound_to_a_throwaway_database() -> None:
    url = str(engine.url)
    assert "complytrack-tests-" in url
    assert "complytrack.db" not in url
    assert settings.database_url == url or "complytrack-tests-" in settings.database_url
    assert not settings.seed_on_startup and not settings.seed_demo_data


def test_the_storage_and_outbox_are_redirected_beneath_tmp_path(
    client: TestClient, tmp_path: Path
) -> None:
    assert settings.storage_dir == tmp_path / "storage"
    assert settings.mail_outbox_dir == tmp_path / "outbox"
    assert settings.storage_dir.is_dir() and settings.mail_outbox_dir.is_dir()
    assert settings.storage_dir.is_relative_to(tmp_path)
    assert settings.mail_outbox_dir.is_relative_to(tmp_path)


def test_the_scheduler_is_never_started(client: TestClient) -> None:
    assert settings.scheduler_enabled is False
    scheduler = get_scheduler()
    assert scheduler is None or not scheduler.running


def test_no_test_can_reach_an_smtp_host() -> None:
    # With no host configured the mailer spools each message to a .eml file
    # instead of opening a socket, which is what keeps the suite offline.
    assert not settings.smtp_host
    assert settings.mail_outbox_dir.name == "outbox"


def test_the_suite_has_one_account_for_each_of_the_five_roles() -> None:
    assert set(ROLE_ACCOUNTS) == {"admin", "compliance", "department", "management", "auditor"}
    assert len(set(ROLE_ACCOUNTS.values())) == 5


def test_the_frozen_clock_is_a_fixed_date() -> None:
    assert FROZEN_TODAY == date(2026, 6, 15)


def test_each_sign_in_opens_its_own_session(demo, client: TestClient) -> None:
    """Two logins in one test must not tread on each other's session."""
    email = ROLE_ACCOUNTS["admin"]
    body = {"email": email, "password": DEFAULT_PASSWORD}
    first = client.post("/api/v1/auth/login", json=body)
    second = client.post("/api/v1/auth/login", json=body)
    assert first.status_code == second.status_code == 200

    # The access token is a stateless JWT (identical within the same second);
    # the refresh token is the session handle, and it must be unique per login.
    assert first.json()["refresh_token"] != second.json()["refresh_token"]

    for response in (first, second):
        headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
        assert client.get("/api/v1/auth/me", headers=headers).status_code == 200
