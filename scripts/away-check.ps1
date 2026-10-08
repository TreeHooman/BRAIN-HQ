# Away mode readiness check (docs/AWAY-MODE.md). Read-only: it changes nothing, it only reports what is ready
# and what still needs doing by hand. Run AWAY-CHECK.cmd. Writes the result to data\away-check.txt too.
$ErrorActionPreference = 'SilentlyContinue'
$hq = Split-Path -Parent $PSScriptRoot
$out = New-Object System.Collections.Generic.List[string]
function Row($ok, $what, $fix) { $mark = if ($ok -eq $true) { '[ OK ]' } elseif ($ok -eq $false) { '[TODO]' } else { '[ ?? ]' }; $out.Add("$mark $what" + $(if ($fix -and $ok -ne $true) { "`n       -> $fix" } else { '' })) }

# 1. LUTHUR keeps the PC awake (config keepAwake, local override wins)
$cfg = Get-Content "$hq\config\hq.json" -Raw | ConvertFrom-Json
$loc = Get-Content "$hq\config\hq.local.json" -Raw | ConvertFrom-Json
$ka = if ($loc.keepAwake) { $loc.keepAwake } else { $cfg.keepAwake }
Row ($ka -eq 'always') "LUTHUR keeps the PC awake (keepAwake = $ka)" 'Set keepAwake to "always" (Settings or config\hq.json).'

# 2. Windows sleep/hibernate on mains power (LUTHUR's keep-awake covers sleep while it runs; this is the backup)
function AcIndex($sub, $setting) { $t = (powercfg /q SCHEME_CURRENT $sub $setting | Out-String); if ($t -match 'Current AC Power Setting Index:\s*0x([0-9a-fA-F]+)') { return [Convert]::ToInt32($Matches[1], 16) } return $null }
$sleepAc = AcIndex 238c9fa8-0aad-41ed-83f4-97be242c8f20 29f6c1db-86da-48c5-9fdb-f2b67b1f44da
$hibAc = AcIndex 238c9fa8-0aad-41ed-83f4-97be242c8f20 9d7815a6-7ee4-497e-8888-515a05f02364
Row ($sleepAc -eq 0) "Windows sleep when plugged in: $(if ($sleepAc -eq 0) { 'never' } else { [math]::Round($sleepAc/60).ToString() + ' min' })" 'Settings > System > Power > Screen, sleep & hibernate timeouts > "When plugged in, put my device to sleep after" = Never.'
Row ($hibAc -eq 0) "Windows hibernate when plugged in: $(if ($hibAc -eq 0) { 'never' } else { [math]::Round($hibAc/60).ToString() + ' min' })" 'Same page: hibernate when plugged in = Never.'

