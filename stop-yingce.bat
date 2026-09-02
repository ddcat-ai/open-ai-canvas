@echo off
title Stop YingCe services
cd /d "%~dp0"

echo ============================================
echo   Stop YingCe services
echo ============================================
echo.
echo   Stopping these services:
echo     3000   frontend
echo     8080   backend
echo     8787   GLM proxy
echo     17371  canvas agent
echo.
echo   The console panel (17580) stays open,
echo   so you can click Start All there later.
echo.

echo [1/4] Frontend      (3000)  ...
call :KILLPORT 3000

echo [2/4] Backend       (8080)  ...
call :KILLPORT 8080

echo [3/4] GLM proxy     (8787)  ...
call :KILLPORT 8787

echo [4/4] Canvas agent  (17371) ...
call :KILLPORT 17371

echo.
echo Cleaning up leftovers ...
taskkill /F /IM canvas-backend.exe >nul 2>&1

echo.
echo ============================================
echo   Services stopped.
echo.
echo   Panel:  http://127.0.0.1:17580/
echo           click "Start All" to bring them back
echo.
echo   To stop the panel too, close its window
echo   or run:  stop-console.bat
echo ============================================
echo.
timeout /t 6 >nul
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
