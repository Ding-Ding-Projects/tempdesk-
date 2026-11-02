<#
.SYNOPSIS
    Strict validator for personal wording files, for headless use and tests. The desktop app
    validates with the shared JavaScript module site/assets/wording.js; both enforce the limits
    below. The JavaScript module additionally allows tab and line breaks inside values.

.DESCRIPTION
    Schema: {"schemaVersion":1,"entries":{"<ordinary>":"<replacement>"}}
    Rules: UTF-8 (no BOM required, BOM tolerated), at most 256 KiB, nesting depth at most 8,
    duplicate keys rejected at every level (checked by a small strict tokenizer, because
    ConvertFrom-Json silently keeps the last duplicate), keys 1..160 characters and not
    __proto__ / prototype / constructor, values strings of at most 1000 characters, no control
    characters in keys or values, no unknown top-level keys. Never partial: either the whole
    file is valid and returned, or an error code is returned.
#>
Set-StrictMode -Version 3

$script:Forbidden = @('__proto__', 'prototype', 'constructor')

function script:Fail { param([string] $Code, [string] $Detail = '') [pscustomobject]@{ Ok = $false; Error = $Code; Detail = $Detail; Entries = $null } }

function script:ReadJson {
    <# Recursive descent JSON reader returning ordered dictionaries; throws on duplicates. #>
    param([string] $s, [ref] $pos, [int] $depth)
    if ($depth -gt 8) { throw 'depth' }
    SkipWs $s $pos
    if ($pos.Value -ge $s.Length) { throw 'syntax' }
    $ch = $s[$pos.Value]
    if ($ch -eq '{') {
        $pos.Value++
        $obj = [ordered]@{}
        $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        SkipWs $s $pos
        if ($pos.Value -lt $s.Length -and $s[$pos.Value] -eq '}') { $pos.Value++; return , $obj }
        while ($true) {
            SkipWs $s $pos
            if ($pos.Value -ge $s.Length -or $s[$pos.Value] -ne '"') { throw 'syntax' }
            $k = ReadString $s $pos
            if (-not $seen.Add($k)) { throw ('duplicate:' + $k) }
            SkipWs $s $pos
            if ($pos.Value -ge $s.Length -or $s[$pos.Value] -ne ':') { throw 'syntax' }
            $pos.Value++
            $obj[$k] = ReadJson $s $pos ($depth + 1)
            SkipWs $s $pos
            if ($pos.Value -ge $s.Length) { throw 'syntax' }
            if ($s[$pos.Value] -eq ',') { $pos.Value++; continue }
            if ($s[$pos.Value] -eq '}') { $pos.Value++; return , $obj }
            throw 'syntax'
        }
    }
    if ($ch -eq '[') {
        $pos.Value++
        $arr = New-Object System.Collections.ArrayList
        SkipWs $s $pos
        if ($pos.Value -lt $s.Length -and $s[$pos.Value] -eq ']') { $pos.Value++; return , $arr.ToArray() }
        while ($true) {
            [void]$arr.Add((ReadJson $s $pos ($depth + 1)))
            SkipWs $s $pos
            if ($pos.Value -ge $s.Length) { throw 'syntax' }
            if ($s[$pos.Value] -eq ',') { $pos.Value++; continue }
            if ($s[$pos.Value] -eq ']') { $pos.Value++; return , $arr.ToArray() }
            throw 'syntax'
        }
    }
    if ($ch -eq '"') { return (ReadString $s $pos) }
    $m = [regex]::Match($s.Substring($pos.Value), '^(true|false|null|-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?)')
    if (-not $m.Success) { throw 'syntax' }
    $pos.Value += $m.Length
    switch ($m.Value) { 'true' { return $true } 'false' { return $false } 'null' { return $null } default { return [double]::Parse($m.Value, [Globalization.CultureInfo]::InvariantCulture) } }
}
function script:SkipWs { param([string] $s, [ref] $pos) while ($pos.Value -lt $s.Length -and ' ', "`t", "`n", "`r" -contains [string]$s[$pos.Value]) { $pos.Value++ } }
function script:ReadString {
    param([string] $s, [ref] $pos)
    $pos.Value++
    $sb = New-Object System.Text.StringBuilder
    while ($true) {
        if ($pos.Value -ge $s.Length) { throw 'syntax' }
        $c = $s[$pos.Value]
        if ($c -eq '"') { $pos.Value++; return $sb.ToString() }
        if ([int]$c -lt 0x20) { throw 'syntax' }
        if ($c -eq '\') {
            $pos.Value++
            if ($pos.Value -ge $s.Length) { throw 'syntax' }
            $e = $s[$pos.Value]
            switch -CaseSensitive ([string]$e) {
                '"' { [void]$sb.Append('"') } '\' { [void]$sb.Append('\') } '/' { [void]$sb.Append('/') }
                'b' { [void]$sb.Append([char]8) } 'f' { [void]$sb.Append([char]12) } 'n' { [void]$sb.Append("`n") }
                'r' { [void]$sb.Append("`r") } 't' { [void]$sb.Append("`t") }
                'u' {
                    $hex = if ($pos.Value + 4 -lt $s.Length) { $s.Substring($pos.Value + 1, 4) } else { '' }
                    if ($hex -notmatch '^[0-9A-Fa-f]{4}$') { throw 'syntax' }
                    [void]$sb.Append([char][Convert]::ToInt32($hex, 16)); $pos.Value += 4
                }
                default { throw 'syntax' }
            }
            $pos.Value++
            continue
        }
        [void]$sb.Append($c); $pos.Value++
    }
}

