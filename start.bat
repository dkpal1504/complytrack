@echo off
rem ===========================================================================
rem  ComplyTrack - launch the backend and the frontend.
rem
rem  Put this file in the project root (next to backend\ and frontend\). All
rem  paths are derived from the file's own location, so it works on any machine
rem  and from any current directory.
rem
rem  Hardened over the original launcher:
rem    * Frees ports 5173 and 8000 first. Windows lets an old dev server keep
rem      listening on [::1]:5173 while a new one binds 0.0.0.0:5173 - both
rem      "port 5173" - and the browser's "localhost" then resolves to IPv6 and
rem      reaches the STALE server, which 404s every /api/ request. Only stale
rem      node/python dev servers are killed; anything else is reported and left
rem      running so we never take down an unrelated service.
rem    * --strictPort makes Vite fail loudly instead of silently moving to 5174,
rem      so a port clash can never be invisible again.
rem    * Waits for the API's /health before opening the UI, so the first login
rem      cannot race the backend's startup.
rem ===========================================================================
setlocal EnableExtensions
title ComplyTrack - launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "BACKEND_PORT=8000"
set "FRONTEND_PORT=5173"

echo ============================================================
echo   ComplyTrack
echo   Project folder : %ROOT%
echo   API            : http://127.0.0.1:%BACKEND_PORT%
echo   UI             : http://127.0.0.1:%FRONTEND_PORT%
echo ============================================================
echo.

echo [1/4] Freeing the dev ports...
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($port in @(%FRONTEND_PORT%,%BACKEND_PORT%)) { $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if (-not $conns) { Write-Host ('      port ' + $port + ': free'); continue }; foreach ($c in $conns) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if (-not $p) { continue }; if ($p.ProcessName -in @('node','python')) { Write-Host ('      port ' + $port + ': killing stale ' + $p.ProcessName + ' PID ' + $p.Id); Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } else { Write-Host ('      port ' + $port + ': held by ' + $p.ProcessName + ' PID ' + $p.Id + ' - leaving it alone') } } }"
echo.

echo [2/4] Starting the API in its own window...
start "ComplyTrack Backend - Port %BACKEND_PORT%" powershell -NoExit -Command "Set-Location '%ROOT%\backend'; $py = '.\.venv\Scripts\python.exe'; if (-not (Test-Path $py)) { $py = 'python' }; & $py -m uvicorn app.main:app --reload --host 0.0.0.0 --port %BACKEND_PORT%"
echo.

echo [3/4] Waiting for the API to answer /health...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = $false; for ($i = 0; $i -lt 25; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:%BACKEND_PORT%/health') -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}; Start-Sleep -Milliseconds 800 }; if ($ok) { Write-Host '      API is up and answering.' } else { Write-Host '      API has not answered /health yet - check the Backend window.' }"
echo.

echo [4/4] Starting the UI in its own window...
start "ComplyTrack Frontend - Port %FRONTEND_PORT%" powershell -NoExit -Command "Set-Location '%ROOT%\frontend'; npm run dev -- --port %FRONTEND_PORT% --strictPort --host 0.0.0.0"
echo.

echo Done. Open the UI at:  http://127.0.0.1:%FRONTEND_PORT%/
echo.
echo   Use 127.0.0.1, not localhost. "localhost" can resolve to IPv6 and reach
echo   a different server than the one just started.
echo.
echo Close the two server windows to stop the servers.
timeout /t 10 /nobreak >nul
exit /b 0
