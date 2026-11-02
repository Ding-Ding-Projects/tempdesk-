# Shared helper for the unattended setup scripts: writes progress to
# C:\ProgramData\TempDesk\setup-status.json (read by the Deployer over WinRM and shown on the console).
function Set-SetupStatus {
    param([string] $Stage, [ValidateSet('running', 'done', 'failed', 'ready')] [string] $State, [string] $Message)
    $path = 'C:\ProgramData\TempDesk\setup-status.json'
    $history = @()
    if (Test-Path $path) {
        try { $history = @((Get-Content -LiteralPath $path -Raw | ConvertFrom-Json).history) } catch { $history = @() }
    }
    $entry = [ordered]@{ time = (Get-Date).ToUniversalTime().ToString('o'); stage = $Stage; state = $State; message = $Message }
    $history = @($history | Select-Object -Last 49) + [pscustomobject]$entry
    [ordered]@{ stage = $Stage; state = $State; message = $Message; updated = $entry.time; history = $history } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding utf8
    Write-Host ("[{0}] {1}: {2}" -f $State.ToUpper(), $Stage, $Message)
}
