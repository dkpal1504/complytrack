@echo off
rem ===========================================================================
rem  ComplyTrack - build the UI, then serve UI + API from one port (no Vite).
rem
rem  Put this file in the project root (next to backend\ and frontend\).
rem
rem  Use this for a shared or remote machine: it builds frontend\dist once and
rem  lets the FastAPI app serve it, so everything answers on a single port with
rem  one origin - no dev server, no proxy, no CORS, one firewall rule.
rem
rem  The UI is a static build, so re-run this whenever the frontend changes.
rem ===========================================================================
setlocal EnableExtensions
title ComplyTrack - production launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

set "PORT=8000"

echo ============================================================
echo   ComplyTrack - built UI + API on one port
echo   Project folder : %ROOT%
echo   URL            : http://127.0.0.1:%PORT%/
echo ============================================================
echo.

echo [1/4] Freeing port %PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($port in @(%PORT%)) { $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if (-not $conns) { Write-Host ('      port ' + $port + ': free'); continue }; foreach ($c in $conns) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; if (-not $p) { continue }; if ($p.ProcessName -in @('node','python')) { Write-Host ('      port ' + $port + ': killing stale ' + $p.ProcessName + ' PID ' + $p.Id); Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } else { Write-Host ('      port ' + $port + ': held by ' + $p.ProcessName + ' PID ' + $p.Id + ' - leaving it alone') } } }"
echo.

echo [2/4] Building the UI into frontend\dist ...
pushd "%ROOT%\frontend"
if not exist "node_modules" (
    echo       node_modules missing - installing packages first ...
    call npm ci
    if errorlevel 1 (
        echo       npm ci failed - cannot build the UI.
        popd
        pause
        exit /b 1
    )
)
call npm run build
if errorlevel 1 (
    echo.
    echo       BUILD FAILED - fix the errors above, then run this again.
    popd
    pause
    exit /b 1
)
popd
echo       UI built.
echo.

echo [3/4] Starting the API on port %PORT% ...
start "ComplyTrack - Port %PORT%" powershell -NoExit -Command "Set-Location '%ROOT%\backend'; $py = '.\.venv\Scripts\python.exe'; if (-not (Test-Path $py)) { $py = 'python' }; & $py -m uvicorn app.main:app --host 0.0.0.0 --port %PORT%"
echo.

echo [4/4] Waiting for the API to answer /health ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = $false; for ($i = 0; $i -lt 25; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:%PORT%/health') -TimeoutSec 2; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch {}; Start-Sleep -Milliseconds 800 }; if ($ok) { Write-Host '      API is up.' } else { Write-Host '      API has not answered /health - check the server window.' }"
echo.

echo Open the app at:  http://127.0.0.1:%PORT%/
echo   From another machine use  http://^<this-machine-ip^>:%PORT%/
echo   Allow inbound port %PORT% through Windows Firewall on Private networks.
echo.
echo Only port %PORT% is needed - no Vite, no proxy. Close the server window to stop.
timeout /t 10 /nobreak >nul
exit /b 0
