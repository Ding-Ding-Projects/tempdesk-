<#
.SYNOPSIS
    Counts lines of code per language in the repository (tracked files only when git is
    available) and prints a Markdown table, for the release notes.
#>
[CmdletBinding()]
param([string] $Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$map = [ordered]@{
    '.ps1' = 'PowerShell'; '.psm1' = 'PowerShell'; '.cs' = 'C#'; '.py' = 'Python'; '.js' = 'JavaScript'; '.mjs' = 'JavaScript'; '.cjs' = 'JavaScript'
    '.html' = 'HTML'; '.css' = 'CSS'; '.json' = 'JSON'; '.md' = 'Markdown'; '.yml' = 'YAML'; '.yaml' = 'YAML'; '.sh' = 'Shell'; '.bat' = 'Batch'; '.cmd' = 'Batch'
    '.xml' = 'XML'; '.svg' = 'SVG'; '.toml' = 'TOML'
}
Push-Location $Root
try {
    $files = $null
    if (Get-Command git -ErrorAction SilentlyContinue) { $files = @(git ls-files 2>$null) }
    if (-not $files) {
        $files = Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '[\\/](node_modules|\.git|\.tools|\.bundle|bin|output)[\\/]' } | ForEach-Object { Resolve-Path -Relative $_.FullName }
    }
    $count = @{}
    foreach ($f in $files) {
        $ext = [IO.Path]::GetExtension($f).ToLowerInvariant()
        if (-not $map.Contains($ext) -or -not (Test-Path -LiteralPath $f)) { continue }
        if ($f -match 'unattend-catalog\.json$|package-lock\.json$') { continue }
        $lang = $map[$ext]
        $n = 0
        foreach ($line in [IO.File]::ReadLines((Resolve-Path -LiteralPath $f).ProviderPath)) { if ($line.Trim()) { $n++ } }
        $count[$lang] = [int]$count[$lang] + $n
    }
    $total = ($count.Values | Measure-Object -Sum).Sum
    '| Language | Lines (non-blank) |'
    '| --- | ---: |'
    foreach ($k in ($count.Keys | Sort-Object { -$count[$_] })) { '| {0} | {1:N0} |' -f $k, $count[$k] }
    '| **Total** | **{0:N0}** |' -f $total
}
finally { Pop-Location }