function Test-TdVocabulary {
    <#
    .SYNOPSIS
        Validates a personal wording file. Accepts -Bytes (raw file) or -Text.
        Returns [pscustomobject]@{ Ok; Error; Detail; Entries (ordered dictionary) }.
        Error codes: tooLarge, encoding, syntax, depth, duplicate, schema, version, entries,
        keyLength, keyForbidden, keyControl, valueType, valueLength, valueControl, empty.
    #>
    [CmdletBinding(DefaultParameterSetName = 'Bytes')]
    param([Parameter(ParameterSetName = 'Bytes', Mandatory)][byte[]] $Bytes, [Parameter(ParameterSetName = 'Text', Mandatory)][AllowEmptyString()][string] $Text)
    if ($PSCmdlet.ParameterSetName -eq 'Bytes') {
        if ($Bytes.Length -gt 262144) { return (Fail 'tooLarge') }
        try { $Text = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($Bytes) } catch { return (Fail 'encoding') }
    } elseif ([Text.Encoding]::UTF8.GetByteCount($Text) -gt 262144) { return (Fail 'tooLarge') }
    if ($Text.Length -gt 0 -and $Text[0] -eq [char]0xFEFF) { $Text = $Text.Substring(1) }
    if (-not $Text.Trim()) { return (Fail 'empty') }
    $pos = 0
    try {
        $doc = ReadJson $Text ([ref]$pos) 1
        SkipWs $Text ([ref]$pos)
        if ($pos -ne $Text.Length) { throw 'syntax' }
    } catch {
        $m = [string]$_.Exception.Message
        if ($m -like 'duplicate:*') { return (Fail 'duplicate' $m.Substring(10)) }
        if ($m -eq 'depth') { return (Fail 'depth') }
        return (Fail 'syntax' ([string]$pos))
    }
    if ($doc -isnot [System.Collections.IDictionary]) { return (Fail 'schema') }
    foreach ($k in $doc.Keys) { if ($k -notin @('schemaVersion', 'entries')) { return (Fail 'schema' $k) } }
    if (-not $doc.Contains('schemaVersion') -or $doc['schemaVersion'] -isnot [double] -or $doc['schemaVersion'] -ne 1) { return (Fail 'version') }
    if (-not $doc.Contains('entries') -or $doc['entries'] -isnot [System.Collections.IDictionary]) { return (Fail 'entries') }
    $out = [ordered]@{}
    foreach ($k in $doc['entries'].Keys) {
        $v = $doc['entries'][$k]
        if ($k.Length -lt 1 -or $k.Length -gt 160) { return (Fail 'keyLength' $k) }
        if ($script:Forbidden -contains $k) { return (Fail 'keyForbidden' $k) }
        if ($k -match '[\x00-\x1F\x7F]') { return (Fail 'keyControl' $k) }
        if ($v -isnot [string]) { return (Fail 'valueType' $k) }
        if ($v.Length -gt 1000) { return (Fail 'valueLength' $k) }
        if ($v -match '[\x00-\x1F\x7F]') { return (Fail 'valueControl' $k) }
        $out[$k] = $v
    }
    [pscustomobject]@{ Ok = $true; Error = $null; Detail = ''; Entries = $out }
}

Export-ModuleMember -Function Test-TdVocabulary
