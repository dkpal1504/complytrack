"""HTTP tests for the reminder / escalation engine (RM-01..RM-11, AC-2).

The daily job is run through the real endpoint against the seeded demo estate.
Everything is idempotent by dedupe key, so a second run of the same day must not
create a single new reminder or escalation (RM-11 / AC-2).
"""

from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import settings
from app.domain.dates import reminder_anchor_date
from app.models.compliance import ComplianceInstance, ComplianceItem
from app.models.reminders import (
    EscalationLog,
    JobRun,
    ReminderLog,
    ReminderProfile,
)
from tests.conftest import login

ADMIN = "admin@complytrack.local"
COMPLIANCE = "compliance@complytrack.local"
DEPARTMENT = "safety.owner@complytrack.local"


def _counts(db) -> tuple[int, int]:
    return (
        db.execute(select(func.count()).select_from(ReminderLog)).scalar_one(),
        db.execute(select(func.count()).select_from(EscalationLog)).scalar_one(),
    )


# --------------------------------------------------------------------------- #
# The daily run (RM-11 / AC-2)
# --------------------------------------------------------------------------- #
def test_running_the_job_twice_duplicates_nothing(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    before = _counts(demo)

    first = client.post("/api/v1/reminders/run", headers=headers)
    assert first.status_code == 200
    after_first = _counts(demo)
    assert after_first[0] > before[0], "the demo estate is due reminders"
    assert after_first[1] > before[1], "the demo estate has overdue escalations"

    second = client.post("/api/v1/reminders/run", headers=headers)
    assert second.status_code == 200
    assert _counts(demo) == after_first

    assert second.json()["reminders_sent"] == 0
    assert second.json()["escalations"] == 0
    assert second.json()["failures"] == 0
    # Every reminder already on file is suppressed by its dedupe key.
    reminders_on_file = after_first[0]
    assert reminders_on_file > 0
    assert second.json()["skipped_duplicates"] == reminders_on_file


def test_the_run_reports_what_it_did(demo, client: TestClient) -> None:
    payload = client.post("/api/v1/reminders/run", headers=login(client, ADMIN)).json()

    assert {
        "ran_at", "reminders_sent", "escalations", "skipped_duplicates",
        "failures", "deferred", "instances_scanned", "errors", "details",
    } <= set(payload)
    assert payload["errors"] == []
    assert payload["instances_scanned"] > 0
    assert isinstance(payload["details"], list)


def test_every_reminder_carries_a_unique_dedupe_key(demo, client: TestClient) -> None:
    client.post("/api/v1/reminders/run", headers=login(client, ADMIN))

    keys = demo.execute(select(ReminderLog.dedupe_key)).scalars().all()
    assert len(keys) == len(set(keys))
    assert all(key.startswith("rem:") for key in keys)


def test_every_escalation_carries_a_unique_dedupe_key(demo, client: TestClient) -> None:
    client.post("/api/v1/reminders/run", headers=login(client, ADMIN))

    keys = demo.execute(select(EscalationLog.dedupe_key)).scalars().all()
    assert len(keys) == len(set(keys))
    assert all(key.startswith("esc:") for key in keys)


def test_each_run_is_recorded_as_a_job(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    client.post("/api/v1/reminders/run", headers=headers)
    client.post("/api/v1/reminders/run", headers=headers)

    runs = demo.execute(
        select(JobRun).where(JobRun.job_name == "daily_reminders")
    ).scalars().all()
    assert len(runs) == 2
    assert all(run.status == "Success" for run in runs)

    listed = client.get("/api/v1/reminders/jobs", headers=headers).json()
    assert len(listed) == 2
    assert listed[0]["finished_at"] is not None


def test_the_run_accepts_an_explicit_timestamp(demo, client: TestClient) -> None:
    """``at`` replays that day's window, not just the job row.

    The engine's whole job is to act on a date, and the replay affordance exists
    so an operator can work a day that was missed. It used to read the wall clock
    for the selection while stamping the job row with ``at`` — so a replay looked
    like it had worked the day and quietly sent nothing, which is the worst
    possible failure for a renewal deadline.
    """
    instance, item = demo.execute(
        select(ComplianceInstance, ComplianceItem)
        .join(ComplianceItem, ComplianceItem.id == ComplianceInstance.item_id)
        .where(ComplianceInstance.status == "Pending")
    ).first()

    anchor = reminder_anchor_date(
        anchor_on=item.anchor_on,
        expiry_date=item.expiry_date,
        renewal_due_date=item.renewal_due_date,
        statutory_due_date=instance.due_date,
    ) or instance.due_date or item.expiry_date
    assert anchor is not None, "the seeded estate should date every open cycle"

    # 30 days before the deadline is one of the configured offsets, so the
    # replayed day is a day the engine is supposed to send on.
    replay_day = anchor - timedelta(days=30)
    response = client.post(
        "/api/v1/reminders/run",
        headers=login(client, ADMIN),
        params={"at": f"{replay_day.isoformat()}T09:00:00"},
    )
    assert response.status_code == 200

    demo.expire_all()
    job = demo.execute(
        select(JobRun).where(JobRun.job_name == "daily_reminders")
    ).scalars().one()
    assert job.run_date == replay_day

    # The window followed the replayed date: the 30-day offset is the one that
    # fired — once per recipient and channel. (Whether the mail left immediately
    # or was parked for quiet hours is a separate question and another test's
    # business.)
    logged = demo.execute(
        select(ReminderLog).where(ReminderLog.instance_id == instance.id)
    ).scalars().all()
    assert logged, "the replayed day matched an offset but logged no reminder"
    assert {log.offset for log in logged} == {30}, (
        f"replaying {replay_day} selected offsets {sorted({log.offset for log in logged})}"
    )


def test_the_run_needs_the_engine_permission(demo, client: TestClient) -> None:
    response = client.post("/api/v1/reminders/run", headers=login(client, DEPARTMENT))
    assert response.status_code == 403
    assert "configure_engine" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# Delivery logs
# --------------------------------------------------------------------------- #
def test_the_reminder_log_reports_every_delivery(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    client.post("/api/v1/reminders/run", headers=headers)

    payload = client.get("/api/v1/reminders/log", headers=headers).json()
    assert payload["total"] > 0
    row = payload["rows"][0]
    assert {"instance_id", "offset", "channel", "recipient", "status", "dedupe_key"} <= set(row)


def test_the_reminder_log_filters_by_instance_and_limit(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    client.post("/api/v1/reminders/run", headers=headers)

    everything = client.get("/api/v1/reminders/log", headers=headers).json()
    instance_id = everything["rows"][0]["instance_id"]

    filtered = client.get(
        "/api/v1/reminders/log", headers=headers, params={"instance_id": instance_id}
    ).json()
    assert filtered["total"] >= 1
    assert {row["instance_id"] for row in filtered["rows"]} == {instance_id}

    assert len(
        client.get("/api/v1/reminders/log", headers=headers, params={"limit": 5}).json()["rows"]
    ) == 5

    channel = everything["rows"][0]["channel"]
    by_channel = client.get(
        "/api/v1/reminders/log", headers=headers, params={"channel": channel}
    ).json()
    assert {row["channel"] for row in by_channel["rows"]} == {channel}


def test_an_escalation_can_be_acknowledged(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    client.post("/api/v1/reminders/run", headers=headers)

    escalations = client.get("/api/v1/reminders/escalation-log", headers=headers).json()
    assert escalations
    row = escalations[0]
    assert {"level", "label", "notified_to", "triggered_at"} <= set(row)
    assert row["acknowledged_at"] is None

    acknowledged = client.post(
        f"/api/v1/reminders/escalations/{row['id']}/acknowledge",
        headers=headers,
        params={"outcome": "Handled by the unit head."},
    )
    assert acknowledged.status_code == 200
    assert acknowledged.json()["acknowledged_at"] is not None

    demo.expire_all()
    stored = demo.get(EscalationLog, row["id"])
    assert stored.outcome == "Handled by the unit head."
    assert stored.acknowledged_by is not None


def test_acknowledging_an_unknown_escalation_is_a_404(demo, client: TestClient) -> None:
    assert client.post(
        "/api/v1/reminders/escalations/nope/acknowledge",
        headers=login(client, ADMIN),
        params={"outcome": "Nothing to do."},
    ).status_code == 404


# --------------------------------------------------------------------------- #
# Profiles and the escalation matrix
# --------------------------------------------------------------------------- #
def test_the_escalation_matrix_exposes_the_live_ladder(demo, client: TestClient) -> None:
    payload = client.get(
        "/api/v1/reminders/escalation-matrix", headers=login(client, ADMIN)
    ).json()

    assert payload["profiles"], "the seed ships a default matrix"
    levels = payload["levels"]
    assert [lvl["level"] for lvl in levels] == sorted(lvl["level"] for lvl in levels)
    assert levels[0]["label"]

    default = next(p for p in payload["profiles"] if p["is_default"])
    assert default["rules"], "the default profile has rules"
    assert all(rule["label"] for rule in default["rules"])


def test_a_reminder_profile_can_be_created_and_edited(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)

    created = client.post(
        "/api/v1/reminders/profiles",
        headers=headers,
        json={
            "name": "Statutory 120/60/30",
            "offsets": [30, 120, 60, 30],
            "channels": ["email", "in_app"],
            "anchor_on": "statutory_due",
        },
    )
    assert created.status_code == 201
    profile = created.json()
    # Offsets are stored once each, furthest-out first.
    assert profile["offsets"] == [120, 60, 30]
    assert profile["anchor_on"] == "statutory_due"

    updated = client.patch(
        f"/api/v1/reminders/profiles/{profile['id']}",
        headers=headers,
        json={"post_expiry_frequency_days": 2},
    )
    assert updated.status_code == 200
    assert updated.json()["post_expiry_frequency_days"] == 2

    demo.expire_all()
    stored = demo.get(ReminderProfile, profile["id"])
    assert stored.post_expiry_frequency_days == 2


def test_editing_a_profile_needs_the_engine_permission(demo, client: TestClient) -> None:
    profile = demo.execute(select(ReminderProfile).limit(1)).scalar_one()
    response = client.patch(
        f"/api/v1/reminders/profiles/{profile.id}",
        headers=login(client, DEPARTMENT),
        json={"post_expiry_frequency_days": 3},
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------- #
# Templates and the outbox
# --------------------------------------------------------------------------- #
def test_email_templates_are_listed_with_their_placeholders(demo, client: TestClient) -> None:
    templates = client.get("/api/v1/reminders/templates", headers=login(client, ADMIN)).json()
    assert templates
    template = templates[0]
    assert {"code", "name", "subject", "body_html", "placeholders"} <= set(template)
    assert "Item" in template["placeholders"]
    assert "Days Left" in template["placeholders"]


def test_an_email_template_can_be_edited(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    template = client.get("/api/v1/reminders/templates", headers=headers).json()[0]

    updated = client.patch(
        f"/api/v1/reminders/templates/{template['id']}",
        headers=headers,
        json={"subject": "[ComplyTrack] Action needed: {{ item_name }}"},
    )
    assert updated.status_code == 200
    assert updated.json()["subject"].startswith("[ComplyTrack]")

    assert client.patch(
        "/api/v1/reminders/templates/nope", headers=headers, json={"subject": "x"}
    ).status_code == 404


def test_mail_is_spooled_to_the_configured_outbox_without_any_network_call(
    demo, client: TestClient
) -> None:
    headers = login(client, ADMIN)
    assert not settings.smtp_host, "the suite must run with SMTP unconfigured"

    client.post("/api/v1/reminders/run", headers=headers)

    payload = client.get("/api/v1/reminders/outbox", headers=headers).json()
    assert payload["smtp_configured"] is False
    assert payload["directory"] == str(settings.mail_outbox_dir)
    spooled = list(settings.mail_outbox_dir.glob("*.eml"))
    assert spooled, "reminder e-mails spool to the outbox directory"
    assert payload["count"] == len(spooled)
    spooled_text = spooled[-1].read_text(encoding="utf-8", errors="replace")
    assert "Subject:" in spooled_text
    assert "To:" in spooled_text


def test_only_an_administrator_reads_the_outbox(demo, client: TestClient) -> None:
    assert client.get("/api/v1/reminders/outbox", headers=login(client, COMPLIANCE)).status_code == 403
    assert client.get("/api/v1/reminders/outbox", headers=login(client, ADMIN)).status_code == 200


def test_retrying_failed_reminders_reports_nothing_to_do(demo, client: TestClient) -> None:
    headers = login(client, ADMIN)
    client.post("/api/v1/reminders/run", headers=headers)

    payload = client.post("/api/v1/reminders/retry-failed", headers=headers).json()
    assert payload["sent"] == 0
    assert "re-sent" in payload["detail"]


def test_the_job_history_needs_the_audit_permission(demo, client: TestClient) -> None:
    assert client.get("/api/v1/reminders/jobs", headers=login(client, COMPLIANCE)).status_code == 200
    assert client.get("/api/v1/reminders/jobs", headers=login(client, DEPARTMENT)).status_code == 403
