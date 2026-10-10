"""Configuring SMTP from the app, and proving that mail actually goes out."""

from __future__ import annotations

from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services import mail_config, notifications
from app.services import reminders as reminder_service
from tests.conftest import ROLE_ACCOUNTS, login

ADMIN = ROLE_ACCOUNTS["admin"]
COMPLIANCE = ROLE_ACCOUNTS["compliance"]

MAIL = "/api/v1/reminders/mail"
TEST_EMAIL = "/api/v1/reminders/test-email"
OUTBOX = "/api/v1/reminders/outbox"


@pytest.fixture(autouse=True)
def _no_environment_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test here starts with a silent environment, so the DB is in charge."""
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "smtp_use_ssl", False)


class FakeSMTP:
    """Stands in for smtplib so no socket is ever opened."""

    instances: list["FakeSMTP"] = []

    def __init__(self, host: str, port: int, timeout: int | None = None) -> None:
        self.host, self.port = host, port
        self.messages: list[EmailMessage] = []
        self.started_tls = False
        self.logged_in: tuple[str, str] | None = None
        FakeSMTP.instances.append(self)

    def __enter__(self) -> "FakeSMTP":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def starttls(self) -> None:
        self.started_tls = True

    def login(self, user: str, password: str) -> None:
        self.logged_in = (user, password)

    def send_message(self, message: EmailMessage) -> None:
        self.messages.append(message)


@pytest.fixture
def fake_smtp(monkeypatch: pytest.MonkeyPatch) -> type[FakeSMTP]:
    FakeSMTP.instances = []
    monkeypatch.setattr(notifications.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(notifications.smtplib, "SMTP_SSL", FakeSMTP)
    return FakeSMTP


# --------------------------------------------------------------------------- #
# Permission
# --------------------------------------------------------------------------- #
def test_the_mail_settings_need_the_settings_permission(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    """COMPLIANCE can run the engine but must not see or change its credentials."""
    compliance = api_auth["compliance"]
    admin = api_auth["admin"]

    assert client.get(MAIL, headers=compliance).status_code == 403
    assert client.put(MAIL, json={"host": "relay.internal"}, headers=compliance).status_code == 403
    assert client.post(TEST_EMAIL, json={}, headers=compliance).status_code == 403
    assert client.get(f"{OUTBOX}/x.eml", headers=compliance).status_code == 403
    assert login(client, COMPLIANCE)  # the account is real; the permission is not held

    assert client.get(MAIL, headers=admin).status_code == 200


# --------------------------------------------------------------------------- #
# Storing and reading the configuration
# --------------------------------------------------------------------------- #
def test_settings_round_trip_without_ever_echoing_the_password(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    admin = api_auth["admin"]
    secret = "sup3r-s3cret-relay-password"

    saved = client.put(
        MAIL,
        json={
            "host": "relay.shipyard.in",
            "port": 587,
            "user": "complytrack",
            "password": secret,
            "sender": "complytrack@shipyard.in",
            "use_tls": True,
        },
        headers=admin,
    )
    assert saved.status_code == 200, saved.text
    assert secret not in saved.text

    fetched = client.get(MAIL, headers=admin).json()
    assert fetched["host"] == "relay.shipyard.in"
    assert fetched["user"] == "complytrack"
    assert fetched["sender"] == "complytrack@shipyard.in"
    assert fetched["password_set"] is True
    assert fetched["smtp_configured"] is True
    assert fetched["source"] == "settings"
    assert fetched["read_only"] is False
    assert secret not in client.get(MAIL, headers=admin).text

    # Leaving the password out of an update keeps the stored one.
    assert client.put(MAIL, json={"port": 2525}, headers=admin).status_code == 200
    after = client.get(MAIL, headers=admin).json()
    assert after["password_set"] is True
    assert after["port"] == 2525

    # An explicit empty string clears it.
    assert client.put(MAIL, json={"password": ""}, headers=admin).status_code == 200
    assert client.get(MAIL, headers=admin).json()["password_set"] is False


def test_the_environment_overrides_what_was_stored(
    client: TestClient, api_auth: dict[str, dict[str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A deployment that pins SMTP_HOST cannot be shadowed from the browser."""
    admin = api_auth["admin"]
    client.put(MAIL, json={"host": "stored.internal"}, headers=admin)

    monkeypatch.setattr(settings, "smtp_host", "relay.internal")

    effective = client.get(MAIL, headers=admin).json()
    assert effective["source"] == "environment"
    assert effective["read_only"] is True
    assert effective["host"] == "relay.internal"

    refused = client.put(MAIL, json={"host": "something.else"}, headers=admin)
    assert refused.status_code == 409, refused.text


