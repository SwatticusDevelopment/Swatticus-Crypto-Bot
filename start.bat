@echo off
echo ===============================
echo Swatticus Development Bot
echo ===============================
echo.
echo Starting Swatticus Development Solana Trading Bot...
echo.
echo Press Ctrl+C to stop the bot
echo.

:: Set Node options to disable warnings
set NODE_OPTIONS=--no-deprecation

:: Check node installation
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  echo ERROR: Node.js is not installed or not in PATH
  echo Please install Node.js from https://nodejs.org/
  pause
  exit /b 1
)

:: Optional: Create logs directory if it doesn't exist
if not exist ".\logs" mkdir ".\logs"

:: Start the bot with logging
echo [%date% %time%] Bot starting > .\logs\startup.log
node src/server.js

:: If the bot crashes, give time to read error message
if %ERRORLEVEL% neq 0 (
  echo.
  echo Bot crashed or stopped with error code %ERRORLEVEL%
  echo Check logs for details
  timeout /t 10
)