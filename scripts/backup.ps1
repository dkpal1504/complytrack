<#
.SYNOPSIS
    ComplyTrack backup for Windows.

.DESCRIPTION
    Mirrors scripts/backup.sh: a consistent database snapshot plus a tarball of
    the uploaded documents, written to a timestamped folder under backups\.

    SQLite uses the SQLite backup API - never a plain file copy. Copying a live
    database file can capture a page mid-write and yield a corrupt snapshot; the
    backup API (sqlite3 ".backup", or Python sqlite3.Connection.backup()) takes
    a transactionally consistent copy while the app keeps running.

    PostgreSQL uses pg_dump --format=custom when the client tools are installed.

.PARAMETER Yes
    Required. Confirms the operator intended to run a backup.

.PARAMETER Out
    Base output directory (default: <repo>\backups).

.EXAMPLE
    .\scripts\backup.ps1 -Yes
    .\scripts\backup.ps1 -Yes -Out D:\complytrack-backups
#>
[CmdletBinding()]
param(
    [switch]$Yes,
    [string]$Out
)

$ErrorActionPreference = 'Stop'

if (-not $Yes) {
    Write-Host 'REFUSING TO RUN: backup requires explicit confirmation.' -ForegroundColor Red
    Write-Host 'Re-run as:  .\scripts\backup.ps1 -Yes'
    exit 1
}

$Root = Split-Path -Parent $PSScriptRoot
if (-not $Out) { $Out = Join-Path $Root 'backups' }

# --- resolve configuration -------------------------------------------------- #
$DatabaseUrl = $env:DATABASE_URL
if (-not $DatabaseUrl) {
    $envFile = Join-Path $Root 'backend\.env'
    if (Test-Path $envFile) {
        $line = Get-Content $envFile |
            Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
            Select-Object -Last 1
        if ($line) { $DatabaseUrl = ($line -split '=', 2)[1].Trim().Trim('"') }
    }
}
if (-not $DatabaseUrl) { $DatabaseUrl = "sqlite:///$Root\backend\complytrack.db" }

$StorageDir = $env:STORAGE_DIR
if (-not $StorageDir) { $StorageDir = Join-Path $Root 'backend\storage' }

$Timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$Dest      = Join-Path $Out "complytrack-$Timestamp"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

Write-Host 'ComplyTrack backup'
Write-Host "  Project        : $Root"
Write-Host "  Database       : $DatabaseUrl"
Write-Host "  Storage dir    : $StorageDir"
Write-Host "  Destination    : $Dest"
Write-Host "  Timestamp (UTC): $Timestamp"
Write-Host ''

if ($DatabaseUrl -like 'sqlite*') {
    $raw  = $DatabaseUrl -replace '^sqlite:///', ''
    $dbPath = if ($raw -match '^[A-Za-z]:' -or $raw.StartsWith('/')) { $raw } else { Join-Path $Root "backend\$raw" }

    if (-not (Test-Path $dbPath)) {
        Write-Host "ERROR: SQLite database not found at $dbPath" -ForegroundColor Red
        exit 1
    }

    $dump = Join-Path $Dest 'database.sqlite3'
    $sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
    if ($sqlite) {
        Write-Host '==> Backing up SQLite database via sqlite3 .backup ...'
        & sqlite3 $dbPath ".backup '$dump'"
    } else {
        Write-Host "    sqlite3 CLI not found; using Python's sqlite3 backup API."
        $py = Join-Path $Root 'backend\.venv\Scripts\python.exe'
        if (-not (Test-Path $py)) { $py = 'python' }
        & $py -c "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); d.__enter__(); s.backup(d); d.close(); s.close()" $dbPath $dump
    }
    $dbArtifact = 'database.sqlite3'
} else {
    Write-Host '==> Backing up PostgreSQL (pg_dump, custom format) ...'
    if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
        Write-Host 'ERROR: pg_dump not found. Install the PostgreSQL client tools.' -ForegroundColor Red
        exit 1
    }
    $pgUrl = $DatabaseUrl -replace '^postgresql\+[A-Za-z0-9_]+://', 'postgresql://'
    & pg_dump --format=custom --no-owner --no-acl --file (Join-Path $Dest 'database.dump') $pgUrl
    $dbArtifact = 'database.dump'
}

# --- uploaded documents ----------------------------------------------------- #
if (Test-Path $StorageDir) {
    Write-Host "==> Archiving uploaded documents from $StorageDir ..."
    $tar = Get-Command tar -ErrorAction SilentlyContinue
    $parent = Split-Path -Parent $StorageDir
    $leaf   = Split-Path -Leaf $StorageDir
    if ($tar) {
        & tar -czf (Join-Path $Dest 'storage.tar.gz') -C $parent $leaf
    } else {
        Write-Host '    tar not available; writing a ZIP archive instead.'
        Compress-Archive -Path $StorageDir -DestinationPath (Join-Path $Dest 'storage.zip') -Force
    }
} else {
    Write-Host "==> No storage directory at $StorageDir - nothing uploaded yet."
}

# --- manifest + checksums --------------------------------------------------- #
Write-Host '==> Writing MANIFEST.txt ...'
$manifest = @(
    'ComplyTrack backup',
    "created_utc: $Timestamp",
    "project_root: $Root",
    "database_url: $DatabaseUrl",
    "database_artifact: $dbArtifact",
    "storage_dir: $StorageDir",
    "host: $env:COMPUTERNAME",
    '',
    'SHA-256 checksums:'
)
Get-ChildItem -File $Dest | ForEach-Object {
    if ($_.Name -ne 'MANIFEST.txt') {
        $hash = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower()
        $manifest += "$hash  ./$($_.Name)"
    }
}
$manifest | Set-Content -Encoding utf8 (Join-Path $Dest 'MANIFEST.txt')

Write-Host ''
Write-Host "Backup complete: $Dest" -ForegroundColor Green
Get-ChildItem $Dest | Format-Table Name, Length, LastWriteTime
