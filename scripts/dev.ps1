<#
.SYNOPSIS
    ComplyTrack local development launcher for Windows.

.DESCRIPTION
    The Makefile in this repository is a POSIX convenience; on Windows use this
    script (or run the same commands by hand). It manages the backend virtualenv
    at backend\.venv and can start the API, the Vite dev server, or both.

.EXAMPLE
    .\scripts\dev.ps1 install     # create backend\.venv and install dependencies
    .\scripts\dev.ps1 backend     # FastAPI with reload on http://127.0.0.1:8000
    .\scripts\dev.ps1 frontend    # Vite dev server on http://localhost:5173
    .\scripts\dev.ps1 both        # both; Ctrl-C stops both
    .\scripts\dev.ps1 seed        # load master data + demo register
    .\scripts\dev.ps1 test        # run the backend pytest suite
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('install', 'backend', 'frontend', 'both', 'seed', 'test')]
    [string]$Command = 'both'
)

$ErrorActionPreference = 'Stop'

$Root    = Split-Path -Parent $PSScriptRoot
$VenvPy  = Join-Path $Root 'backend\.venv\Scripts\python.exe'
$VenvPip = Join-Path $Root 'backend\.venv\Scripts\pip.exe'

function Write-Info { param([string]$Message) Write-Host $Message -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host $Message -ForegroundColor Yellow }

function Ensure-Venv {
    if (-not (Test-Path $VenvPy)) {
        Write-Warn "No virtualenv at backend\.venv -- creating it now."
        Push-Location (Join-Path $Root 'backend')
        try { python -m venv .venv } finally { Pop-Location }
    }
}

function Invoke-Install {
    Ensure-Venv
    Write-Info 'Installing Python dependencies...'
    & $VenvPip install --upgrade pip
    & $VenvPip install -r (Join-Path $Root 'backend\requirements.txt')
    $frontend = Join-Path $Root 'frontend\package.json'
    if (Test-Path $frontend) {
        Write-Info 'Installing frontend dependencies...'
        Push-Location (Join-Path $Root 'frontend')
        try { npm ci } finally { Pop-Location }
    } else {
        Write-Warn 'frontend\package.json not found yet -- skipping npm install.'
    }
    if (-not (Test-Path (Join-Path $Root 'backend\.env'))) {
        Write-Warn 'No backend\.env -- copy .env.example:  Copy-Item .env.example backend\.env'
    }
    Write-Info 'Install complete.'
}

function Start-Backend {
    Ensure-Venv
    Write-Info 'API docs: http://127.0.0.1:8000/api/docs   Health: http://127.0.0.1:8000/health'
    Push-Location (Join-Path $Root 'backend')
    try {
        & $VenvPy -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
    } finally { Pop-Location }
}

function Start-Frontend {
    if (-not (Test-Path (Join-Path $Root 'frontend\package.json'))) {
        Write-Warn 'frontend\package.json not found -- the frontend is not built yet.'
        exit 1
    }
    Write-Info 'Frontend: http://localhost:5173'
    Push-Location (Join-Path $Root 'frontend')
    try { npm run dev } finally { Pop-Location }
}

function Start-Both {
    Ensure-Venv
    $backendDir = Join-Path $Root 'backend'
    $frontendDir = Join-Path $Root 'frontend'
    $proc = Start-Process -FilePath $VenvPy `
        -ArgumentList '-m', 'uvicorn', 'app.main:app', '--reload', '--host', '127.0.0.1', '--port', '8000' `
        -WorkingDirectory $backendDir -PassThru
    Write-Info 'Backend started (Ctrl-C here does not stop it; use Get-Process | Stop-Process).'
    try { Start-Frontend } finally { Stop-Process -Id $proc.Id -ErrorAction SilentlyContinue }
}

function Invoke-Seed {
    Ensure-Venv
    Push-Location (Join-Path $Root 'backend')
    try {
        & $VenvPy -c "from app.db.session import init_db, SessionLocal; from app.db.seed import seed_all; init_db(); s = SessionLocal(); print('seed:', seed_all(s)); s.close()"
    } finally { Pop-Location }
}

function Invoke-Test {
    Ensure-Venv
    Push-Location (Join-Path $Root 'backend')
    try { & $VenvPy -m pytest -q } finally { Pop-Location }
}

switch ($Command) {
    'install'  { Invoke-Install }
    'backend'  { Start-Backend }
    'frontend' { Start-Frontend }
    'both'     { Start-Both }
    'seed'     { Invoke-Seed }
    'test'     { Invoke-Test }
}
