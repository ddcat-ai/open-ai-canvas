@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "& { docker compose --project-directory '%~dp0' --project-name open-ai-canvas -f '%~dp0docker-compose.local.yml' down; if (`$LASTEXITCODE -ne 0) { exit `$LASTEXITCODE } }"
if errorlevel 1 (
    echo.
    echo Shutdown failed. Review the message above.
    pause
)
endlocal
