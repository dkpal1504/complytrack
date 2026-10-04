"""Engine / session wiring. Portable across SQLite and PostgreSQL."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """Declarative base for every ORM model."""


def _build_engine(url: str) -> Engine:
    kwargs: dict = {"future": True, "pool_pre_ping": True}
    if url.startswith("sqlite"):
        # check_same_thread=False lets the APScheduler background thread and the
        # request threads share one file-backed database.
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


engine = _build_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@event.listens_for(Engine, "connect")
def _enable_sqlite_foreign_keys(dbapi_connection, _record) -> None:
    """SQLite ignores FK constraints unless asked; the register relies on them."""
    if dbapi_connection.__class__.__module__.startswith("sqlite3"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a request-scoped session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create any missing tables. Migrations own schema changes in production."""
    from app import models  # noqa: F401  (registers metadata)

    Base.metadata.create_all(bind=engine)
