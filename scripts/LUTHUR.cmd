@echo off
rem Opens LUTHUR. Starts the server first if it isn't running, waits until it answers, then opens the app window.
rem If the server can't start, this window stays open and shows why.
cd /d "%~dp0.."
if not exist data mkdir data
netstat -ano | findstr /r /c:":8800 .*LISTENING" >nul
if errorlevel 1 (
  echo Starting LUTHUR...
  powershell -NoProfile -Command "Start-Process cmd -ArgumentList '/c node --no-warnings src\server.ts >> data\server.log 2>&1' -WorkingDirectory (Get-Location) -WindowStyle Hidden"
  powershell -NoProfile -Command "for ($i = 0; $i -lt 40; $i++) { try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8800/ -TimeoutSec 1 | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } }; exit 1"
  if errorlevel 1 (
    echo.
    echo LUTHUR didn't start. Last lines of HQ\data\server.log:
    echo ---------------------------------------------------
    powershell -NoProfile -Command "Get-Content data\server.log -Tail 20"
    echo ---------------------------------------------------
    echo Send a screenshot of this window to Claude.
    pause
    exit /b 1
  )
)
rem Reuse the shared single-window app launcher.
wscript "%~dp0start-hq.vbs"

