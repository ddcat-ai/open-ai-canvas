@echo off
setlocal
rem ==============================================================
rem  YingCe Integration Self-Check  (read-only, changes nothing)
rem
rem  Tells you in one click which link of the chain is broken:
rem    1. service ports
rem    2. canvas connection  <-- the #1 cause of MCP "tool call failed"
rem    3. local patches (upstream updates can silently drop them)
rem    4. skill library
rem
rem  NOTE: all text in this file is ASCII-only on purpose.
rem        Chinese in .bat gets mangled by GBK/UTF-8 conflicts on Windows.
rem ==============================================================

set "PY=C:\Users\khy\.workbuddy\binaries\python\versions\3.13.12\python.exe"
set "SCRIPT=%~dp0_ops\check_integration.py"

if not exist "%PY%" (
    echo [x] Python not found: %PY%
    pause
    exit /b 1
)
if not exist "%SCRIPT%" (
    echo [x] Script not found: %SCRIPT%
    pause
    exit /b 1
)

"%PY%" "%SCRIPT%"
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="0" (
    echo --------------------------------------------------------------
    echo  ALL GREEN. You can now test canvas_get_context in WorkBuddy.
    echo --------------------------------------------------------------
) else (
    echo --------------------------------------------------------------
    echo  SOMETHING IS BROKEN. Follow the arrow lines printed above.
    echo  Most common fix: open this URL in your browser:
    echo      http://127.0.0.1:3000/canvas?mode=new
    echo --------------------------------------------------------------
)

echo.
pause
endlocal
