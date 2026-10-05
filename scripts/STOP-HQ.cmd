@echo off
rem Stops the HQ server (finds the process listening on port 8800).
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":8800 .*LISTENING"') do (
  echo Stopping HQ (PID %%p)
  taskkill /pid %%p /T /F >nul
)
echo HQ stopped.
timeout /t 2 >nul
