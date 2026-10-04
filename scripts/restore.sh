#!/usr/bin/env bash
# =========================================================================== #
#  ComplyTrack — restore.
#
#  Reverses scripts/backup.sh:
#     SQLite      : restores database.sqlite3 over the live database file
#     PostgreSQL  : pg_restore --clean --if-exists into the target database
#     storage/    : extracts storage.tar.gz back into the storage directory
#
#  THIS OVERWRITES CURRENT DATA. Stop the application before restoring, and
#  take a fresh backup first if the current data might still be wanted.
#
#  Usage:
#     ./scripts/restore.sh --yes backups/complytrack-20260101T070000Z
#     ./scripts/restore.sh --yes latest        # most recent directory
#
#  Refuses to run without --yes and prints exactly what it will overwrite.
# =========================================================================== #
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIRMED=0
SOURCE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) CONFIRMED=1; shift ;;
    -h|--help)
      echo "Usage: $0 --yes <backup-directory|latest>"
      exit 0 ;;
    *)
      if [[ -n "$SOURCE" ]]; then
        echo "Unexpected extra argument: $1" >&2; exit 2
      fi
      SOURCE="$1"; shift ;;
  esac
done

if [[ "$CONFIRMED" -ne 1 ]]; then
  echo "REFUSING TO RUN: restore overwrites live data and requires --yes." >&2
  echo "Re-run as:  $0 --yes <backup-directory|latest>" >&2
  exit 1
fi

if [[ -z "$SOURCE" ]]; then
  echo "ERROR: no backup directory given." >&2
  echo "Usage: $0 --yes <backup-directory|latest>" >&2
  exit 1
fi

if [[ "$SOURCE" == "latest" ]]; then
  SOURCE="$(find "$ROOT/backups" -maxdepth 1 -type d -name 'complytrack-*' | sort | tail -n1)"
  if [[ -z "$SOURCE" ]]; then
    echo "ERROR: no backups found under $ROOT/backups" >&2
    exit 1
  fi
fi

if [[ ! -d "$SOURCE" ]]; then
  # Allow a path relative to the project root as well as to the CWD.
  if [[ -d "$ROOT/$SOURCE" ]]; then
    SOURCE="$ROOT/$SOURCE"
  else
    echo "ERROR: backup directory not found: $SOURCE" >&2
    exit 1
  fi
fi

# --- resolve configuration ------------------------------------------------- #
DATABASE_URL="${DATABASE_URL:-}"
if [[ -z "$DATABASE_URL" && -f "$ROOT/backend/.env" ]]; then
  DATABASE_URL="$(grep -E '^[[:space:]]*DATABASE_URL[[:space:]]*=' "$ROOT/backend/.env" | tail -n1 | cut -d= -f2- | tr -d '"' | xargs)"
fi
DATABASE_URL="${DATABASE_URL:-sqlite:///$ROOT/backend/complytrack.db}"
STORAGE_DIR="${STORAGE_DIR:-$ROOT/backend/storage}"

is_sqlite=0
if [[ "$DATABASE_URL" == sqlite* ]]; then is_sqlite=1; fi

echo "ComplyTrack restore — THIS OVERWRITES DATA"
echo "  Source backup : $SOURCE"
echo "  Database      : $DATABASE_URL"
echo "  Storage dir   : $STORAGE_DIR"
echo

if [[ "$is_sqlite" -eq 1 ]]; then
  RAW="${DATABASE_URL#sqlite:///}"
  RAW="${RAW#sqlite://}"
  if [[ "$RAW" = /* || "$RAW" =~ ^[A-Za-z]: ]]; then
    DB_PATH="$RAW"
  else
    DB_PATH="$ROOT/backend/$RAW"
  fi
  DUMP="$SOURCE/database.sqlite3"
  if [[ ! -f "$DUMP" ]]; then
    echo "ERROR: $DUMP not found in the backup." >&2
    exit 1
  fi
  echo "About to overwrite SQLite database: $DB_PATH"
  echo "  with: $DUMP"
  command -v sqlite3 >/dev/null 2>&1 || echo "  (sqlite3 CLI absent — Python sqlite3 will be used)"
  mkdir -p "$(dirname "$DB_PATH")"
  if command -v sqlite3 >/dev/null 2>&1; then
    # Safety copy of the current file, then restore through SQLite itself.
    [[ -f "$DB_PATH" ]] && cp -p "$DB_PATH" "$DB_PATH.pre-restore"
    sqlite3 "$DB_PATH" ".restore '$DUMP'"
  else
    python - "$DUMP" "$DB_PATH" <<'PY'
import shutil, sqlite3, sys, os
dump, target = sys.argv[1], sys.argv[2]
if os.path.exists(target):
    shutil.copy2(target, target + ".pre-restore")
src = sqlite3.connect(dump)
dst = sqlite3.connect(target)
with dst:
    src.backup(dst)
dst.close(); src.close()
PY
  fi
  echo "Database restored. Previous file kept as ${DB_PATH}.pre-restore (if it existed)."
else
  DUMP="$SOURCE/database.dump"
  if [[ ! -f "$DUMP" ]]; then
    echo "ERROR: $DUMP not found in the backup." >&2
    exit 1
  fi
  PG_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's#^postgresql\+[A-Za-z0-9_]+://#postgresql://#')"
  if ! command -v pg_restore >/dev/null 2>&1; then
    echo "ERROR: pg_restore not found. Install the PostgreSQL client tools." >&2
    exit 1
  fi
  echo "About to DROP and recreate schema objects in: $PG_URL"
  pg_restore --clean --if-exists --no-owner --no-acl --dbname "$PG_URL" "$DUMP"
  echo "PostgreSQL restored."
fi

# --- uploaded files --------------------------------------------------------- #
if [[ -f "$SOURCE/storage.tar.gz" ]]; then
  echo "About to extract storage.tar.gz into $(dirname "$STORAGE_DIR")/"
  mkdir -p "$(dirname "$STORAGE_DIR")"
  tar -xzf "$SOURCE/storage.tar.gz" -C "$(dirname "$STORAGE_DIR")"
  echo "Uploaded documents restored to $STORAGE_DIR"
else
  echo "No storage.tar.gz in this backup — uploaded documents left untouched."
fi

if [[ -f "$SOURCE/outbox.tar.gz" ]]; then
  echo "Extracting mail outbox ..."
  tar -xzf "$SOURCE/outbox.tar.gz" -C "$ROOT/backend"
fi

echo
echo "Restore complete. Start the application and verify with:"
echo "  curl http://127.0.0.1:8000/health"