# 3. Comes back after a reboot: automatic sign-in + LUTHUR in Startup + watchdog
$auto = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon').AutoAdminLogon
Row ($auto -eq '1') "Windows signs in by itself after a restart" 'Download Sysinternals Autologon from Microsoft (learn.microsoft.com/sysinternals/downloads/autologon), run it, enter your Windows password, Enable. (Or Win+R > netplwiz.) Trade-off: anyone at the PC gets your desktop.'
Row (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\HQ.lnk") 'LUTHUR starts when Windows signs in' 'Run scripts\INSTALL-STARTUP.cmd.'
$wd = @(Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" | Where-Object { $_.CommandLine -like '*watchdog.vbs*' }).Count
Row ($wd -ge 1) "Watchdog running (restarts LUTHUR if it crashes)" 'Run scripts\RESTART-LUTHUR.cmd once.'

# 4. Phone access: Tailscale running, starts with Windows, serving LUTHUR, key won't expire mid-trip
$ts = 'C:\Program Files\Tailscale\tailscale.exe'
if (Test-Path $ts) {
  $st = & $ts status --json | ConvertFrom-Json
  Row ($st.BackendState -eq 'Running') "Tailscale connected ($($st.Self.DNSName.TrimEnd('.')))" 'Open Tailscale and sign in.'
  $svc = Get-Service Tailscale
  Row ($svc.StartType -eq 'Automatic') "Tailscale service starts with Windows ($($svc.StartType))" 'services.msc > Tailscale > Startup type: Automatic.'
  $serve = (& $ts serve status --json | Out-String)
  Row ($serve -match '127\.0\.0\.1:8800') 'LUTHUR shared on Tailscale (phone address works)' 'Today > Away mode > Turn on.'
  $exp = $st.Self.KeyExpiry
  if ($exp) { $days = [math]::Floor(([datetime]$exp - (Get-Date)).TotalDays); Row ($false) "Tailscale key for this PC expires in $days days ($exp): after that the phone can't reach it" 'login.tailscale.com/admin/machines > this PC (...) menu > Disable key expiry.' }
  else { Row $true 'Tailscale key expiry disabled for this PC' }
  $phones = @($st.Peer.PSObject.Properties.Value | Where-Object { $_.OS -in 'iOS', 'android' })
  Row ($phones.Count -ge 1) "Phone on Tailscale ($(($phones | ForEach-Object { $_.DNSName.Split('.')[0] + ' ' + $(if ($_.Online) { 'online' } else { 'offline' }) }) -join ', '))" 'Install Tailscale on the phone and sign in with the same account.'
  foreach ($p in $phones) { if ($p.KeyExpiry) { $d = [math]::Floor(([datetime]$p.KeyExpiry - (Get-Date)).TotalDays); Row ($false) "Phone $($p.DNSName.Split('.')[0]) Tailscale key expires in $d days" 'login.tailscale.com/admin/machines > the phone > Disable key expiry.' } }
} else { Row $false 'Tailscale installed' 'tailscale.com/download, sign in with the same account as the phone.' }

# 5. Hearing about problems
Row ([bool]($loc.notifications.ntfy.enabled -or $cfg.notifications.ntfy.enabled) -and [bool]$loc.notifications.ntfy.topic) 'Phone alerts (ntfy) set up' 'Settings > Notifications.'
Row ([bool]$loc.health.pingUrl) 'Dead-man alert (you hear about it when the PC is off or offline)' 'healthchecks.io (free): new check, period 10 min, grace 30 min, add your email/phone. Copy its ping URL and paste it in Today > Away mode > Dead-man ping.'

# 6. Fixing things from away
$crd = Get-Service chromoting
Row ([bool]$crd) "Remote desktop into this PC (Chrome Remote Desktop $(if ($crd) { $crd.Status } else { 'not installed' }))" 'remotedesktop.google.com/access > Set up remote access, choose a PIN; test it from the phone on mobile data.'

# 7. Windows Update won't reboot at a bad time
$ux = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
$pause = $ux.PauseUpdatesExpiryTime
Row ($null) "Windows Update: $(if ($pause) { 'paused until ' + $pause } else { 'not paused' }); active hours $($ux.ActiveHoursStart):00-$($ux.ActiveHoursEnd):00" 'Optional: Settings > Windows Update > Pause updates (max 5 weeks) or set active hours. With automatic sign-in, LUTHUR comes back after an update reboot anyway.'

# 8. Things only you can check
Row ($null) 'BIOS: power on by itself after a power cut' 'Restart, open BIOS/UEFI setup (usually Del or F2), find "Restore on AC Power Loss" / "AC Back" / "After Power Failure" = Power On, save.'
Row ($null) 'Engines signed in fresh' 'Right before leaving: scripts\SIGN-IN-CLAUDE.cmd, and "codex login" in a terminal.'
Row ($null) 'Dry run' '3-5 days using only the phone (Tailscale on, mobile data), before the real trip.'

$text = "LUTHUR away-mode check, $(Get-Date -Format 'yyyy-MM-dd HH:mm')`n`n" + ($out -join "`n") + "`n"
$text | Out-File -Encoding utf8 "$hq\data\away-check.txt"
Write-Output $text
