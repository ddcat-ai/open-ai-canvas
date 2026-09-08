@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-docker-local-click.ps1"
if errorlevel 1 (
    echo.
    echo Shutdown failed. Review the message above.
    pause
)
endlocal
