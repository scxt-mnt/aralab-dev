@echo off
cd /d "%~dp0"
title AraLab - local test
echo.
echo ===== AraLab: install + run locally =====
echo.

if not exist ".env" copy /y ".env.example" ".env" >nul

if exist ".env.local" goto install
echo AI generation needs 2 secret keys. Press Enter to skip either one.
echo (The feed, profiles and library work without them.)
echo.
set "GKEY="
set "SKEY="
set /p GKEY=GEMINI_API_KEY: 
set /p SKEY=SUPABASE_SERVICE_ROLE_KEY: 
> ".env.local" echo # Secrets for local testing. Never share this file.
if not "%GKEY%"=="" >> ".env.local" echo GEMINI_API_KEY=%GKEY%
if not "%SKEY%"=="" >> ".env.local" echo SUPABASE_SERVICE_ROLE_KEY=%SKEY%

:install
echo.
echo Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo.
echo Reminder: run supabase-setup.sql once in Supabase (SQL Editor).
echo Starting on http://localhost:3000   (Ctrl+C to stop)
echo.
call npm run dev -- --open
pause
exit /b 0

:failed
echo.
echo npm install failed. Read the message above.
pause
exit /b 1
