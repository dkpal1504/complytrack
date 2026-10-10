"""Where the mailer's settings come from, and which source wins."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.org import Setting
from app.services import mail_config


def store(db: Session, **values: object) -> None:
    """Write mail keys as the settings screen would."""
    for key, value in values.items():
        db.add(Setting(key=key, value=value))
    db.commit()


@pytest.fixture(autouse=True)
def _no_environment_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """The suite never configures SMTP, so start from a silent environment."""
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "smtp_use_ssl", False)


def test_nothing_configured_anywhere_means_spooling(db: Session) -> None:
    cfg = mail_config.resolve(db)
    assert cfg.source == mail_config.SOURCE_UNCONFIGURED
    assert cfg.configured is False
    assert cfg.mode == "spool"


def test_a_stored_host_is_used_when_the_environment_is_silent(db: Session) -> None:
    store(db, smtp_host="relay.internal", smtp_port=2525, smtp_from="alerts@shipyard.in")

    cfg = mail_config.resolve(db)
    assert cfg.source == mail_config.SOURCE_SETTINGS
    assert cfg.configured is True
    assert cfg.host == "relay.internal"
    assert cfg.port == 2525
    assert cfg.sender == "alerts@shipyard.in"
    assert cfg.read_only is False


def test_an_environment_host_settles_every_field(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The environment is authoritative outright, not field by field.

    A stale stored port or sender must not be able to tag along with a host that
    a deployment has deliberately pinned.
    """
    store(db, smtp_host="stale.internal", smtp_port=2525, smtp_from="stale@shipyard.in")
    monkeypatch.setattr(settings, "smtp_host", "relay.internal")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_from", "ops@shipyard.in")

    cfg = mail_config.resolve(db)
    assert cfg.source == mail_config.SOURCE_ENVIRONMENT
    assert cfg.host == "relay.internal"
    assert cfg.port == 587
    assert cfg.sender == "ops@shipyard.in"
    assert cfg.read_only is True


def test_no_session_reads_the_environment_only(db: Session) -> None:
    """An isolated caller that passes no session cannot pick up stored values."""
    store(db, smtp_host="relay.internal")
    assert mail_config.resolve(None).configured is False


def test_implicit_ssl_supersedes_starttls(db: Session) -> None:
    """Both flags on would mean STARTTLS over an already-encrypted socket."""
    store(db, smtp_host="relay.internal", smtp_use_ssl=True, smtp_use_tls=True)

    cfg = mail_config.resolve(db)
    assert cfg.use_ssl is True
    assert cfg.use_tls is False


def test_stored_values_are_coerced_from_whatever_json_held(db: Session) -> None:
    """The generic editor stores strings, so a port can arrive as ``"2525"``."""
    store(db, smtp_host="relay.internal", smtp_port="2525", smtp_use_tls="false")

    cfg = mail_config.resolve(db)
    assert cfg.port == 2525
    assert cfg.use_tls is False


def test_a_blank_stored_host_is_not_treated_as_configured(db: Session) -> None:
    store(db, smtp_host="   ", smtp_port=587)
    assert mail_config.resolve(db).source == mail_config.SOURCE_UNCONFIGURED


def test_the_password_is_only_ever_reported_as_a_flag(db: Session) -> None:
    store(db, smtp_host="relay.internal", smtp_password="hunter2")
    cfg = mail_config.resolve(db)
    assert cfg.password_set is True
    assert cfg.password == "hunter2"  # the mailer still needs the real value


def test_a_soft_deleted_setting_is_ignored(db: Session) -> None:
    db.add(Setting(key="smtp_host", value="retired.internal", is_deleted=True))
    db.commit()
    assert mail_config.resolve(db).configured is False
