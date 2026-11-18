@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Install Node.js 20+ first.
  pause
  exit /b 1
)

echo Starting PetTicker (dev mode)...
node scripts\dev.mjs
if errorlevel 1 (
  echo.
  echo [ERROR] Dev server exited with an error. See messages above.
  pause
)
