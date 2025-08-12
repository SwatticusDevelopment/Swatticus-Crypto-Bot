@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Swatticus Emergency Startup

cd /d "%~dp0"

echo ========================================
echo  EMERGENCY STARTUP - BYPASS PAIR GEN
echo ========================================
echo.

rem === Create logs directory ===
if not exist "logs" mkdir "logs"

rem === Check critical files ===
if not exist ".env" (
  echo [ERROR] .env file missing!
  echo Copy .env.example to .env and configure it first.
  pause
  exit /b 1
)

rem === Create minimal pairs file directly ===
echo [emergency] Creating minimal pairs file...

echo [> pairs.base.json
echo   "0x4200000000000000000000000000000000000006/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",>> pairs.base.json
echo   "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/0x4200000000000000000000000000000000000006">> pairs.base.json
echo ]>> pairs.base.json

echo [ok] Created basic WETH/USDC pairs file

rem === Install dependencies if needed ===
if not exist "node_modules" (
  echo [setup] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [error] npm install failed
    pause
    exit /b 1
  )
)

rem === Set emergency environment variables ===
set BASE_RPC_RPS=1
set RPC_MAX_CONCURRENT=1
set BASE_TRADE_USD=1
set MIN_PROFIT_USD=0.5
set INTERVAL_MS=5000

echo [config] Using emergency conservative settings:
echo   - 1 RPC request per second max
echo   - $1 trade size
echo   - 5 second intervals
echo   - WETH/USDC only
echo.

rem === Start the bot directly ===
echo [run] Starting bot in emergency mode...
echo [info] Dashboard: http://localhost:8787
echo [info] Press Ctrl+C to stop
echo.

node index.js

echo.
echo Bot stopped. Press any key to exit.
pause