# =========================================================================== #
#  ComplyTrack — developer convenience targets.
#
#  `make` is available on Linux/macOS/Git-Bash-with-make. On Windows use the
#  PowerShell equivalents in scripts/dev.ps1, or run the same commands by hand
#  (see docs/README.md). Every target here is a single command.
#
#  Python virtualenv: backend/.venv (POSIX path). On Windows the interpreter is
#  backend/.venv/Scripts/python.exe — use scripts/dev.ps1 there.
# =========================================================================== #

PY      := backend/.venv/bin/python
PIP     := backend/.venv/bin/pip
COMPOSE := docker compose
BACKUP  ?= latest

.PHONY: help install dev-backend dev-frontend test test-backend test-e2e lint seed \
        docker-up docker-down backup restore

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

install: ## Create backend/.venv, install Python deps, then install frontend deps
	cd backend && python -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -r requirements.txt && cd ../frontend && npm ci

dev-backend: ## Run the FastAPI dev server with auto-reload on http://localhost:8000
	cd backend && .venv/bin/python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

dev-frontend: ## Run the Vite dev server on http://localhost:5173
	cd frontend && npm run dev

test: test-backend ## Run all tests (backend unit/API suite; e2e needs `make test-e2e`)
	@echo "Backend tests done. Run 'make test-e2e' for the browser suite."

test-backend: ## Run the pytest suite
	cd backend && .venv/bin/python -m pytest -q

test-e2e: ## Run the Playwright end-to-end suite (requires `cd frontend && npx playwright install`)
	cd frontend && npm run e2e

lint: ## Byte-compile the backend and run the frontend linter
	cd backend && .venv/bin/python -m compileall -q app
	cd frontend && npm run lint

seed: ## Load master data + demo register (idempotent)
	cd backend && .venv/bin/python -c "from app.db.session import init_db, SessionLocal; from app.db.seed import seed_all; init_db(); s = SessionLocal(); print('seed:', seed_all(s)); s.close()"

docker-up: ## Build and start the full Compose stack (db + backend + frontend)
	$(COMPOSE) up -d --build

docker-down: ## Stop the Compose stack (volumes are kept)
	$(COMPOSE) down

backup: ## Back up the database and storage/ into backups/ (SQLite or PostgreSQL)
	./scripts/backup.sh --yes

restore: ## Restore from a backup: make restore BACKUP=backups/complytrack-YYYYmmddTHHMMSSZ
	./scripts/restore.sh --yes $(BACKUP)
