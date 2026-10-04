#!/usr/bin/env bash
# =========================================================================== #
#  ComplyTrack — backup.
#
#  Produces a self-contained, timestamped backup directory:
#
#     backups/complytrack-<UTC timestamp>/
#        database.sqlite3   (or database.dump for PostgreSQL)
#        storage.tar.gz     (uploaded certificates, returns, evidence)
#        MANIFEST.txt       (what/when/how + SHA-256 checksums)
#
#  SQLite uses `sqlite3 .backup`, NOT `cp`: copying the file of a live database
#  can capture a page mid-write and produce a corrupt or torn snapshot. The
#  .backup command takes a consistent snapshot through SQLite's own backup API
#  while the application keeps running. When the sqlite3 CLI is unavailable we
#  fall back to Python's sqlite3 backup() API, which is the same mechanism.
#
#  PostgreSQL uses `pg_dump --format=custom`, which is transactionally
#  consistent against a running server.
#
#  Usage:
#     ./scripts/backup.sh --yes [--out DIR]
#
#  Refuses to run without --yes (it is intended for cron/CI, where the flag is
#  always present, and it stops a human from dumping into the wrong place by
#  accident). See docs/README.md for the recommended cadence.
# =========================================================================== #
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIRMED=0
OUT_BASE="$ROOT/backups"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) CONFIRMED=1; shift ;;
    --out)    OUT_BASE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --yes [--out DIR]"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; echo "Usage: $0 --yes [--out DIR]" >&2; exit 2 ;;
  esac
done

if [[ "$CONFIRMED" -ne 1 ]]; then
  echo "REFUSING TO RUN: backup requires explicit confirmation." >&2
  echo "Re-run as:  $0 --yes" >&2
  exit 1
fi

# --- resolve configuration ------------------------------------------------- #
# Prefer the process environment; fall back to backend/.env if present.
DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" && -f "$ROOT/backend/.env" ]]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$ROOT/backend/.env" | tail -n1 | cut -d= -f2- | tr -d '"' | xargs)"
fi
DATABASE_URL="${DATABASE_URL:-sqlite:///$ROOT/backend/complytrack.db}"

STORAGE_DIR="${STORAGE_DIR:-$ROOT/backend/storage}"
OUTBOX_DIR="${OUTBOX_DIR:-$ROOT/backend/outbox}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$OUT_BASE/complytrack-$TS"
mkdir -p "$DEST"

is_sqlite=0
if [[ "$DATABASE_URL" == sqlite* ]]; then is_sqlite=1; fi

echo "ComplyTrack backup"
echo "  Project        : $ROOT"
echo "  Database       : $DATABASE_URL"
echo "  Storage dir    : $STORAGE_DIR"
echo "  Destination    : $DEST"
echo "  Timestamp (UTC): $TS"
echo

# --- database --------------------------------------------------------------- #
if [[ "$is_sqlite" -eq 1 ]]; then
  RAW="${DATABASE_URL#sqlite:///}"
  RAW="${RAW#sqlite://}"
  if [[ "$RAW" = /* || "$RAW" =~ ^[A-Za-z]: ]]; then
    DB_PATH="$RAW"
  else
    DB_PATH="$ROOT/backend/$RAW"
  fi

  if [[ ! -f "$DB_PATH" ]]; then
    echo "ERROR: SQLite database not found at $DB_PATH" >&2
    echo "       Set DATABASE_URL or run the app once to create it." >&2
    exit 1
  fi

  echo "==> Backing up SQLite database (consistent snapshot via .backup)..."
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '$DEST/database.sqlite3'"
  else
    echo "    sqlite3 CLI not found; using Python's sqlite3 backup API instead."
    python - "$DB_PATH" "$DEST/database.sqlite3" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
with dst:
    src.backup(dst)
dst.close(); src.close()
PY
  fi
  DB_ARTIFACT="database.sqlite3"
else
  echo "==> Backing up PostgreSQL (pg_dump, custom format)..."
  # SQLAlchemy URLs carry a driver suffix (postgresql+psycopg://) that libpq
  # does not understand — strip it for pg_dump.
  PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgresql\+[A-Za-z0-9_]+://#postgresql://#')"
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "ERROR: pg_dump not found. Install the PostgreSQL client tools." >&2
    exit 1
  fi
  pg_dump --format=custom --no-owner --no-acl --file "$DEST/database.dump" "$PG_URL"
  DB_ARTIFACT="database.dump"
fi

# --- uploaded files --------------------------------------------------------- #
if [[ -d "$STORAGE_DIR" ]]; then
  echo "==> Archiving uploaded documents from $STORAGE_DIR ..."
  tar -czf "$DEST/storage.tar.gz" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
else
  echo "==> No storage directory at $STORAGE_DIR — skipping (nothing uploaded yet)."
fi

# The outbox holds spooled .eml files when SMTP is unconfigured; back it up too
# so a demo environment's mail history is preserved.
if [[ -d "$OUTBOX_DIR" && -n "$(ls -A "$OUTBOX_DIR" 2>/dev/null || true)" ]]; then
  echo "==> Archiving mail outbox ..."
  tar -czf "$DEST/outbox.tar.gz" -C "$(dirname "$OUTBOX_DIR")" "$(basename "$OUTBOX_DIR")"
fi

# --- manifest + checksums --------------------------------------------------- #
echo "==> Writing MANIFEST.txt ..."
{
  echo "ComplyTrack backup"
  echo "created_utc: $TS"
  echo "project_root: $ROOT"
  echo "database_url: $DATABASE_URL"
  echo "database_artifact: $DB_ARTIFACT"
  echo "storage_dir: $STORAGE_DIR"
  echo "host: $(hostname 2>/dev/null || echo unknown)"
  echo
  echo "SHA-256 checksums:"
  for artifact in "$DB_ARTIFACT" storage.tar.gz outbox.tar.gz; do
    if [[ -f "$DEST/$artifact" ]]; then
      ( cd "$DEST" && ( sha256sum "./$artifact" 2>/dev/null || shasum -a 256 "./$artifact" ) )
    fi
  done
} > "$DEST/MANIFEST.txt"

echo
echo "Backup complete: $DEST"
ls -lh "$DEST"
echo
echo "Verify a restore with:  ./scripts/restore.sh --yes $DEST"
