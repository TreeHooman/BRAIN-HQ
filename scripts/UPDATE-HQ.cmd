@echo off
rem Updates HQ from the newest brain-hq*.zip in Downloads, then restarts it.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPDATE-HQ.ps1"
pause
