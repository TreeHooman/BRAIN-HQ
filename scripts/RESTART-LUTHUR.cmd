@echo off
rem Owner-run restart of the local LUTHUR server, then reuse/open the app window.
call "%~dp0STOP-HQ.cmd"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-helper-updates.ps1"
if errorlevel 1 (
  echo LUTHUR helper update could not finish. Close LUTHUR and try this shortcut again.
  pause
  exit /b 1
)
wscript "%~dp0start-hq.vbs"
