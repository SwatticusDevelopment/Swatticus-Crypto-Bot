@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Swatticus Fixed - Robust Execution

rem === cd to this script's directory ===
cd /d "%~dp0"

rem === ensure logs directory ===
if not exist "logs" mkdir "logs"

rem === timestamp for log filenames ===
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set TS=%%i
set "RUN_LOG=logs\run-fixed-%TS%.log"

echo ========================================
echo  Swatticus Fixed - Robust Execution
echo ========================================
echo.
echo [NOTICE] This version includes:
echo   - Robust approval handling with retries
echo   - Enhanced error recovery
echo   - Better slippage management
echo   - Comprehensive pre-execution checks
echo   - Session profit tracking
echo.

rem === Check if .env exists ===
if not exist ".env" (
  echo [ERROR] .env file not found!
  echo Please copy .env.example to .env and configure your settings.
  echo.
  echo Critical settings to configure:
  echo   - EVM_RPC_URL: Your Alchemy/Infura endpoint
  echo   - EVM_PRIVATE_KEY: Your wallet private key
  echo   - BASE_RPC_RPS: Set to 1 for reliability
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
console.log('✓ RPC URL configured');
console.log('✓ Private key format valid');
"
if errorlevel 1 goto :fail

rem === Install dependencies if missing ===
if not exist "node_modules" (
  echo [setup] Installing dependencies... (one-time setup)
  call npm ci || goto :fail
)

rem === Create emergency pairs file if missing ===
if not exist "pairs.base.json" (
  echo [emergency] Creating emergency pairs file...
  echo [> pairs.base.json
  echo   "0x4200000000000000000000000000000000000006/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",>> pairs.base.json
  echo   "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913/0x4200000000000000000000000000000000000006",>> pairs.base.json
  echo   "0xeb466342c4d449bc9f53a865d5cb90586f405215/0x4200000000000000000000000000000000000006",>> pairs.base.json
  echo   "0x4200000000000000000000000000000000000006/0xeb466342c4d449bc9f53a865d5cb90586f405215">> pairs.base.json
  echo ]>> pairs.base.json
  echo [ok] Emergency pairs file created (WETH/USDC + USDT/WETH)
)

rem === Quick wallet check ===
echo [check] Testing wallet and RPC connection...
node -e "
require('dotenv').config();
const { ethers } = require('ethers');
(async () => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.EVM_RPC_URL, 8453);
    const wallet = new ethers.Wallet(process.env.EVM_PRIVATE_KEY, provider);
    const address = await wallet.getAddress();
    const balance = await provider.getBalance(address);
    console.log('✓ Wallet:', address);
    console.log('✓ ETH Balance:', ethers.formatEther(balance), 'ETH');
    if (balance < ethers.parseEther('0.01')) {
      console.warn('⚠️ WARNING: Low ETH balance for gas fees');
    }
    const block = await provider.getBlockNumber();
    console.log('✓ Latest block:', block);
    console.log('✓ All systems ready!');
  } catch (e) {
    console.error('❌ Connection test failed:', e.message);
    process.exit(1);
  }
})();
" || goto :fail

rem === Show current configuration ===
echo.
echo [config] Current bot configuration:
node -e "
require('dotenv').config();
console.log('  Trade Size: $' + (process.env.BASE_TRADE_USD || '15'));
console.log('  Min Profit: $' + (process.env.MIN_PROFIT_USD || '3.00'));
console.log('  Slippage: ' + ((process.env.DEFAULT_SLIPPAGE_BPS || '250') / 100) + '%');
console.log('  RPC Rate: ' + (process.env.BASE_RPC_RPS || '1') + ' req/sec');
console.log('  Scan Interval: ' + (process.env.INTERVAL_MS || '2000') + 'ms');
"

echo.
echo [info] Starting enhanced bot with robust execution...
echo [info] Dashboard: http://localhost:8787
echo [info] Log file: %RUN_LOG%
echo [info] Press Ctrl+C to stop
echo.

rem === Start the bot in a new window with real-time output ===
start "Swatticus Fixed - Live Output" cmd /c "
echo ========================================
echo  SWATTICUS FIXED - LIVE EXECUTION
echo ========================================
echo.
echo Starting enhanced bot with robust execution...
echo Dashboard: http://localhost:8787
echo.
npm start 2>&1 | tee \"%RUN_LOG%\"
echo.
echo ========================================
echo  BOT STOPPED
echo ========================================
echo.
echo Session complete. Check %RUN_LOG% for details.
echo Press any key to close this window...
pause
"

echo [info] Bot started in new window with live output
echo [info] This window can be closed safely
echo [info] Monitor the new window for:
echo   - Successful approvals
echo   - Profitable trade executions  
echo   - Session profit tracking
echo   - Real-time error handling
echo.
echo [success] Enhanced Swatticus is now running!
pause
goto :eof

:fail
echo.
echo ========================================
echo  STARTUP FAILED
echo ========================================
echo.
echo [error] Command failed (exit %ERRORLEVEL%). 
echo.
echo Common fixes:
echo   1. Check your .env configuration
echo   2. Ensure RPC URL is working
echo   3. Verify private key format
echo   4. Check internet connection
echo   5. Try BASE_RPC_RPS=1 in .env
echo.
echo For detailed help, run: node diagnose.js
echo.
pause
exit /b %ERRORLEVEL%