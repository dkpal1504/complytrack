"""APScheduler wiring for the daily reminder job, escalation sweep and digest.

The job is scheduled in IST so 07:00 means 07:00 for the compliance team, and
all timestamps it writes are still stored in UTC.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.db.session import SessionLocal
from app.db.types import utcnow
from app.domain.dates import IST, ist_today

logger = logging.getLogger("complytrack.scheduler")

JOB_ID = "daily-reminders"
_scheduler: BackgroundScheduler | None = None


def _next_ist_run(hour: int) -> datetime:
    now = datetime.now(IST)
    candidate = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate


def run_daily_reminders_job() -> dict:
    """Entry point APScheduler calls. Never raises: a failure is logged and
    recorded in ``job_run`` so the Admin dashboard can surface it."""
    from app.services import reminders

    with SessionLocal() as db:
        try:
            result = reminders.run_daily_reminders(db, now=utcnow(), commit=True)
            logger.info(
                "Daily reminder run: sent=%s escalations=%s skipped=%s",
                result.get("sent"), result.get("escalations"), result.get("skipped"),
            )
            return result
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            logger.exception("Daily reminder run failed")
            return {"ok": False, "error": str(exc)}


def run_scheduled_reports_job() -> dict:
    """Deliver any report schedules that are due (RP-10)."""
    from sqlalchemy import select

    from app.models.reminders import ScheduledReport
    from app.services import notifications, reports

    sent = 0
    with SessionLocal() as db:
        try:
            now = utcnow()
            rows = db.execute(
                select(ScheduledReport).where(
                    ScheduledReport.active.is_(True),
                    ScheduledReport.next_run_at.is_not(None),
                    ScheduledReport.next_run_at <= now,
                )
            ).scalars().all()

            for schedule in rows:
                try:
                    report = reports.build_report(db, schedule.report_code, _all_scope())
                    payload = {
                        "csv": reports.to_csv,
                        "xlsx": reports.to_excel,
                        "pdf": reports.to_pdf,
                    }.get(schedule.format, reports.to_excel)(report)
                    notifications.deliver_email(
                        to=",".join(schedule.recipients),
                        # The subject is read by the compliance team on their own
                        # calendar: a digest that goes out at 02:00 IST belongs to
                        # that IST day, not to the UTC day it shares with the
                        # evening before.
                        subject=f"ComplyTrack {report['name']} - {ist_today(now).isoformat()}",
                        html=f"<p>Attached: <strong>{report['name']}</strong> "
                             f"({len(report['rows'])} rows).</p>",
                        text=f"{report['name']}: {len(report['rows'])} rows.",
                        attachments=[(f"{report['code']}.{schedule.format}", payload,
                                      "application/octet-stream")],
                    )
                    schedule.last_run_at = now
                    sent += 1
                except Exception:  # noqa: BLE001
                    logger.exception("Scheduled report %s failed", schedule.id)
                schedule.next_run_at = next_run_after(schedule.frequency, now)
                db.add(schedule)
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("Scheduled report sweep failed")
    return {"sent": sent}


def next_run_after(frequency: str, now: datetime) -> datetime:
    """When a schedule on this cadence should next fire, counting from ``now``.

    Shared with the API that creates schedules: a row with no ``next_run_at``
    is invisible to the sweep below, so a schedule made through the UI would
    otherwise be stored, listed, and never delivered.
    """
    return {
        "daily": now + timedelta(days=1),
        "weekly": now + timedelta(days=7),
        "monthly": now + timedelta(days=30),
        "quarterly": now + timedelta(days=91),
    }.get(frequency, now + timedelta(days=7))


def _all_scope():
    from app.core.rbac import Scope

    return Scope(
        all_units=True, unit_ids=frozenset(), all_departments=True,
        department_id=None, user_id="system", own_rows_only=False,
    )


def build_scheduler() -> BackgroundScheduler:
    """Create and populate the scheduler. IST cron, so DST is a non-issue."""
    global _scheduler

    scheduler = BackgroundScheduler(timezone=IST)
    scheduler.add_job(
        run_daily_reminders_job,
        trigger=CronTrigger(hour=settings.scheduler_hour_ist, minute=0, timezone=IST),
        id=JOB_ID,
        name="Daily reminder and escalation run",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        run_scheduled_reports_job,
        trigger=CronTrigger(hour=settings.scheduler_hour_ist, minute=15, timezone=IST),
        id="scheduled-reports",
        name="Scheduled report delivery",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        misfire_grace_time=3600,
    )
    _scheduler = scheduler
    return scheduler


def get_scheduler() -> BackgroundScheduler | None:
    return _scheduler


def next_run_time() -> datetime | None:
    if _scheduler is None:
        return None
    job = _scheduler.get_job(JOB_ID)
    return job.next_run_time if job else None


if __name__ == "__main__":  # manual trigger: python -m app.scheduler
    logging.basicConfig(level=logging.INFO)
    print(run_daily_reminders_job())
