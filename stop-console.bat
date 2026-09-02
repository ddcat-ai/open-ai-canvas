@echo off
title Stop YingCe console panel
cd /d "%~dp0"

echo ============================================
echo   Stop YingCe console panel
echo ============================================
echo.
echo   This closes the control panel only.
echo   Use stop-yingce.bat to stop the services.
echo.

call :KILLPORT 17580

echo.
taskkill /F /FI "WINDOWTITLE eq YingCe-Console*" >nul 2>&1

echo ============================================
echo   Panel stopped.
echo.
echo   To start everything again, double-click
echo   the launcher bat in this folder.
echo ============================================
echo.
timeout /t 5 >nul
exit /b 0

:KILLPORT
setlocal enabledelayedexpansion
set "PORT=%~1"
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    set "FOUND=1"
    echo       killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
if "!FOUND!"=="0" echo       not running
endlocal
exit /b 0
