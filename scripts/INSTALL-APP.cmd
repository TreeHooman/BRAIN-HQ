@echo off
rem Installs HQ as a desktop app: a Desktop icon and a Start menu entry (pin it to the taskbar from there).
rem No admin rights needed. Undo with UNINSTALL-APP.cmd.
set "VBS=%~dp0start-hq.vbs"
set "ICO=%~dp0..\web\icon.ico"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w=New-Object -ComObject WScript.Shell; $ico=(Resolve-Path $env:ICO).Path;" ^
  "foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){" ^
  " $s=$w.CreateShortcut((Join-Path $d 'HQ.lnk')); $s.TargetPath=\"$env:SystemRoot\System32\wscript.exe\"; $s.Arguments='\"'+$env:VBS+'\"';" ^
  " $s.WorkingDirectory=(Split-Path $env:VBS); $s.IconLocation=\"$ico,0\"; $s.Description='HQ business brain (Luthor)'; $s.Save() }"
echo HQ is installed: Desktop icon + Start menu. To pin it, right-click HQ in Start ^> Pin to taskbar.
timeout /t 5 >nul
