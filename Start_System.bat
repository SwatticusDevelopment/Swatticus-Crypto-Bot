@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Swatticus Slippage System

rem === cd to this script's directory ===
cd /d "%~dp0"

rem === ensure logs directory ===
if not exist "logs" mkdir "logs"

rem === timestamp for log filenames (yyyy-MM-dd_HH-mm-ss) ===
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set TS=%%i

set "PAIR_LOG=logs\pairs-%TS%.log"
set "RUN_LOG=logs\run-%TS%.log"

rem === optional: install deps if missing ===
if not exist "node_modules" (
  echo [setup] Installing dependencies... (logging to %PAIR_LOG%)
  call npm ci >> "%PAIR_LOG%" 2>&1 || goto :fail
)

rem === 1) generate pairs ===
echo [run] Generating pairs... (logging to %PAIR_LOG%)
call npm run pairs >> "%PAIR_LOG%" 2>&1 || goto :fail
echo [ok] Pairs generated. Log: %PAIR_LOG%

rem === 2) start the scanner ===
echo [run] Starting scanner... (logging to %RUN_LOG%)
echo [info] To watch logs: notepad "%RUN_LOG%"
call npm start >> "%RUN_LOG%" 2>&1
goto :eof

:fail
echo [error] Command failed (exit %ERRORLEVEL%). Check logs:
echo   - %PAIR_LOG%
echo   - %RUN_LOG%
pause
exit /b %ERRORLEVEL%
