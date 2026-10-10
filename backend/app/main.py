"""ComplyTrack FastAPI application entrypoint.

Run locally:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from app.api.router import api_router
from app.core.config import settings
from app.db.session import SessionLocal, engine, init_db
from app.db.types import utcnow
from app.domain.workflow import WorkflowError

logger = logging.getLogger("complytrack")

DESCRIPTION = """
**ComplyTrack** — statutory compliance, licence and certificate management for a
shipyard / heavy-engineering establishment.

* Register of statutory obligations with computed expiry, renewal-due and
  internal-target dates.
* Renewal workflow: Pending → Under Process → Submitted → Renewed → Closed,
  with maker-checker verification on Critical obligations.
* Idempotent reminder and escalation engine (re-running a day never double-sends).
* Dashboards, twelve standard reports, an append-only hash-chained audit trail,
  and role- and unit-scoped access control throughout.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create tables, seed reference data, and start the reminder scheduler."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    init_db()
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    settings.mail_outbox_dir.mkdir(parents=True, exist_ok=True)

    if settings.seed_on_startup:
        from app.db.seed import seed_all

        with SessionLocal() as db:
            try:
                summary = seed_all(db, with_demo_data=settings.seed_demo_data)
                logger.info("Seed complete: %s", summary)
            except Exception:  # noqa: BLE001
                db.rollback()
                logger.exception("Seeding failed; continuing with existing data")

    scheduler = None
    if settings.scheduler_enabled:
        from app.scheduler import build_scheduler

        scheduler = build_scheduler()
        scheduler.start()
        logger.info(
            "Reminder scheduler started — daily at %02d:00 IST", settings.scheduler_hour_ist
        )

    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


app = FastAPI(
    title=settings.app_name,
    description=DESCRIPTION,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    contact={"name": "ComplyTrack", "url": "https://example.invalid/complytrack"},
    license_info={"name": "Proprietary"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Document-SHA256"],
)


@app.middleware("http")
async def security_and_timing(request: Request, call_next):
    """Security headers (NFR) plus a server-timing header for the UI."""
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Server-Timing"] = f"app;dur={(time.perf_counter() - started) * 1000:.1f}"
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Flatten Pydantic errors into a message the UI can render field by field."""
    fields = []
    for error in exc.errors():
        location = [str(part) for part in error["loc"] if part not in ("body", "query")]
        fields.append({
            "field": ".".join(location) or "request",
            "message": error["msg"],
            "type": error["type"],
        })
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Some fields need attention.",
            "errors": fields,
        },
    )


@app.exception_handler(WorkflowError)
async def workflow_handler(request: Request, exc: WorkflowError) -> JSONResponse:
    """Last resort for a refused move: the caller's mistake, not a crash.

    Routes that convert this themselves still do; this catches the ones that let
    a bare ``WorkflowError`` escape, which would otherwise surface as a 500 for
    something as ordinary as approving a cycle that has not been submitted.

    It answers exactly as ``instances._workflow_error`` does — 400 when the call
    was incomplete, 409 when the state machine will not allow it — because a
    client cannot be expected to see one status from the route it called and a
    different one from the same condition arriving down this path.
    """
    missing = getattr(exc, "missing", None)
    if missing:
        pretty = ", ".join(str(m).replace("_", " ") for m in missing)
        return JSONResponse(
            status_code=400, content={"detail": f"{exc} Required: {pretty}."}
        )
    return JSONResponse(status_code=409, content={"detail": str(exc)})


app.include_router(api_router)


@app.get("/health", tags=["Operations"], summary="Liveness and readiness probe")
def health() -> dict:
    database = "ok"
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        database = f"error: {exc}"

    scheduler_running = False
    try:
        from app.scheduler import get_scheduler

        scheduler = get_scheduler()
        scheduler_running = bool(scheduler and scheduler.running)
    except Exception:  # noqa: BLE001
        pass

    return {
        "status": "ok" if database == "ok" else "degraded",
        "app": settings.app_name,
        "version": app.version,
        "time_utc": utcnow(),
        "database": database,
        "scheduler": "running" if scheduler_running else "stopped",
        "smtp_configured": bool(settings.smtp_host),
    }


@app.get("/api/v1/meta", tags=["Operations"], summary="Enumerations and configuration for the UI")
def meta() -> dict:
    from app.domain import enums

    def values(enum_cls) -> list[str]:
        return [member.value for member in enum_cls]

    return {
        "app_name": settings.app_name,
        "default_reminder_offsets": settings.default_reminder_offsets,
        "criticality": values(enums.Criticality),
        "criticality_weight": {
            k.value: v for k, v in enums.CRITICALITY_WEIGHT.items()
        },
        "item_type": values(enums.ItemType),
        "item_status": values(enums.ItemStatus),
        "derived_status": values(enums.DerivedStatus),
        "compliance_bucket": values(enums.ComplianceBucket),
        "rag": values(enums.RagColour),
        "validity_unit": values(enums.ValidityUnit),
        "recurrence": values(enums.RecurrenceKind),
        "applicability": values(enums.Applicability),
        "checklist_status": values(enums.ChecklistStatus),
        "document_type": values(enums.DocumentType),
        "roles": values(enums.Role),
        "reminder_channel": values(enums.ReminderChannel),
        "quiet_hours": [settings.quiet_hours_start, settings.quiet_hours_end],
        "max_upload_mb": settings.max_upload_bytes // (1024 * 1024),
        "allowed_upload_extensions": settings.allowed_upload_extensions,
        "upload_url": "/api/v1/documents",
        "support_email": settings.support_email,
    }


# The built single-page app is served from here in a packaged deployment, so the
# API and the UI share one origin (and one TLS certificate).
class _SpaStaticFiles(StaticFiles):
    """Static files that fall back to index.html so client-side routes deep-link.

    The UI routes with the History API, so a deep link such as /items — or a
    refresh on it — is a genuine request for a path with no file behind it. Only
    unmatched paths reach this mount, because every API route is registered ahead
    of it. Paths under /api/ are deliberately left as 404s: answering a missing
    endpoint with the HTML shell would turn a real error into a 200.
    """

    async def get_response(self, path: str, scope: Scope) -> Response:
        # Starlette raises for a miss instead of returning a 404 response, so
        # both shapes are handled to keep this correct across versions.
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or scope["path"].startswith("/api/"):
                raise
            return await self._index(scope)
        if response.status_code == 404 and not scope["path"].startswith("/api/"):
            return await self._index(scope)
        return response

    async def _index(self, scope: Scope) -> Response:
        return await super().get_response("index.html", scope)


_frontend_dist = settings.frontend_dist_dir
if _frontend_dist and _frontend_dist.exists():
    app.mount("/", _SpaStaticFiles(directory=_frontend_dist, html=True), name="ui")
