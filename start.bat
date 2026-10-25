@echo off
setlocal
chcp 65001 >nul

where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js and npm are required. Install Node.js 20 or newer.
    exit /b 1
)

cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    if errorlevel 1 exit /b 1
)
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 exit /b 1

cd /d "%~dp0frontend"
rem Build tools are required even when NODE_ENV=production.
call npm ci --include=dev --no-audit --no-fund
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1

cd /d "%~dp0backend"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8439
exit /b %errorlevel%