def test_starttls_and_implicit_ssl_cannot_both_be_asked_for(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    response = client.put(
        MAIL, json={"host": "relay.internal", "use_tls": True, "use_ssl": True},
        headers=api_auth["admin"],
    )
    assert response.status_code == 400, response.text


def test_the_generic_settings_listing_never_exposes_the_password(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    """``GET /org/settings`` echoes stored values, so the secret must not be listed."""
    admin = api_auth["admin"]
    secret = "another-relay-password"
    client.put(MAIL, json={"host": "relay.internal", "password": secret}, headers=admin)

    listing = client.get("/api/v1/org/settings", headers=admin)
    assert listing.status_code == 200
    assert secret not in listing.text
    assert all(row["key"] != "smtp_password" for row in listing.json())


def test_the_smtp_password_is_not_written_to_the_audit_trail(
    client: TestClient, api_auth: dict[str, dict[str, str]], db: Session
) -> None:
    admin = api_auth["admin"]
    secret = "audit-proof-password"
    client.put(MAIL, json={"host": "relay.internal", "password": secret}, headers=admin)

    from sqlalchemy import select

    from app.models.audit import AuditLog

    rows = db.execute(select(AuditLog)).scalars().all()
    assert rows, "the change should have been audited"
    blob = " ".join(str([r.changes, r.old_value, r.new_value, r.reason]) for r in rows)
    assert secret not in blob
    assert "***redacted***" in blob


# --------------------------------------------------------------------------- #
# Test send
# --------------------------------------------------------------------------- #
def test_a_test_message_spools_when_no_mail_server_is_configured(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    result = client.post(TEST_EMAIL, json={}, headers=api_auth["admin"])
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["ok"] is True
    assert body["mode"] == "spool"
    assert body["to"] == ADMIN

    spooled = list(settings.mail_outbox_dir.glob("*.eml"))
    assert spooled, "the test message should have been written to the outbox"


def test_a_test_message_goes_through_smtp_once_configured(
    client: TestClient, api_auth: dict[str, dict[str, str]], fake_smtp: type[FakeSMTP]
) -> None:
    admin = api_auth["admin"]
    client.put(
        MAIL,
        json={
            "host": "relay.shipyard.in", "port": 587, "user": "complytrack",
            "password": "pw", "sender": "complytrack@shipyard.in", "use_tls": True,
        },
        headers=admin,
    )

    result = client.post(TEST_EMAIL, json={"to": "tester@shipyard.in"}, headers=admin)
    assert result.status_code == 200, result.text
    assert result.json()["mode"] == "smtp"
    assert result.json()["to"] == "tester@shipyard.in"

    assert len(fake_smtp.instances) == 1
    server = fake_smtp.instances[0]
    assert (server.host, server.port) == ("relay.shipyard.in", 587)
    assert server.started_tls is True
    assert server.logged_in == ("complytrack", "pw")
    assert server.messages[0]["Subject"] == "[ComplyTrack] Test e-mail"


def test_implicit_ssl_is_used_when_it_is_asked_for(
    client: TestClient, api_auth: dict[str, dict[str, str]], fake_smtp: type[FakeSMTP]
) -> None:
    admin = api_auth["admin"]
    client.put(MAIL, json={"host": "relay.shipyard.in", "port": 465, "use_ssl": True}, headers=admin)

    client.post(TEST_EMAIL, json={}, headers=admin)

    server = fake_smtp.instances[0]
    assert (server.host, server.port) == ("relay.shipyard.in", 465)
    # STARTTLS on an implicit-TLS socket is an error, so it must not be attempted.
    assert server.started_tls is False


def test_a_refused_connection_is_reported_rather_than_raised(
    client: TestClient, api_auth: dict[str, dict[str, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A wrong password is an answer to show the operator, not a 500."""

    class Refusing(FakeSMTP):
        def __init__(self, host: str, port: int, timeout: int | None = None) -> None:
            raise OSError("Connection refused")

    monkeypatch.setattr(notifications.smtplib, "SMTP", Refusing)
    admin = api_auth["admin"]
    client.put(MAIL, json={"host": "relay.shipyard.in", "port": 587}, headers=admin)

    result = client.post(TEST_EMAIL, json={}, headers=admin)
    assert result.status_code == 200, result.text
    assert result.json()["ok"] is False
    assert "Connection refused" in result.json()["detail"]


def test_an_invalid_recipient_is_rejected_before_anything_is_sent(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    response = client.post(TEST_EMAIL, json={"to": "not-an-address"}, headers=api_auth["admin"])
    assert response.status_code == 422
    assert not list(settings.mail_outbox_dir.glob("*.eml"))


# --------------------------------------------------------------------------- #
# Reading a spooled message
# --------------------------------------------------------------------------- #
def test_a_spooled_message_can_be_read_back(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    admin = api_auth["admin"]
    client.post(TEST_EMAIL, json={}, headers=admin)

    listing = client.get(OUTBOX, headers=admin).json()
    assert listing["smtp_configured"] is False
    assert listing["count"] == 1
    name = listing["files"][0]["name"]

    message = client.get(f"{OUTBOX}/{name}", headers=admin)
    assert message.status_code == 200, message.text
    body = message.json()
    assert body["to"] == ADMIN
    assert body["subject"] == "[ComplyTrack] Test e-mail"
    assert "test message from ComplyTrack" in body["text"]
    assert body["html"] and "<p>" in body["html"]


def test_a_reminder_run_can_then_be_read_in_the_outbox(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    """The whole point: run the engine, then read what it would have sent."""
    admin = api_auth["admin"]
    run = client.post("/api/v1/reminders/run", headers=admin)
    assert run.status_code == 200, run.text

    listing = client.get(OUTBOX, headers=admin).json()
    assert listing["count"] > 0, "the seeded register should have produced reminders"

    first = listing["files"][0]["name"]
    body = client.get(f"{OUTBOX}/{first}", headers=admin).json()
    assert body["subject"], "a spooled reminder should carry a subject"
    assert body["text"], "a spooled reminder should carry a readable body"


@pytest.mark.parametrize(
    "name",
    [
        "../../etc/passwd",
        "..%2F..%2Fetc%2Fpasswd",
        "%2e%2e%2fsecret.eml",
        "sub/dir/message.eml",
        "message.txt",
        "no-extension",
        ".hidden.eml",
        "missing.eml",
    ],
)
def test_the_outbox_refuses_anything_that_is_not_a_spooled_message(
    client: TestClient, api_auth: dict[str, dict[str, str]], name: str
) -> None:
    response = client.get(f"{OUTBOX}/{name}", headers=api_auth["admin"])
    assert response.status_code == 404, f"{name} -> {response.status_code}"


def test_a_malformed_spool_file_does_not_crash_the_reader(
    client: TestClient, api_auth: dict[str, dict[str, str]]
) -> None:
    """A truncated file on disk is a bad file, not a server fault."""
    (settings.mail_outbox_dir / "20260101T000000000000_broken.eml").write_bytes(
        b"Subject: only a header line\r\n"
    )

    response = client.get(f"{OUTBOX}/20260101T000000000000_broken.eml", headers=api_auth["admin"])
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------- #
# The mailer itself
# --------------------------------------------------------------------------- #
def test_reminder_delivery_uses_the_stored_settings(
    client: TestClient, api_auth: dict[str, dict[str, str]], db: Session,
    fake_smtp: type[FakeSMTP],
) -> None:
    """A real reminder run must honour the settings screen, not just the test send."""
    admin = api_auth["admin"]
    client.put(
        MAIL,
        json={"host": "relay.shipyard.in", "port": 587, "sender": "complytrack@shipyard.in"},
        headers=admin,
    )

    sent = reminder_service.run_daily_reminders(db)
    assert sent["reminders_sent"] > 0, "the seeded register should have produced reminders"

    assert fake_smtp.instances, "delivery should have gone through SMTP"
    assert fake_smtp.instances[0].host == "relay.shipyard.in"
    # Nothing should have been spooled, because a relay was configured.
    assert not list(settings.mail_outbox_dir.glob("*.eml"))


def test_the_mailer_falls_back_to_spooling_without_a_session(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The pre-existing contract: no session, no configuration, a spooled file."""
    outbox = tmp_path / "outbox"
    outbox.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "mail_outbox_dir", outbox)

    result = notifications.deliver_email(
        to="someone@shipyard.in", subject="Direct", html="<p>Hello</p>"
    )
    assert result.ok is True
    assert "outbox" in result.detail
    assert len(list(outbox.glob("*.eml"))) == 1
    assert mail_config.resolve(None).configured is False


def test_messages_to_one_recipient_never_overwrite_each_other(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The spool names carry a clock that barely advances; nothing may be lost.

    On Windows ``datetime.now()`` moves about once a millisecond, so back-to-back
    messages to the same recipient used to be given the same filename and the
    second silently replaced the first. The outbox then showed fewer messages
    than the run produced — the one thing it exists to report accurately.
    """
    outbox = tmp_path / "outbox"
    outbox.mkdir()
    monkeypatch.setattr(settings, "mail_outbox_dir", outbox)

    for index in range(25):
        assert notifications.deliver_email(
            to="owner@shipyard.in", subject=f"Reminder {index}", html="<p>x</p>"
        ).ok

    written = list(outbox.glob("*.eml"))
    assert len(written) == 25

    subjects = {
        BytesParser(policy=policy.default).parsebytes(path.read_bytes())["Subject"]
        for path in written
    }
    assert subjects == {f"Reminder {index}" for index in range(25)}
