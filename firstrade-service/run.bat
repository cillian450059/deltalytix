@echo off
title Firstrade Sync Service
cd /d "%~dp0"
set FIRSTRADE_SERVICE_API_KEY=_fKxrwIjagFaL68-Xb8BXOtsDsoTggk7YlGjrxxG0As
echo ============================================
echo   Firstrade Sync Service - Port 8100
echo ============================================
echo.
python -m uvicorn main:app --host 127.0.0.1 --port 8100
pause
