"""Shared pytest fixtures for the ComplyTrack backend suite.

Isolation guarantees enforced here:

* the live development database (``backend/complytrack.db``) is never opened:
  configuration is redirected to a throwaway temp directory *before* ``app`` is
  imported, and each test additionally gets its own SQLite file under
  ``tmp_path`` with a freshly created schema;
* the document store and the mail outbox are redirected under ``tmp_path``, so
  nothing is written to ``backend/storage`` or ``backend/outbox`` and no
  network call is ever made (mail spools to a file when SMTP is unconfigured);
* the APScheduler is switched off and the FastAPI lifespan is not run, so no
  seeding, migration or background job leaks between tests.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest

# --------------------------------------------------------------------------- #
# 1. Repoint configuration at throwaway locations before importing the app.
#    ``app.core.config.settings`` is built at import time, so this must happen
#    first — otherwise ``app.db.session`` would bind to the dev database.
# --------------------------------------------------------------------------- #
_SESSION_TMP = Path(tempfile.mkdtemp(prefix="complytrack-tests-"))

os.environ["DATABASE_URL"] = f"sqlite:///{(_SESSION_TMP / 'unused.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(_SESSION_TMP / "storage")
os.environ["MAIL_OUTBOX_DIR"] = str(_SESSION_TMP / "outbox")
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["SEED_ON_STARTUP"] = "false"
os.environ["SEED_DEMO_DATA"] = "false"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

import app.models  # noqa: E402,F401  (registers every table on Base.metadata)
from app.core.config import settings  # noqa: E402
from app.db.seed import DEFAULT_PASSWORD, seed_all  # noqa: E402
from app.db.session import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

# A fixed "today" for every pure test that takes a ``today`` argument, so date
# arithmetic never depends on the wall clock.
FROZEN_TODAY = date(2026, 6, 15)

# The five roles the PRD defines, with one seeded account each (Section 9).
ROLE_ACCOUNTS: dict[str, str] = {
    "admin": "admin@complytrack.local",
    "compliance": "compliance@complytrack.local",
    "department": "safety.owner@complytrack.local",
    "management": "ceo@complytrack.local",
    "auditor": "auditor@complytrack.local",
}


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Remove the throwaway configuration directory once the run is over."""
    shutil.rmtree(_SESSION_TMP, ignore_errors=True)


@pytest.fixture(autouse=True, scope="session")
def _fast_password_hashing() -> Iterator[None]:
    """Seed accounts with a cheap bcrypt cost so the suite is not hash-bound.

    Only the cost factor changes — ``bcrypt.checkpw`` reads it from the stored
    hash — so sign-in, lockout and password-change behaviour is unchanged. The
    production cost (12) costs roughly a quarter of a second per seeded user,
    which would otherwise dominate every test that touches the demo register.
    """
    import bcrypt

    original = bcrypt.gensalt
    bcrypt.gensalt = lambda rounds=12, prefix=b"2b": original(rounds=4, prefix=prefix)
    try:
        yield
    finally:
        bcrypt.gensalt = original


# --------------------------------------------------------------------------- #
# 2. Per-test database
# --------------------------------------------------------------------------- #
@pytest.fixture
def db(tmp_path: Path) -> Iterator[Session]:
    """A clean, isolated SQLAlchemy session on a fresh SQLite file."""
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def client(db: Session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """A TestClient whose DB dependency is the per-test session.

    Storage, outbox and the scheduler are pointed at ``tmp_path`` and the
    lifespan is deliberately not run (no context manager), so no seeding of the
    development database can happen.
    """
    storage = tmp_path / "storage"
    outbox = tmp_path / "outbox"
    storage.mkdir(parents=True, exist_ok=True)
    outbox.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "storage_dir", storage)
    monkeypatch.setattr(settings, "mail_outbox_dir", outbox)
    monkeypatch.setattr(settings, "scheduler_enabled", False)

    def _override() -> Iterator[Session]:
        yield db

    app.dependency_overrides[get_db] = _override
    test_client = TestClient(app, raise_server_exceptions=False)
    try:
        yield test_client
    finally:
        test_client.close()
        app.dependency_overrides.pop(get_db, None)


# --------------------------------------------------------------------------- #
# 3. Seeded data
# --------------------------------------------------------------------------- #
@pytest.fixture
def seeded(db: Session) -> Session:
    """Master data only: units, departments, categories, templates, settings."""
    seed_all(db, with_demo_data=False)
    return db


@pytest.fixture
def demo(db: Session) -> Session:
    """Master data plus the eleven accounts and the 80-item demo register."""
    seed_all(db, with_demo_data=True)
    return db


# --------------------------------------------------------------------------- #
# 4. Auth helper
# --------------------------------------------------------------------------- #
def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> dict[str, str]:
    """Sign in and return an ``Authorization: Bearer`` header dict."""
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def api_auth(client: TestClient, demo: Session) -> dict[str, dict[str, str]]:
    """Bearer headers for one account of each of the five PRD roles."""
    return {role: login(client, email) for role, email in ROLE_ACCOUNTS.items()}


# --------------------------------------------------------------------------- #
# 5. Time freeze helper
# --------------------------------------------------------------------------- #
@pytest.fixture
def frozen_today() -> date:
    """A stable ``today`` for the date/status functions that take one."""
    return FROZEN_TODAY
