$ErrorActionPreference = 'Stop'
foreach ($helperName in @('pc-wake.exe', 'app-window.exe')) {
    $stagedHelper = Join-Path $PSScriptRoot ($helperName + '.next')
    $installedHelper = Join-Path $PSScriptRoot $helperName
    if (Test-Path -LiteralPath $stagedHelper) {
        $helperReplaced = $false
        for ($attemptNumber = 0; $attemptNumber -lt 8; $attemptNumber++) {
            try {
                Move-Item -LiteralPath $stagedHelper -Destination $installedHelper -Force
                $helperReplaced = $true
                break
            } catch {
                Start-Sleep -Milliseconds 500
            }
        }
        if (-not $helperReplaced) { throw "Could not update $helperName. Close LUTHUR and run Restart LUTHUR again." }
    }
}
