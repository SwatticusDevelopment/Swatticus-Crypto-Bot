@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set TS=%%i
set "RUN_LOG=logs\run-%TS%.log"

echo [run] Starting SlippageScanner.exe (logging to %RUN_LOG%)
start "" cmd /c ".\SlippageScanner.exe >> "%RUN_LOG%" 2>&1"
