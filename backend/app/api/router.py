"""Aggregate every route module under /api/v1."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    audit,
    auth,
    dashboards,
    documents,
    instances,
    items,
    notifications,
    org,
    reminders,
    reports,
    templates,
    users,
)

api_router = APIRouter(prefix="/api/v1")

# Order matters only for documentation grouping; every module owns a distinct
# path prefix so there are no collisions.
api_router.include_router(auth.router)
api_router.include_router(items.router)
api_router.include_router(instances.router)
api_router.include_router(documents.router)
api_router.include_router(templates.router)
api_router.include_router(dashboards.router)
api_router.include_router(reports.router)
api_router.include_router(reminders.router)
api_router.include_router(notifications.router)
api_router.include_router(audit.router)
api_router.include_router(org.router)
api_router.include_router(users.router)

__all__ = ["api_router"]
