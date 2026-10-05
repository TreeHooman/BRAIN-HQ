# Updates HQ from the newest brain-hq*.zip in Downloads (download it from GitHub first).
# Replaces src, web, config and scripts; keeps brain\, data\ and config\hq.local.json. Backs up first, then restarts HQ.
$ErrorActionPreference = "Stop"
$hq = Split-Path -Parent $PSScriptRoot
$zip = Get-ChildItem "$env:USERPROFILE\Downloads" -Filter "brain-hq*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { Write-Host "No brain-hq*.zip in Downloads. Download it from GitHub first." -ForegroundColor Red; exit 1 }
Write-Host "Updating HQ at $hq from $($zip.Name)"
$tmp = Join-Path $env:TEMP "hq-update"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip.FullName $tmp -Force
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (-not (Test-Path "$($src.FullName)\src\server.ts")) { Write-Host "That zip doesn't look like HQ." -ForegroundColor Red; exit 1 }
$bak = Join-Path $hq ("backup\" + (Get-Date -Format "yyyy-MM-dd_HHmmss"))
New-Item -ItemType Directory $bak -Force | Out-Null
foreach ($d in "src", "web", "config", "scripts") { if (Test-Path "$hq\$d") { Copy-Item "$hq\$d" "$bak\$d" -Recurse -Force } }
Write-Host "Backup saved to $bak"
& "$hq\scripts\STOP-HQ.cmd"
foreach ($d in "src", "web", "config", "scripts") {
  Get-ChildItem "$($src.FullName)\$d" -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($src.FullName.Length + 1)
    if ($rel -ieq "config\hq.local.json") { return }
    $dst = Join-Path $hq $rel
    New-Item -ItemType Directory (Split-Path $dst) -Force | Out-Null
    Copy-Item $_.FullName $dst -Force
  }
}
foreach ($f in "HANDOFF.md", "JARVIS-HANDOFF.md", "CLAUDE.md", "README.md") { if (Test-Path "$($src.FullName)\$f") { Copy-Item "$($src.FullName)\$f" "$hq\$f" -Force } }
Remove-Item $tmp -Recurse -Force
& "$hq\scripts\START-HQ.cmd"
Write-Host "HQ updated and restarted. In the browser press Ctrl+F5 once." -ForegroundColor Green
