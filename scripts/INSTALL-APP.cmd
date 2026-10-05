@echo off
rem Installs LUTHUR as a desktop app: a Desktop icon and a Start menu entry with the eye logo (pin it to the taskbar from
rem Start). No admin rights needed. It opens LUTHUR in its own window and starts the server first if needed.
rem Undo with UNINSTALL-APP.cmd.
set "VBS=%~dp0start-hq.vbs"
set "ICO=%~dp0..\web\luthur.ico"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$w=New-Object -ComObject WScript.Shell; $ico=(Resolve-Path $env:ICO).Path;" ^
  "foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){" ^
  " foreach($old in 'HQ.lnk'){ $o=Join-Path $d $old; if(Test-Path $o){ Remove-Item $o -Force } }" ^
  " $s=$w.CreateShortcut((Join-Path $d 'LUTHUR.lnk')); $s.TargetPath=\"$env:SystemRoot\System32\wscript.exe\"; $s.Arguments='\"'+$env:VBS+'\"';" ^
  " $s.WorkingDirectory=(Split-Path $env:VBS); $s.IconLocation=\"$ico,0\"; $s.Description='LUTHUR business brain'; $s.Save() }"
echo LUTHUR is installed: Desktop icon + Start menu. To pin it, right-click LUTHUR in Start ^> Pin to taskbar.
timeout /t 5 >nul
