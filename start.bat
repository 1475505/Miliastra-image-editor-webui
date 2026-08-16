@echo off
chcp 65001 >nul

rem 构建前端（输出到 backend/app/static）
where npm >nul 2>nul
if %errorlevel%==0 (
    cd /d "%~dp0frontend"
    call npm install --no-audit --no-fund
    call npm run build
)

cd /d "%~dp0backend"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8439
