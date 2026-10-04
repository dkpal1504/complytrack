# syntax=docker/dockerfile:1
#
# ComplyTrack backend — FastAPI on Python 3.11 (slim).
#
# Two stages: a builder that compiles/installs the Python dependencies into a
# virtualenv, and a runtime image that copies that virtualenv and runs uvicorn
# as an unprivileged user. Build context is `backend/`:
#
#     docker build -t complytrack-backend ./backend
#
# Run standalone (SQLite + local storage):
#
#     docker run --rm -p 8000:8000 \
#       -v "$PWD/backend/storage:/app/storage" \
#       -v "$PWD/backend/outbox:/app/outbox" \
#       complytrack-backend

# --------------------------------------------------------------------------- #
# Stage 1 — builder
# --------------------------------------------------------------------------- #
FROM python:3.11-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

# Build toolchain + libpq headers. These are only needed to build wheels; the
# runtime image keeps just the small libpq shared library.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# psycopg is the PostgreSQL driver for the production DATABASE_URL; the
# [binary] extra ships a pre-built wheel, so no compiler is needed at runtime.
COPY requirements.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install "psycopg[binary]==3.2.3"

# --------------------------------------------------------------------------- #
# Stage 2 — runtime
# --------------------------------------------------------------------------- #
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    WEB_CONCURRENCY=4

# libpq5 is the runtime half of libpq (psycopg needs it). curl is deliberately
# not installed — the healthcheck uses the interpreter's own urllib instead.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 complytrack \
    && useradd --system --uid 1001 --gid complytrack \
        --home-dir /app --shell /usr/sbin/nologin complytrack

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=complytrack:complytrack . .

# Writable data directories. In Docker Compose these are backed by named
# volumes so uploads and the offline mail spool survive a rebuild.
RUN mkdir -p /app/storage /app/outbox \
    && chown -R complytrack:complytrack /app/storage /app/outbox /app

USER complytrack

EXPOSE 8000

# Liveness probe over the app's own /health endpoint (checks DB + scheduler).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# Multiple uvicorn workers. The daily reminder job is idempotent (RM-11), so
# several workers each holding a scheduler cannot double-send. If you scale the
# backend to several containers, set SCHEDULER_ENABLED=false on all but one and
# trigger the job from a single replica (or a cron sidecar) — see docs/README.md.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-4} --proxy-headers --forwarded-allow-ips='*'"]
