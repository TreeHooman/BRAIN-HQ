@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\HQ.lnk" 2>nul
echo HQ will no longer open at sign-in.
timeout /t 3 >nul
