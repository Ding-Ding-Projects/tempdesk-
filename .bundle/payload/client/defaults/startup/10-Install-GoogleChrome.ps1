<#
.SYNOPSIS
    Default TempDesk startup script: makes sure Google Chrome is installed on every guest PC.

.DESCRIPTION
    Runs as SYSTEM at computer startup. If Chrome is already installed it does nothing
    (Chrome keeps itself updated through Google Update).
    Install source, in order:
      1. \\<domain>\SYSVOL\<domain>\TempDesk\software\googlechromestandaloneenterprise64.msi
         (put the MSI there for offline or faster installs)
      2. Download of the official Chrome Enterprise MSI from dl.google.com
    The MSI's Authenticode signature must be valid and signed by Google, or it is not installed.
    Edit or delete this script in the admin console under Presetup > Startup scripts.
#>
$ErrorActionPreference = 'Stop'
$log = Join-Path $env:ProgramData 'TempDesk\client\startup.log'
function Log([string] $m) { Add-Content -LiteralPath $log -Value ("{0:u} [chrome] {1}" -f (Get-Date), $m) }

$paths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
if ($paths | Where-Object { $_ -and (Test-Path $_) }) { Log 'Chrome already installed.'; return }

$msiName = 'googlechromestandaloneenterprise64.msi'
$share = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "software\$msiName"
$tmp = Join-Path $env:TEMP $msiName
try {
    if (Test-Path $share) {
        Copy-Item -LiteralPath $share -Destination $tmp -Force
        Log "Using MSI from $share"
    }
    else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri "https://dl.google.com/dl/chrome/install/$msiName" -OutFile $tmp
        Log 'Downloaded MSI from dl.google.com'
    }
    $sig = Get-AuthenticodeSignature -FilePath $tmp
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Google LLC') {
        throw "MSI signature check failed: $($sig.Status) $($sig.SignerCertificate.Subject)"
    }
    $p = Start-Process -FilePath msiexec.exe -ArgumentList "/i `"$tmp`" /qn /norestart" -Wait -PassThru
    Log "msiexec exit code $($p.ExitCode)"
}
catch { Log "Install failed: $($_.Exception.Message)" }
finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
