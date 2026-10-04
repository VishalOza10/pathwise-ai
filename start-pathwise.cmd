@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or later, then try again.
  pause
  exit /b 1
)
if not exist node_modules\express (
  echo Install dependencies once with: npm install
  pause
  exit /b 1
)
echo Open http://localhost:3000 in your browser after the server starts.
echo Keep this window open. Press Ctrl+C to stop PathWise.
node --env-file-if-exists=.env server/index.js
pause
