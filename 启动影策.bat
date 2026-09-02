@echo off
title YingCe Console
cd /d "%~dp0"

set "PY=C:\Users\khy\.workbuddy\binaries\python\versions\3.13.12\python.exe"

REM Local services must bypass any system/sandbox proxy,
REM otherwise 127.0.0.1 requests get hijacked and hang forever.
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
set "ALL_PROXY="
set "all_proxy="
set "NO_PROXY=*"

echo ============================================
echo   YingCe Console
echo ============================================
echo.

if not exist "%PY%" (
  echo [ERROR] Python not found:
  echo   %PY%
  echo.
  pause
  exit /b 1
)

echo [1/3] Starting console panel ...
start "YingCe-Console" /min "%PY%" "%~dp0yingce_console.py"

echo [2/3] Waiting for panel on port 17580 ...
set TRY=0
:WAIT
timeout /t 2 >nul
set /a TRY+=1
netstat -ano | findstr ":17580" | findstr "LISTENING" >nul
if %errorlevel%==0 goto READY
if %TRY% GEQ 15 goto FAIL
echo       waiting ... (%TRY%)
goto WAIT

:FAIL
echo.
echo [TIMEOUT] Panel did not come up.
echo To see the error, run this in a terminal:
echo   "%PY%" "%~dp0yingce_console.py"
echo.
pause
exit /b 1

:READY
echo       panel is up.
echo.
echo [3/3] Opening browser ...
start "" http://127.0.0.1:17580/
echo.
echo ============================================
echo   Done!
echo.
echo   Panel  : http://127.0.0.1:17580/
echo   YingCe : http://127.0.0.1:3000/
echo   Login  : zhuren / zhuren2026
echo.
echo   Services are starting in the background.
echo   Watch the panel - the dots turn green when ready.
echo   First frontend build may take 30-60 seconds.
echo.
echo   You can close this window now.
echo   Services keep running because they are detached.
echo.
echo   To stop everything: use the panel's Stop All button.
echo ============================================
echo.
timeout /t 8 >nul
