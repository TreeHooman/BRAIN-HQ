@echo off
rem Away mode readiness check: read-only, changes nothing. See docs\AWAY-MODE.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0away-check.ps1"
pause
