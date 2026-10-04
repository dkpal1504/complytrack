"""Notification centre: in-app feed and web-push device registration."""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.common import CurrentUser, DbSession, not_found
from app.core.deps import Context
from app.models.reminders import Notification
from app.schemas.reminders import NotificationOut, PushSubscribe
from app.services import audit
from app.services import notifications as notification_service

router = APIRouter(prefix="/notifications", tags=["Notifications"])

_ACTOR_KEYS = ("user_id", "user_email", "ip", "user_agent")


class PushUnsubscribe(BaseModel):
    endpoint: str


def _write_audit(
    db: Session,
    ctx: dict,
    *,
    entity_id: str | None,
    action: str,
    reason: str,
) -> None:
    """Append a device-registry audit entry and commit."""
    audit.write_audit(
        db,
        entity_type="user",
        entity_id=entity_id,
        action=action,
        reason=reason,
        **{k: (ctx or {}).get(k) for k in _ACTOR_KEYS},
    )
    db.commit()


@router.get("", summary="Your notifications, newest first")
def list_notifications(
    db: DbSession,
    user: CurrentUser,
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    page: int = Query(1, ge=1),
) -> dict:
    filters = [Notification.user_id == user.id, Notification.is_deleted.is_(False)]
    if unread_only:
        filters.append(Notification.read_at.is_(None))

    total = db.execute(
        select(func.count()).select_from(select(Notification).where(*filters).subquery())
    ).scalar_one()
    rows = db.execute(
        select(Notification)
        .where(*filters)
        .order_by(Notification.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).scalars().all()

    return {
        "items": [NotificationOut.model_validate(row).model_dump() for row in rows],
        "unread": notification_service.unread_count(db, user.id),
        "total": total,
    }


@router.post("/read-all", summary="Mark every notification as read")
def read_all(db: DbSession, user: CurrentUser) -> dict:
    return {"marked": notification_service.mark_all_read(db, user.id)}


@router.post("/{notification_id}/read", summary="Mark one notification as read")
def read_notification(notification_id: str, db: DbSession, user: CurrentUser) -> dict:
    if not notification_service.mark_read(db, notification_id, user.id):
        raise not_found("Notification")
    return {"detail": "Marked as read."}


@router.post("/push/subscribe", summary="Register a web-push subscription")
def push_subscribe(
    payload: PushSubscribe,
    db: DbSession,
    user: CurrentUser,
    ctx: Context = None,
) -> dict:
    """Store the browser subscription, replacing any prior one for the endpoint."""
    devices = [
        token for token in (user.device_tokens or [])
        if token.get("endpoint") != payload.endpoint
    ]
    devices.append(payload.model_dump())
    user.device_tokens = devices
    db.add(user)
    db.flush()
    _write_audit(
        db, ctx, entity_id=user.id, action="push_subscribe",
        reason="Registered a push notification device.",
    )
    return {"detail": "Subscribed.", "devices": len(devices)}


@router.post("/push/unsubscribe", summary="Remove a web-push subscription")
def push_unsubscribe(
    payload: PushUnsubscribe,
    db: DbSession,
    user: CurrentUser,
    ctx: Context = None,
) -> dict:
    devices = [
        token for token in (user.device_tokens or [])
        if token.get("endpoint") != payload.endpoint
    ]
    user.device_tokens = devices
    db.add(user)
    db.flush()
    _write_audit(
        db, ctx, entity_id=user.id, action="push_unsubscribe",
        reason="Removed a push notification device.",
    )
    return {"detail": "Unsubscribed.", "devices": len(devices)}
