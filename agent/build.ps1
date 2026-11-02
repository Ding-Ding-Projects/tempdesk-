<#
.SYNOPSIS
  Builds the TempDesk Agent with the in-box .NET Framework C# compiler.

.DESCRIPTION
  Locates the in-box csc.exe (C:\Windows\Microsoft.NET\Framework64\v4.0.30319)
  and the System.Management.Automation assembly in the GAC, then compiles every
  .cs file under agent\src to agent\bin\TempDeskAgent.exe. There are no NuGet
  packages and no external tools. The script fails loudly: any missing tool or
  compiler error stops the build with a clear message and a non-zero exit code.

.NOTES
  Run on Windows Server 2025 (or any machine with .NET Framework 4.8 and the
  RSAT / GroupPolicy modules installed, which provide the SMA assembly).
#>
[CmdletBinding()]
param(
    [string]$OutDir = (Join-Path $PSScriptRoot 'bin'),
    [string]$SrcDir = (Join-Path $PSScriptRoot 'src')
)

$ErrorActionPreference = 'Stop'

function Fail([string]$message) {
    Write-Host "BUILD FAILED: $message" -ForegroundColor Red
    exit 1
}

Write-Host 'TempDesk Agent build'
Write-Host '===================='

# 1. Locate the in-box C# compiler.
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    # Fall back to the 32-bit framework path if that is all that is present.
    $csc32 = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
    if (Test-Path $csc32) {
        $csc = $csc32
    } else {
        Fail "In-box C# compiler not found at $csc. Is .NET Framework 4.8 installed?"
    }
}
Write-Host "Compiler: $csc"

# 2. Locate System.Management.Automation in the GAC.
$gacRoot = 'C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Management.Automation'
$sma = $null
if (Test-Path $gacRoot) {
    $sma = Get-ChildItem -Path $gacRoot -Recurse -Filter 'System.Management.Automation.dll' |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $sma) {
    Fail "System.Management.Automation.dll not found under $gacRoot. Install the GroupPolicy and ActiveDirectory RSAT modules."
}
Write-Host "SMA assembly: $sma"

# 3. Gather sources.
if (-not (Test-Path $SrcDir)) {
    Fail "Source directory not found: $SrcDir"
}
$sources = Get-ChildItem -Path $SrcDir -Filter '*.cs' -Recurse | ForEach-Object { $_.FullName }
if (-not $sources -or $sources.Count -eq 0) {
    Fail "No .cs files found under $SrcDir"
}
Write-Host ("Sources: {0} files" -f $sources.Count)

# 4. Prepare output.
if (-not (Test-Path $OutDir)) {
    New-Item -ItemType Directory -Path $OutDir | Out-Null
}
$outExe = Join-Path $OutDir 'TempDeskAgent.exe'

# 5. Assemble compiler arguments. C# 5 language level, no debug symbols for a
#    release build, referencing exactly the assemblies the agent uses.
$refs = @(
    'System.dll',
    'System.Core.dll',
    'System.ServiceProcess.dll',
    'System.Configuration.Install.dll',
    'System.DirectoryServices.dll',
    'System.DirectoryServices.AccountManagement.dll',
    'System.Web.Extensions.dll',
    'System.Security.dll',
    'System.Xml.dll',
    'System.Configuration.dll',
    'System.Management.dll'
)

$cscArgs = @(
    '/nologo',
    '/target:exe',
    '/langversion:5',
    '/optimize+',
    '/warn:3',
    "/out:$outExe"
)
foreach ($r in $refs) { $cscArgs += "/reference:$r" }
$cscArgs += "/reference:$sma"
$cscArgs += $sources

Write-Host 'Compiling...'
& $csc $cscArgs
if ($LASTEXITCODE -ne 0) {
    Fail "csc.exe returned exit code $LASTEXITCODE"
}

if (-not (Test-Path $outExe)) {
    Fail "Compiler reported success but $outExe was not produced."
}

Write-Host ''
Write-Host "Build succeeded: $outExe" -ForegroundColor Green
