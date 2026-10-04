#!/usr/bin/env bash
# =========================================================================== #
#  ComplyTrack — local development launcher (Linux / macOS / Git Bash).
#
#  Usage:
#     ./scripts/dev.sh install     # create backend/.venv, install deps
#     ./scripts/dev.sh backend     # FastAPI with reload on :8000
#     ./scripts/dev.sh frontend    # Vite dev server on :5173
#     ./scripts/dev.sh both        # both, Ctrl-C stops both
#     ./scripts/dev.sh seed        # load master data + demo register
#
#  Windows PowerShell users: use scripts/dev.ps1 instead.
# =========================================================================== #
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_PY="$ROOT/backend/.venv/bin/python"
VENV_PIP="$ROOT/backend/.venv/bin/pip"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; GREEN=''; YELLOW=''; RESET=''
fi

info()  { printf '%s%s%s\n' "$GREEN" "$*" "$RESET"; }
warn()  { printf '%s%s%s\n' "$YELLOW" "$*" "$RESET"; }

ensure_venv() {
  if [[ ! -x "$VENV_PY" ]]; then
    warn "No virtualenv at backend/.venv — creating it now."
    ( cd "$ROOT/backend" && python -m venv .venv )
  fi
}

do_install() {
  ensure_venv
  info "Installing Python dependencies..."
  "$VENV_PIP" install --upgrade pip
  "$VENV_PIP" install -r "$ROOT/backend/requirements.txt"
  if [[ -f "$ROOT/frontend/package.json" ]]; then
    info "Installing frontend dependencies..."
    ( cd "$ROOT/frontend" && npm ci )
  else
    warn "frontend/package.json not found yet — skipping npm install."
  fi
  if [[ ! -f "$ROOT/backend/.env" ]]; then
    warn "No backend/.env — copy .env.example:  cp .env.example backend/.env"
  fi
  info "Install complete."
}

do_backend() {
  ensure_venv
  info "API docs: http://127.0.0.1:8000/api/docs   Health: http://127.0.0.1:8000/health"
  ( cd "$ROOT/backend" && exec "$VENV_PY" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 )
}

do_frontend() {
  if [[ ! -f "$ROOT/frontend/package.json" ]]; then
    warn "frontend/package.json not found — the frontend is not built yet."
    exit 1
  fi
  info "Frontend: http://localhost:5173"
  ( cd "$ROOT/frontend" && exec npm run dev )
}

do_both() {
  ensure_venv
  trap 'kill 0' EXIT INT TERM
  ( cd "$ROOT/backend" && "$VENV_PY" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 ) &
  do_frontend &
  wait
}

do_seed() {
  ensure_venv
  ( cd "$ROOT/backend" && "$VENV_PY" -c "from app.db.session import init_db, SessionLocal; from app.db.seed import seed_all; init_db(); s = SessionLocal(); print('seed:', seed_all(s)); s.close()" )
}

case "${1:-both}" in
  install)  do_install ;;
  backend)  do_backend ;;
  frontend) do_frontend ;;
  both)     do_both ;;
  seed)     do_seed ;;
  *) echo "Usage: $0 [install|backend|frontend|both|seed]"; exit 2 ;;
esac
