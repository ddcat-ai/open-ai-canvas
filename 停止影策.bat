@echo off
title Stop YingCe services
cd /d "%~dp0"

echo ============================================
echo   Stop YingCe services (frontend + backend)
echo ============================================
echo.

echo [1/5] Stopping frontend (port 3000) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo       killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/5] Stopping backend (port 8080) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo       killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /IM canvas-backend.exe >nul 2>&1

echo [3/5] Stopping GLM proxy (port 8787) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do (
    echo       killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [4/5] Stopping Niangxiaofang ability service (port 8823) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8823" ^| findstr "LISTENING"') do (
    echo       killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [5/5] Stopping console panel (port 17580) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":17580" ^| findstr "LISTENING"') do (
    echo       killing PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Done.
timeout /t 3 >nul
