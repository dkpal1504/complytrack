#!/usr/bin/env bash
#
# Run the ComplyTrack backend test suite.
#
#   ./scripts/test.sh                     # everything, with coverage over app/
#   ./scripts/test.sh tests/api/test_items.py -k search
#
# Coverage options live in backend/pytest.ini, so plain `pytest` gets them too.
# The suite never talks to the network: mail spools to a temporary outbox and
# every test gets its own SQLite file under pytest's tmp_path.
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-.venv/Scripts/python.exe}"
if [ ! -x "$PYTHON" ]; then
  PYTHON=".venv/bin/python"
fi
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

export PYTHONIOENCODING=utf-8
exec "$PYTHON" -m pytest "$@"
