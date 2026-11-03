<#
.SYNOPSIS
  Creates and refreshes the SYSVOL Administrative Templates central store so
  the TempDesk agent's ADMX service can serve every Administrative Template
  policy.

.DESCRIPTION
  1. Creates \\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions if it is
     missing, seeding it from the local C:\Windows\PolicyDefinitions (ADMX
     files plus every ADML language subfolder).
  2. When the server has Internet access and -Download is set, downloads the
     latest official "Administrative Templates (.admx) for Windows 11" MSI
     from the Microsoft Download Center, verifies its Authenticode signature
     chains to Microsoft before extracting, extracts with
     `msiexec /a` to a temp folder, and merges the newer files into the
     central store WITHOUT deleting existing files.
  3. Copies all ADML language folders found in either source.

  The ADMX files themselves are never committed to the repository; this script
  copies them from the local Windows image or the signed Microsoft MSI at run
  time. It is called from Initialize-TempDesk.ps1 and from the agent installer.

  Download source (documented): the Microsoft Download Center page
  "Administrative Templates (.admx) for Windows 11" (currently the 25H2
  update, download id 108542 / V3). The exact MSI URL is passed as -MsiUrl so
  it can be updated as Microsoft publishes newer builds; the default below is
  the January 2026 signed release. Always verify the printed Authenticode
  subject is Microsoft before trusting an extracted set.

.NOTES
  Run on the domain controller as an administrator.
#>
[CmdletBinding()]
param(
    [string]$LocalStore = "$env:WINDIR\PolicyDefinitions",
    [string]$DomainDnsName = $env:USERDNSDOMAIN,
    [switch]$Download,
    [string]$MsiUrl = 'https://download.microsoft.com/download/b7ef21a4-2925-4422-a54e-efffe1af1e0e/Administrative%20Templates%20(.admx)%20for%20Windows%2011%20Jan%202026%20Update-V3_signed.msi',
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$m) { if (-not $Quiet) { Write-Host $m } }

if (-not $DomainDnsName) {
    try { $DomainDnsName = (Get-CimInstance Win32_ComputerSystem).Domain } catch { }
}
if (-not $DomainDnsName) {
    throw 'Could not determine the domain DNS name. Pass -DomainDnsName.'
}

$centralStore = "\\$DomainDnsName\SYSVOL\$DomainDnsName\Policies\PolicyDefinitions"
Write-Info "Central store: $centralStore"

function Copy-AdmxTree([string]$sourceRoot, [string]$destRoot) {
    if (-not (Test-Path $sourceRoot)) {
        Write-Info "  Source not found, skipping: $sourceRoot"
        return 0
    }
    New-Item -ItemType Directory -Path $destRoot -Force | Out-Null
    $copied = 0
    # Top-level ADMX files: copy newer only, never delete existing.
    foreach ($admx in Get-ChildItem -Path $sourceRoot -Filter *.admx -File -ErrorAction SilentlyContinue) {
        $dest = Join-Path $destRoot $admx.Name
        if ((-not (Test-Path $dest)) -or ($admx.LastWriteTimeUtc -gt (Get-Item $dest).LastWriteTimeUtc)) {
            Copy-Item -Path $admx.FullName -Destination $dest -Force
            $copied++
        }
    }
    # Every ADML language folder.
    foreach ($langDir in Get-ChildItem -Path $sourceRoot -Directory -ErrorAction SilentlyContinue) {
        if ($langDir.Name -notmatch '^[a-z]{2}-[A-Za-z0-9]{2,4}$') { continue }
        $destLang = Join-Path $destRoot $langDir.Name
        New-Item -ItemType Directory -Path $destLang -Force | Out-Null
        foreach ($adml in Get-ChildItem -Path $langDir.FullName -Filter *.adml -File -ErrorAction SilentlyContinue) {
            $dest = Join-Path $destLang $adml.Name
            if ((-not (Test-Path $dest)) -or ($adml.LastWriteTimeUtc -gt (Get-Item $dest).LastWriteTimeUtc)) {
                Copy-Item -Path $adml.FullName -Destination $dest -Force
                $copied++
            }
        }
    }
    return $copied
}

# 1. Seed / refresh from the local Windows image.
$fromLocal = Copy-AdmxTree -sourceRoot $LocalStore -destRoot $centralStore
Write-Info "  Copied $fromLocal file(s) from $LocalStore"

# 2. Optionally download the latest official MSI and merge it in.
if ($Download) {
    $temp = Join-Path $env:TEMP ("tempdesk-admx-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $msi = Join-Path $temp 'admx.msi'
    try {
        Write-Info "  Downloading ADMX MSI from Microsoft Download Center..."
        Write-Info "    $MsiUrl"
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        } catch { }
        Invoke-WebRequest -Uri $MsiUrl -OutFile $msi -UseBasicParsing

        # Verify the Authenticode signature chains to Microsoft before trusting it.
        $sig = Get-AuthenticodeSignature -FilePath $msi
        $subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '(none)' }
        Write-Info "    Authenticode status : $($sig.Status)"
        Write-Info "    Authenticode subject: $subject"
        if ($sig.Status -ne 'Valid') {
            throw "ADMX MSI Authenticode status is '$($sig.Status)', not 'Valid'. Refusing to extract."
        }
        if ($subject -notmatch 'O=Microsoft Corporation') {
            throw "ADMX MSI is not signed by Microsoft Corporation (subject: $subject). Refusing to extract."
        }

        # Administrative extract (no install) to a temp folder.
        $extract = Join-Path $temp 'extract'
        New-Item -ItemType Directory -Path $extract -Force | Out-Null
        Write-Info "  Extracting with msiexec /a ..."
        $p = Start-Process msiexec.exe -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$extract`"") -Wait -PassThru
        if ($p.ExitCode -ne 0) { throw "msiexec /a returned exit code $($p.ExitCode)." }

        # The MSI lays the set down under a PolicyDefinitions folder somewhere
        # in the extract tree; find it and merge.
        $src = Get-ChildItem -Path $extract -Directory -Recurse -Filter 'PolicyDefinitions' -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if (-not $src) {
            # Some packages extract the admx files directly; find a folder that
            # has .admx files in it.
            $src = Get-ChildItem -Path $extract -Directory -Recurse -ErrorAction SilentlyContinue |
                Where-Object { Get-ChildItem -Path $_.FullName -Filter *.admx -File -ErrorAction SilentlyContinue } |
                Select-Object -First 1
        }
        if ($src) {
            $fromMsi = Copy-AdmxTree -sourceRoot $src.FullName -destRoot $centralStore
            Write-Info "  Merged $fromMsi newer file(s) from the Microsoft MSI."
        } else {
            Write-Info "  Could not locate PolicyDefinitions in the extracted MSI; skipped merge."
        }
    } catch {
        Write-Warning "ADMX MSI download/merge skipped: $($_.Exception.Message)"
    } finally {
        Remove-Item -Path $temp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# 3. Report.
$admxCount = (Get-ChildItem -Path $centralStore -Filter *.admx -File -ErrorAction SilentlyContinue | Measure-Object).Count
$langCount = (Get-ChildItem -Path $centralStore -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^[a-z]{2}-[A-Za-z0-9]{2,4}$' } | Measure-Object).Count
Write-Info "Central store now has $admxCount ADMX file(s) across $langCount language folder(s)."
