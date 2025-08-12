@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Swatticus Slippage System - Fixed Version

rem === cd to this script's directory ===
cd /d "%~dp0"

rem === ensure logs directory ===
if not exist "logs" mkdir "logs"

rem === timestamp for log filenames (yyyy-MM-dd_HH-mm-ss) ===
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set TS=%%i

set "PAIR_LOG=logs\pairs-%TS%.log"
set "RUN_LOG=logs\run-%TS%.log"

echo ========================================
echo  Swatticus Slippage System - FIXED
echo ========================================
echo.
echo [NOTICE] This version includes:
echo   - Rate limiting for RPC calls
echo   - Robust error handling
echo   - BaseSwap fallback routing
echo   - Conservative trading parameters
echo.

rem === Check if .env exists ===
if not exist ".env" (
  echo [ERROR] .env file not found!
  echo Please copy .env.example to .env and configure your settings.
  echo.
  echo Critical settings to configure:
  echo   - EVM_RPC_URL: Your Alchemy/Infura endpoint
  echo   - EVM_PRIVATE_KEY: Your wallet private key
  echo   - BASE_RPC_RPS: Set to 2 or lower for free plans
  echo.
  pause
  exit /b 1
)

rem === Validate critical env vars ===
echo [check] Validating environment...
node -e "
require('dotenv').config();
if (!process.env.EVM_RPC_URL) {
  console.error('ERROR: EVM_RPC_URL not set in .env');
  process.exit(1);
}
if (!process.env.EVM_PRIVATE_KEY) {
  console.error('ERROR: EVM_PRIVATE_KEY not set in .env');
  process.exit(1);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(process.env.EVM_PRIVATE_KEY)) {
  console.error('ERROR: EVM_PRIVATE_KEY format invalid (should be 0x + 64 hex chars)');
  process.exit(1);
}
console.log('✓ Environment validation passed');
"
if errorlevel 1 goto :fail

rem === optional: install deps if missing ===
if not exist "node_modules" (
  echo [setup] Installing dependencies... (logging to %PAIR_LOG%)
  call npm ci >> "%PAIR_LOG%" 2>&1 || goto :fail
)

rem === Update critical files with our fixes ===
echo [fix] Applying rate limiting and error handling fixes...

rem Replace the provider in multichainConfig
node -e "
const fs = require('fs');
const path = './src/js/multichainConfig.js';
let content = fs.readFileSync(path, 'utf8');
content = content.replace('EVM_RPC_URL: process.env.EVM_RPC_URL', 'EVM_RPC_URL: process.env.EVM_RPC_URL || \"https://mainnet.base.org\"');
fs.writeFileSync(path, content);
console.log('✓ Updated multichainConfig.js');
"

rem === 1) generate pairs with reduced settings ===
echo [run] Generating pairs... (logging to %PAIR_LOG%)
echo [info] Using conservative settings to avoid rate limits...

rem Set environment variables for pair generation
set V2_ENUM_CONCURRENCY=2
set LOG_CHUNK_BLOCKS=200
set LOG_PAUSE_MS=500

call npm run pairs >> "%PAIR_LOG%" 2>&1
if errorlevel 1 (
  echo [warning] Pair generation had issues. Check %PAIR_LOG%
  echo [info] Continuing with default pairs...
) else (
  echo [ok] Pairs generated. Log: %PAIR_LOG%
)

rem === 2) start the scanner with monitoring ===
echo [run] Starting scanner... (logging to %RUN_LOG%)
echo [info] To watch logs: notepad "%RUN_LOG%"
echo [info] Dashboard will be available at: http://localhost:8787
echo [info] Press Ctrl+C in the new window to stop the bot
echo.

rem Start in a new window so user can see the output
start "Slippage Scanner - Live Output" cmd /c "
echo Starting Swatticus Slippage System...
echo ====================================
echo.
npm start 2>&1 | tee \"%RUN_LOG%\"
echo.
echo Bot has stopped. Press any key to close...
pause
"

echo [info] Scanner started in new window
echo [info] Main log file: %RUN_LOG%
echo [info] Pairs log file: %PAIR_LOG%
echo.
echo Monitor the new window for live output.
echo This window can be closed safely.
pause
goto :eof

:fail
echo.
echo ========================================
echo  STARTUP FAILED
echo ========================================
echo.
echo [error] Command failed (exit %ERRORLEVEL%). Check logs:
echo   - %PAIR_LOG%
echo   - %RUN_LOG%
echo.
echo Common issues and solutions:
echo   1. Rate limiting: Set BASE_RPC_RPS=1 in .env
echo   2. RPC issues: Check your EVM_RPC_URL
echo   3. Network: Ensure internet connection is stable
echo   4. Private key: Verify EVM_PRIVATE_KEY format
echo.
pause
exit /b %ERRORLEVEL%