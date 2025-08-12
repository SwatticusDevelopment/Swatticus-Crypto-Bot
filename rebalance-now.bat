@echo off
setlocal
cd /d %~dp0
REM One-shot rebalance using npm script
call npm run rebalance %*
endlocal
