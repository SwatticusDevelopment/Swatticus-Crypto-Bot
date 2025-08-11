@echo off
cd /d %~dp0
node scripts/rebalance-now.js --wallet-scan --fromBlock 0 --include-stables
pause
