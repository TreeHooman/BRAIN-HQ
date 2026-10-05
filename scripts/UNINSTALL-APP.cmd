@echo off
rem Removes the HQ Desktop icon and Start menu entry. Your brain and data are not touched.
powershell -NoProfile -Command "foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ Remove-Item -LiteralPath (Join-Path $d 'HQ.lnk') -ErrorAction SilentlyContinue }"
echo HQ app shortcuts removed.
timeout /t 3 >nul
