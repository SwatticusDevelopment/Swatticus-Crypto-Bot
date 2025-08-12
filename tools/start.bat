@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Swatticus Slippage System

cd /d "%~dp0"
if not exist "logs" mkdir "logs"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set TS=%%i

set "PAIR_LOG=logs\pairs-%TS%.log"
set "RUN_LOG=logs\run-%TS%.log"

if not exist "node_modules" (
  echo [setup] Installing dependencies... (logging to %PAIR_LOG%)
  call npm ci >> "%PAIR_LOG%" 2>&1 || goto :fail
)

echo [run] Generating pairs... (logging to %PAIR_LOG%)
call npm run pairs >> "%PAIR_LOG%" 2>&1 || goto :fail
echo [ok] Pairs generated. Log: %PAIR_LOG%

echo [run] Starting scanner... (logging to %RUN_LOG%)
start "Scanner" cmd /c "npm start >> "%RUN_LOG%" 2>&1"
echo [info] To watch logs: notepad "%RUN_LOG%"
goto :eof

:fail
echo [error] Command failed (exit %ERRORLEVEL%). Check logs:
echo   - %PAIR_LOG%
echo   - %RUN_LOG%
pause
exit /b %ERRORLEVEL%
