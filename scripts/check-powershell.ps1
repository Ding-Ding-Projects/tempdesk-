<#
.SYNOPSIS
    Parse-checks every .ps1 and .psm1 file in the repository (no execution). Exit code 1 when any
    file has a syntax error. Works on Windows PowerShell 5.1 and PowerShell 7.
#>
[CmdletBinding()]
param([string] $Root)
$ErrorActionPreference = 'Stop'
# $PSScriptRoot can be empty in a param default on Windows PowerShell 5.1, so resolve it here.
if (-not $Root) {
    $here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $Root = Split-Path -Parent $here
}
$skip = '\\(node_modules|\.tools|\.bundle|\.git|bin|output)\\|/(node_modules|\.tools|\.bundle|\.git|bin|output)/'
# Windows PowerShell 5.1 ignores -Include together with -LiteralPath, so filter by extension explicitly.
$files = Get-ChildItem -LiteralPath $Root -Recurse -File |
    Where-Object { ($_.Extension -eq '.ps1' -or $_.Extension -eq '.psm1') -and $_.FullName -notmatch $skip }
$bad = 0
foreach ($f in $files) {
    $tokens = $null; $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors -and $errors.Count) {
        $bad++
        foreach ($e in $errors) { Write-Host ("{0}:{1}:{2} {3}" -f $f.FullName, $e.Extent.StartLineNumber, $e.Extent.StartColumnNumber, $e.Message) }
    }
}
Write-Host ("Parsed {0} PowerShell files, {1} with errors." -f $files.Count, $bad)
if ($bad) { exit 1 }
