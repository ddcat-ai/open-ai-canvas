@echo off
title YingCe - image model one-key fix
cd /d "%~dp0"

echo ============================================
echo   YingCe image-model one-key fix
echo ============================================
echo.

echo ---- Step 1/2: relay channel + enable models (idempotent) ----
python "_ops\fix_step1_relay.py"
if errorlevel 1 (
    echo.
    echo [!] Step 1 FAILED. Screenshot this window and send to AI.
    pause
    exit /b 1
)
echo.

echo ---- Step 2/2: fix logical models (orphan cleanup + projection) ----
python "_ops\fix_step2_logical.py"
echo.

echo ============================================
echo   DONE. Back to creation page, press Ctrl+F5:
echo   1. image dropdown should show GPT-Image-2 1K
echo   2. also send a text message to verify chat
echo   If anything looks wrong, screenshot and send to AI.
echo ============================================
pause
