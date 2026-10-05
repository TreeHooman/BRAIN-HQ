@echo off
title HQ - sign in to Claude
cd /d "%~dp0.."
echo.
echo  HQ uses Claude Code in the background, on your Claude subscription.
echo  This signs the Claude CLI in once. Your browser will open: sign in there.
echo.
for /f "delims=" %%i in ('node --no-warnings scripts\claude-path.ts') do set "CLAUDE=%%i"
if not defined CLAUDE (
  echo  Could not find the Claude CLI. Install Claude Code, then run this again.
  pause
  exit /b 1
)
echo  Using: %CLAUDE%
echo.
"%CLAUDE%" auth login
echo.
"%CLAUDE%" auth status
echo.
echo  Done. Go back to HQ and press Retry (Settings), or just wait: HQ retries on its own.
pause
