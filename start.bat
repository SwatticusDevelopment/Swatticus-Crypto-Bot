@echo off
echo Starting Solana Slippage Bot with Jupiter API...
echo.
echo WARNING: This bot will execute REAL trades with your wallet!
echo It will track price movements using Jupiter's API to find opportunities.
echo Make sure you've reviewed the code and understand the risks.
echo.
echo Press Ctrl+C now to abort, or
pause

:: Set Node.js options to disable debugger
set NODE_OPTIONS=--no-inspect

:: Run the bot
node index.js

:: If there's an error, pause to see the message
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo Bot exited with an error. Press any key to close this window.
  pause > nul
) else (
  echo.
  echo Bot exited normally. Press any key to close this window.
  pause > nul
