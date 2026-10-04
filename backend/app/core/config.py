"""Application configuration.

Everything is overridable through environment variables (or a .env file) so the
same image runs on a laptop with SQLite and on an India-hosted server with
PostgreSQL + S3-compatible object storage, without a code change.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    # --- identity -----------------------------------------------------------
    app_name: str = "ComplyTrack"
    environment: str = "development"
    debug: bool = True

    # --- persistence --------------------------------------------------------
    # SQLite keeps the app zero-setup; point this at PostgreSQL in production.
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'complytrack.db').as_posix()}"
    storage_dir: Path = BACKEND_DIR / "storage"

    # --- auth ---------------------------------------------------------------
    secret_key: str = "dev-only-secret-change-me-in-production-0123456789abcdef"
    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 7
    session_idle_timeout_minutes: int = 60
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    password_min_length: int = 12

    # Entra ID (Azure AD) OIDC. Left blank the app runs local-auth only.
    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_client_secret: str = ""
    entra_redirect_uri: str = "http://localhost:8000/api/auth/sso/callback"

    # --- mail ---------------------------------------------------------------
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "complytrack@example.com"
    smtp_use_tls: bool = True
    # When no SMTP host is configured the mailer writes .eml files here instead
    # of sending, so reminders are fully testable offline.
    mail_outbox_dir: Path = BACKEND_DIR / "outbox"

    # --- engine behaviour ---------------------------------------------------
    scheduler_enabled: bool = True
    scheduler_hour_ist: int = 7
    quiet_hours_start: int = 21
    quiet_hours_end: int = 7
    # Anchor reminders on the renewal-due date for licences (leaves processing
    # time) and on the statutory due date for filings. See PRD business rule 2.
    default_reminder_offsets: list[int] = [90, 60, 30, 15, 7, 3, 1, 0]
    post_expiry_frequency_days: int = 2

    # --- first-run behaviour ------------------------------------------------
    # Seeding is idempotent: reference data loads once, then never again.
    seed_on_startup: bool = True
    seed_demo_data: bool = True

    # --- support / packaging ------------------------------------------------
    support_email: str = "compliance.helpdesk@example.invalid"
    # When the built SPA is present it is served from the API origin.
    frontend_dist_dir: Path | None = BACKEND_DIR.parent / "frontend" / "dist"

    # --- limits -------------------------------------------------------------
    max_upload_mb: int = 25
    max_upload_bytes: int = 25 * 1024 * 1024
    allowed_upload_extensions: list[str] = [
        ".pdf", ".jpg", ".jpeg", ".png", ".docx", ".xlsx", ".doc", ".xls",
    ]
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
    ]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    settings.mail_outbox_dir.mkdir(parents=True, exist_ok=True)
    return settings


settings = get_settings()
