@echo off
setlocal
cd /d "%~dp0"
where pwsh.exe >nul 2>nul
if errorlevel 1 (
    echo PowerShell 7 is required for the click-to-stop launcher.
    pause
    exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-docker-local-click.ps1"
if errorlevel 1 (
    echo.
    echo Shutdown failed. Review the message above.
    pause
)
endlocal
