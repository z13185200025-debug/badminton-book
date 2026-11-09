@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22+ is required. Install Node.js LTS from https://nodejs.org/ then retry.
  if not defined CI pause
  exit /b 1
)
node.exe "%~dp0tools\start-app.mjs" %*
if errorlevel 1 (
  echo Failed to start. See the message above and docs/windows.md.
  if not defined CI pause
  exit /b 1
)
