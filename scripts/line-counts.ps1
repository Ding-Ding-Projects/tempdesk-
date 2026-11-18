[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

$extensions = '.ps1','.psm1','.cs','.py','.js','.mjs','.cjs','.html','.css','.json','.md','.yml','.yaml','.sh','.bat','.cmd','.xml','.svg','.toml'
$rows = [ordered]@{}
foreach ($category in 'Source', 'Tests', 'Styles and markup', 'Generated metadata') {
    $rows[$category] = @{ total = 0; nonBlank = 0; automation = 0; people = 0 }
}

Push-Location $Root
try {
    $automation = [System.Collections.Generic.HashSet[string]]::new()
    $sha = ''
    foreach ($record in git log --format='%H%n%an <%ae>%n%(trailers:key=Co-Authored-By,valueonly)' HEAD) {
        if ($record -cmatch '^[0-9a-f]{40}$') { $sha = $record; continue }
        if ($sha -and $record -match 'noreply@anthropic\.com|noreply@openai\.com|\[bot\]@users\.noreply\.github\.com|^(github-actions|dependabot)\[bot\] ') {
            $null = $automation.Add($sha)
        }
    }

    foreach ($file in git -c core.quotepath=false ls-tree -r --name-only HEAD) {
        $extension = [IO.Path]::GetExtension($file)
        if ($extension -notin $extensions -or $file -match '(^|/)(vendor|node_modules|bin|output|evidence|walkthrough)/') { continue }
        $category = switch -Regex ($file) {
            '(^|/)(package-lock\.json|unattend-catalog\.json)$|^deployer/i18n/(en|zh-HK)\.json$' { 'Generated metadata'; break }
            '(^|/)(test|tests|__tests__)(/|$)|\.test\.' { 'Tests'; break }
            '\.(css|html|md|svg|xml)$' { 'Styles and markup'; break }
            default { 'Source' }
        }
        $bucket = $rows[$category]
        if ($category -eq 'Generated metadata') {
            $lines = @(git show "HEAD:$file")
            $bucket.total += $lines.Count
            $bucket.nonBlank += @($lines | Where-Object { $_.Trim() }).Count
            continue
        }

        $owner = ''
        foreach ($record in git blame --line-porcelain HEAD -- $file) {
            if ($record -cmatch '^([0-9a-f]{40}) \d+ \d+( \d+)?$') {
                $owner = $Matches[1]
            } elseif ($record.StartsWith([string][char]9)) {
                $bucket.total++
                if ($record.Substring(1).Trim()) { $bucket.nonBlank++ }
                if ($automation.Contains($owner)) { $bucket.automation++ } else { $bucket.people++ }
            }
        }
    }

    '| Category | All lines | Non-blank lines | Automation | People |'
    '| --- | ---: | ---: | ---: | ---: |'
    $project = @{ total = 0; nonBlank = 0; automation = 0; people = 0 }
    foreach ($category in 'Source', 'Tests', 'Styles and markup') {
        $row = $rows[$category]
        '| {0} | {1:N0} | {2:N0} | {3:N0} | {4:N0} |' -f $category, $row.total, $row.nonBlank, $row.automation, $row.people
        foreach ($key in @($project.Keys)) { $project[$key] += $row[$key] }
    }
    '| **Project total** | **{0:N0}** | **{1:N0}** | **{2:N0}** | **{3:N0}** |' -f $project.total, $project.nonBlank, $project.automation, $project.people
    $generated = $rows['Generated metadata']
    '| Generated metadata | {0:N0} | {1:N0} | Excluded | Excluded |' -f $generated.total, $generated.nonBlank
    '| **Grand total** | **{0:N0}** | **{1:N0}** | **{2:N0}** | **{3:N0}** |' -f ($project.total + $generated.total), ($project.nonBlank + $generated.nonBlank), $project.automation, $project.people
    ''
    'Counts tracked text in the listed source formats at HEAD. Excludes binaries, vendored files, build/dependency directories, and captured evidence. Lockfiles and generated catalogs are reported separately.'
    'Attribution uses the surviving lines from git blame. Automation includes known bot identities and assistant author or co-author addresses. Remaining attributed lines are classified as people.'
} finally {
    Pop-Location
}
