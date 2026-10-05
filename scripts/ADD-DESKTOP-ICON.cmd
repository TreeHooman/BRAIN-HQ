@echo off
rem Puts a LUTHUR icon on the desktop and in the Start menu (double-click to open LUTHUR; starts it if needed).
set "CMDF=%~dp0LUTHUR.cmd"
powershell -NoProfile -Command "$w = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) { $s = $w.CreateShortcut((Join-Path $d 'LUTHUR.lnk')); $s.TargetPath = $env:CMDF; $s.WorkingDirectory = (Split-Path (Split-Path $env:CMDF)); $s.WindowStyle = 1; $s.IconLocation = \"$env:SystemRoot\System32\shell32.dll,43\"; $s.Description = 'LUTHUR business brain'; $s.Save() }"
echo LUTHUR icon added to your desktop and Start menu.
timeout /t 3 >nul
