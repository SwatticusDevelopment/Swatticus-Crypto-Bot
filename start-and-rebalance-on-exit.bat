@echo off
setlocal ENABLEDELAYEDEXPANSION
cd /d %~dp0

if not exist logs mkdir logs
set LOG=logs\run_%date:~-4%-%date:~4,2%-%date:~7,2%_%time:~0,2%-%time:~3,2%-%time:~6,2%.log
set LOG=%LOG: =0%

echo [pairs] generating... >> "%LOG%"
call npm run pairs >> "%LOG%" 2>&1
if errorlevel 1 echo [pairs] failed >> "%LOG%"

echo [bot] starting... >> "%LOG%"
call npm start >> "%LOG%" 2>&1

echo [rebalance] running after exit... >> "%LOG%"
call npm run rebalance >> "%LOG%" 2>&1

echo [done] >> "%LOG%"
endlocal
