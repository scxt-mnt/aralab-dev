@echo off
setlocal
cd /d "%~dp0"
title AraLab - TEST MODE (fake data, live database NOT used)
echo.
echo ==============================================================
echo   AraLab TEST MODE
echo   - Already signed in as "Test Student" (no login needed)
echo   - Uses sample data in the browser. Supabase is NOT contacted.
echo   - Your live app and live database are never touched.
echo ==============================================================
echo.

where node >nul 2>nul
if not errorlevel 1 goto nodeok
rem Node may be installed but missing from PATH: look in the usual folders
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LocalAppData%\Programs\nodejs\node.exe" set "PATH=%LocalAppData%\Programs\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto nodeok

echo Node.js was not found on this PC.
echo.
where winget >nul 2>nul
if errorlevel 1 goto manual
choice /c YN /m "Install Node.js LTS now with winget"
if errorlevel 2 goto manual
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
echo Node.js installed. CLOSE this window and double-click START-TEST.bat again.
pause
exit /b 0

:manual
echo Download the LTS version from https://nodejs.org , install it with the default options,
echo then CLOSE this window and double-click START-TEST.bat again.
start "" https://nodejs.org
pause
exit /b 1

:nodeok
for /f "delims=" %%v in ('node -v') do echo Node %%v found.

rem Turn test mode on for this window only (nothing is saved to your PC or to .env)
set "VITE_TEST_MODE=1"
set "VITE_SUPABASE_URL="
set "VITE_SUPABASE_ANON_KEY="

if not exist "node_modules" (
  echo Installing dependencies ^(first time only, needs internet^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto failed
)

echo.
echo Open on this PC:   http://localhost:3000
echo Open on your phone ^(same Wi-Fi^): use the "Network" address shown below.
echo Tip: press F12 then the phone icon to preview a phone screen on this PC.
echo Tip: in the browser console, type  __testNotify("Hello")  to send a test notification.
echo Press Ctrl+C to stop.
echo.
call npm run dev -- --host --open
pause
exit /b 0

:failed
echo.
echo npm install failed. Read the message above.
pause
exit /b 1
