# Updates HQ from a zip. Manual: uses the newest brain-hq*.zip in Downloads. From HQ's Update button: -Zip -Sha -HqPid.
# Replaces src, web, config and scripts; keeps brain\, data\ and config\hq.local.json. Backs up first; restores the backup if
# copying fails; always restarts HQ.
param([string]$Zip = "", [string]$Sha = "", [int]$HqPid = 0)
$ErrorActionPreference = "Stop"
$hq = Split-Path -Parent $PSScriptRoot
$auto = $Sha -match '^[0-9a-f]{40}$'
if ($auto) { New-Item -ItemType Directory "$hq\data" -Force | Out-Null; Start-Transcript -Path "$hq\data\update.log" -Force | Out-Null; Start-Sleep -Seconds 2 }
if ($Zip) { $zip = Get-Item -LiteralPath $Zip } else { $zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "brain-hq*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
if (-not $zip) { Write-Host "No brain-hq*.zip in Downloads. Download it from GitHub first." -ForegroundColor Red; exit 1 }
Write-Host "Updating HQ at $hq from $($zip.Name)"
$tmp = Join-Path $env:TEMP "hq-update"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip.FullName $tmp -Force
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (-not $src -or -not (Test-Path "$($src.FullName)\src\server.ts")) { Write-Host "That zip doesn't look like HQ." -ForegroundColor Red; Remove-Item $tmp -Recurse -Force; exit 1 }
$dirs = "src", "web", "config", "scripts"
$bak = Join-Path $hq ("backup\" + (Get-Date -Format "yyyy-MM-dd_HHmmss"))
New-Item -ItemType Directory $bak -Force | Out-Null
foreach ($d in $dirs) { if (Test-Path "$hq\$d") { Copy-Item "$hq\$d" "$bak\$d" -Recurse -Force } }
Write-Host "Backup saved to $bak"
if ($HqPid -gt 0) { cmd /c "taskkill /pid $HqPid /T /F >nul 2>&1"; Start-Sleep -Seconds 2 } else { & "$hq\scripts\STOP-HQ.cmd" }
try {
  foreach ($d in $dirs) {
    Get-ChildItem "$($src.FullName)\$d" -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($src.FullName.Length + 1)
      if ($rel -ieq "config\hq.local.json") { return }
      $dst = Join-Path $hq $rel
      New-Item -ItemType Directory (Split-Path $dst) -Force | Out-Null
      Copy-Item $_.FullName $dst -Force
    }
  }
  foreach ($f in "HANDOFF.md", "CLAUDE.md", "README.md") { if (Test-Path "$($src.FullName)\$f") { Copy-Item "$($src.FullName)\$f" "$hq\$f" -Force } }
  if ($auto) { @{ sha = $Sha; at = (Get-Date).ToString("o") } | ConvertTo-Json | Set-Content -Encoding UTF8 "$hq\data\version.json" }
  Write-Host "HQ updated." -ForegroundColor Green
} catch {
  Write-Host "Update failed: $_. Restoring the backup." -ForegroundColor Red
  foreach ($d in $dirs) { if (Test-Path "$bak\$d") { Copy-Item "$bak\$d\*" "$hq\$d" -Recurse -Force } }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  if ($Zip) { Remove-Item -LiteralPath $zip.FullName -Force -ErrorAction SilentlyContinue }
  if ($auto) { & wscript "$hq\scripts\start-hq.vbs" --silent; Stop-Transcript | Out-Null }
  else { & "$hq\scripts\START-HQ.cmd"; Write-Host "HQ restarted. In the browser press Ctrl+F5 once." -ForegroundColor Green }
}
