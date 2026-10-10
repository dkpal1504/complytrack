"""The effective SMTP configuration, and where it came from.

The mailer used to read ``settings.smtp_*`` directly. It now goes through
:func:`resolve`, which layers two sources:

* the **environment** (``SMTP_*``, or ``backend/.env``), and
* the **settings screen**, which stores its values in the ``settings`` table.

The environment wins *outright*: if ``SMTP_HOST`` is set there, every other mail
field is taken from the environment too. The sources are deliberately not merged
field by field. A half-merged state — a host from the environment with a stale
sender or password from the database — is how a message ends up at the wrong
relay with the wrong credentials, which is precisely the failure this module
exists to make impossible. The settings screen shows every field read-only when
the environment is in charge, so the precedence is visible rather than implied.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.org import Setting

#: Settings-table keys holding mail configuration. ``smtp_password`` is a secret
#: and must never be echoed by a generic settings listing — see
#: ``app/api/routes/org.py``.
DB_KEYS = (
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_password",
    "smtp_from",
    "smtp_use_tls",
    "smtp_use_ssl",
)

#: Keys whose values are secrets. Routes that list settings wholesale must omit
#: or mask these.
SECRET_KEYS = frozenset({"smtp_password"})

SOURCE_ENVIRONMENT = "environment"
SOURCE_SETTINGS = "settings"
SOURCE_UNCONFIGURED = "unconfigured"


@dataclass(frozen=True, slots=True)
class MailConfig:
    """Where mail should go, and how, once both sources have been considered."""

    host: str = ""
    port: int = 587
    user: str = ""
    password: str = ""
    sender: str = "complytrack@example.com"
    use_tls: bool = True
    use_ssl: bool = False
    source: str = SOURCE_UNCONFIGURED

    @property
    def configured(self) -> bool:
        """True when a real SMTP send will be attempted (rather than spooling)."""
        return bool(self.host)

    @property
    def read_only(self) -> bool:
        """True when the environment is in charge and the UI must not offer edits."""
        return self.source == SOURCE_ENVIRONMENT

    @property
    def mode(self) -> str:
        """``"smtp"`` when sending, ``"spool"`` when writing to the outbox."""
        return "smtp" if self.configured else "spool"

    @property
    def password_set(self) -> bool:
        return bool(self.password)


def _as_int(value: object, fallback: int) -> int:
    """Coerce a stored JSON value to a port number, tolerating junk."""
    if isinstance(value, bool) or value is None:
        return fallback
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback


def _as_bool(value: object, fallback: bool) -> bool:
    """Coerce a stored JSON value to a flag.

    JSON preserves real booleans, but a value typed into the generic settings
    editor arrives as the string ``"true"``.
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return fallback
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _as_str(value: object, fallback: str = "") -> str:
    if value is None:
        return fallback
    return str(value)


def _stored(db: Session | None) -> dict[str, object]:
    """The mail keys held in the settings table, ignoring soft-deleted rows."""
    if db is None:
        return {}
    rows = db.execute(
        select(Setting).where(Setting.key.in_(DB_KEYS), Setting.is_deleted.is_(False))
    ).scalars().all()
    return {row.key: row.value for row in rows}


def resolve(db: Session | None = None) -> MailConfig:
    """The mail configuration to use, preferring the environment.

    Pass a session to let the settings screen's values take part; pass ``None``
    to read the environment alone (which is what an isolated test expects).
    """
    # An environment host is a deliberate deployment decision, so it settles the
    # whole block rather than just the host.
    if (settings.smtp_host or "").strip():
        return MailConfig(
            host=settings.smtp_host.strip(),
            port=settings.smtp_port,
            user=settings.smtp_user,
            password=settings.smtp_password,
            sender=settings.smtp_from,
            use_ssl=settings.smtp_use_ssl,
            # Implicit TLS and STARTTLS cannot both apply: STARTTLS on a socket
            # that is already TLS is an error, so SSL wins when both are set.
            use_tls=settings.smtp_use_tls and not settings.smtp_use_ssl,
            source=SOURCE_ENVIRONMENT,
        )

    stored = _stored(db)
    host = _as_str(stored.get("smtp_host")).strip()
    use_ssl = _as_bool(stored.get("smtp_use_ssl"), False)

    return MailConfig(
        host=host,
        port=_as_int(stored.get("smtp_port"), 587),
        user=_as_str(stored.get("smtp_user")),
        password=_as_str(stored.get("smtp_password")),
        sender=_as_str(stored.get("smtp_from"), "complytrack@example.com"),
        use_ssl=use_ssl,
        use_tls=_as_bool(stored.get("smtp_use_tls"), True) and not use_ssl,
        source=SOURCE_SETTINGS if host else SOURCE_UNCONFIGURED,
    )
