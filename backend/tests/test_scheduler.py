"""The scheduled-report sweep (RP-10).

The sweep is the one job that opens its own session rather than taking one from
the request, so the request-level tests never reach it. It is driven here with
the scheduler's own ``SessionLocal`` and clock pointed at the test database and
a chosen instant.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session
from starlette.testclient import TestClient

from app.core.config import settings
from app.models.reminders import ScheduledReport
from app.scheduler import run_scheduled_reports_job


@pytest.fixture
def wired(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> Session:
    """Point the sweep's own session factory at the test session.

    Depends on ``client`` so the outbox, the storage directory and the SMTP
    switch are the per-test ones — without it the sweep would spool a real
    message into the repository's own ``outbox/``.
    """
    import app.scheduler as scheduler

    monkeypatch.setattr(scheduler, "SessionLocal", lambda: db)
    monkeypatch.setattr(settings, "smtp_host", "")
    return db


def _due_report(db: Session, *, when: datetime, frequency: str = "weekly") -> ScheduledReport:
    report = ScheduledReport(
        report_code="R1",
        name="Compliance Status Report",
        recipients=["ehs@complytrack.local"],
        format="csv",
        frequency=frequency,
        next_run_at=when,
        active=True,
    )
    db.add(report)
    db.commit()
    return report


def _subject_of_the_only_message() -> str:
    """The Subject header of the message the sweep spooled to the outbox."""
    outbox = settings.mail_outbox_dir
    messages = sorted(outbox.glob("*.eml"))
    assert len(messages) == 1, f"expected one spooled message, found {len(messages)}"
    for line in messages[0].read_text(encoding="utf-8", errors="replace").splitlines():
        if line.lower().startswith("subject:"):
            return line.split(":", 1)[1].strip()
    raise AssertionError("the spooled message has no Subject header")


def test_a_due_schedule_is_delivered_and_rescheduled(
    demo: Session, wired: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The sweep sends what is due and moves the schedule on by its cadence.

    Nothing else exercises this path, and a schedule that is delivered but never
    rescheduled would re-send on every sweep, while one that is rescheduled but
    never delivered would go out silently missing.
    """
    import app.scheduler as scheduler

    moment = datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(scheduler, "utcnow", lambda: moment)
    report = _due_report(wired, when=moment - timedelta(hours=1))

    result = run_scheduled_reports_job()

    assert result == {"sent": 1}
    wired.expire_all()
    stored = wired.get(ScheduledReport, report.id)
    assert stored.last_run_at is not None
    assert stored.next_run_at == moment + timedelta(days=7), "a weekly schedule moves a week on"
    assert _subject_of_the_only_message().startswith("ComplyTrack Compliance Status Report")


def test_a_schedule_that_is_not_due_yet_is_left_alone(
    demo: Session, wired: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Future schedules are skipped — the sweep is a poll, not a send-all."""
    import app.scheduler as scheduler

    moment = datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(scheduler, "utcnow", lambda: moment)
    report = _due_report(wired, when=moment + timedelta(hours=1))

    assert run_scheduled_reports_job() == {"sent": 0}
    wired.expire_all()
    assert wired.get(ScheduledReport, report.id).last_run_at is None


def test_the_digest_is_dated_by_the_ist_day(
    demo: Session, wired: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The subject names the day its readers are living in, which is an IST one.

    2026-07-01 20:30 UTC is 02:00 IST on 2 July: the compliance team receives
    this on the morning of the 2nd, so a subject dated the 1st is a day out. The
    same instant written as a bare UTC date is what this pins.
    """
    import app.scheduler as scheduler

    monkeypatch.setattr(
        scheduler, "utcnow", lambda: datetime(2026, 7, 1, 20, 30, tzinfo=timezone.utc)
    )
    _due_report(wired, when=datetime(2026, 7, 1, 20, 0, tzinfo=timezone.utc))

    assert run_scheduled_reports_job() == {"sent": 1}
    assert _subject_of_the_only_message().endswith("2026-07-02")


def test_an_inactive_schedule_is_never_sent(
    demo: Session, wired: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Pausing a schedule in the UI means it stops, not that it keeps going."""
    import app.scheduler as scheduler

    moment = datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(scheduler, "utcnow", lambda: moment)
    report = _due_report(wired, when=moment - timedelta(days=1))
    report.active = False
    wired.add(report)
    wired.commit()

    assert run_scheduled_reports_job() == {"sent": 0}
    assert not list(settings.mail_outbox_dir.glob("*.eml"))


def test_a_schedule_with_no_next_run_is_invisible(
    demo: Session, wired: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A row with no ``next_run_at`` is never picked up."""
    import app.scheduler as scheduler

    monkeypatch.setattr(scheduler, "utcnow", lambda: datetime(2026, 7, 1, 4, 0, tzinfo=timezone.utc))
    wired.add(
        ScheduledReport(
            report_code="R1", name="Compliance Status Report", format="csv",
            recipients=["ehs@complytrack.local"], frequency="daily", next_run_at=None,
        )
    )
    wired.commit()

    assert run_scheduled_reports_job() == {"sent": 0}
