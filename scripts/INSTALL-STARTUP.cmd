@echo off
rem Makes HQ open automatically when you sign in to Windows (a shortcut in your Startup folder).
set "LNK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\HQ.lnk"
set "VBS=%~dp0start-hq.vbs"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); $s.TargetPath='wscript.exe'; $s.Arguments='\"' + $env:VBS + '\"'; $s.WorkingDirectory=(Split-Path $env:VBS); $s.IconLocation=(Join-Path (Split-Path (Split-Path $env:VBS)) 'web\luthur.ico'); $s.Description='HQ business brain'; $s.Save()"
if exist "%LNK%" (echo HQ will now open when you sign in to Windows.) else (echo Could not create the shortcut.)
timeout /t 3 >nul
