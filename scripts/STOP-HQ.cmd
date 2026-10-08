@echo off
rem Stops the HQ server (finds the process listening on port 8800).
rem The flag tells the watchdog (watchdog.vbs) this stop is on purpose; starting HQ again removes it.
if exist "%~dp0..\data" echo stopped> "%~dp0..\data\hq-stopped.flag"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8800 .*LISTENING"') do (
  echo Stopping HQ ^(PID %%p^)
  taskkill /pid %%p /T /F >nul
)
echo HQ stopped.
timeout /t 2 >nul
