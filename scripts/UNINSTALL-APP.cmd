@echo off
rem Removes the LUTHUR Desktop icon and Start menu entry (LUTHUR itself and your data stay).
powershell -NoProfile -Command "foreach($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))){ foreach($n in 'LUTHUR.lnk','HQ.lnk'){ $p=Join-Path $d $n; if(Test-Path $p){ Remove-Item $p -Force } } }"
echo LUTHUR shortcuts removed.
timeout /t 3 >nul
