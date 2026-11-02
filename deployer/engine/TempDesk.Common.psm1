<#
.SYNOPSIS
    Shared helpers for the TempDesk Deployer engine: the JSON-lines progress protocol,
    secret handling, protected folders, resumable step state and env file generation.

.DESCRIPTION
    Progress protocol (one JSON object per line on stdout):
      {"type":"step","id":"<step id>","state":"pending|running|done|failed|skipped","title":"...","hint":"..."}
      {"type":"log","level":"info|warn|error|debug","text":"..."}
      {"type":"result","ok":true|false,"data":{...}}
    Secrets reach the engine only through environment variables named TEMPDESK_SECRET_<NAME>.
    Get-TdSecret reads one and removes it from the process environment. Every secret read is
    registered so Write-TdLog can redact it if it ever appears in a log line.
#>
Set-StrictMode -Version 3

$script:Secrets = New-Object System.Collections.Generic.List[string]
$script:StateFile = $null
$script:State = $null
$script:Quiet = $false

function ConvertTo-TdJsonString {
    <# Escapes a string the way JSON.stringify does (quotes included). #>
    param([AllowNull()][AllowEmptyString()][string] $Value)
    if ($null -eq $Value) { return 'null' }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        $c = [int]$ch
        switch ($c) {
            0x22 { [void]$sb.Append('\"'); continue }
            0x5C { [void]$sb.Append('\\'); continue }
            0x08 { [void]$sb.Append('\b'); continue }
            0x0C { [void]$sb.Append('\f'); continue }
            0x0A { [void]$sb.Append('\n'); continue }
            0x0D { [void]$sb.Append('\r'); continue }
            0x09 { [void]$sb.Append('\t'); continue }
            default {
                if ($c -lt 0x20) { [void]$sb.Append(('\u{0:x4}' -f $c)) }
                else { [void]$sb.Append($ch) }
            }
        }
    }
    [void]$sb.Append('"')
    $sb.ToString()
}

function ConvertTo-TdJson {
    <#
    .SYNOPSIS
        Serializes hashtables, ordered dictionaries, arrays, strings, numbers, booleans and $null
        exactly like JavaScript JSON.stringify(value, null, Indent) (Indent 0 = compact).
    #>
    param([AllowNull()] $Value, [int] $Indent = 2, [int] $Level = 0)
    $nl = if ($Indent -gt 0) { "`n" } else { '' }
    $pad = ' ' * ($Indent * ($Level + 1))
    $padEnd = ' ' * ($Indent * $Level)
    $colon = if ($Indent -gt 0) { ': ' } else { ':' }
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
    if ($Value -is [string] -or $Value -is [char]) { return (ConvertTo-TdJsonString ([string]$Value)) }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or $Value -is [single] -or $Value -is [int16] -or $Value -is [byte]) {
        return ([System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture))
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $keys = @($Value.Keys)
        if ($keys.Count -eq 0) { return '{}' }
        $parts = foreach ($k in $keys) { $pad + (ConvertTo-TdJsonString ([string]$k)) + $colon + (ConvertTo-TdJson $Value[$k] $Indent ($Level + 1)) }
        $sep = if ($Indent -gt 0) { ",`n" } else { ',' }
        return '{' + $nl + ($parts -join $sep) + $nl + $padEnd + '}'
    }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $h = [ordered]@{}
        foreach ($p in $Value.PSObject.Properties) { $h[$p.Name] = $p.Value }
        return (ConvertTo-TdJson $h $Indent $Level)
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $items = @($Value)
        if ($items.Count -eq 0) { return '[]' }
        $parts = foreach ($i in $items) { $pad + (ConvertTo-TdJson $i $Indent ($Level + 1)) }
        $sep = if ($Indent -gt 0) { ",`n" } else { ',' }
        return '[' + $nl + ($parts -join $sep) + $nl + $padEnd + ']'
    }
    return (ConvertTo-TdJsonString ([string]$Value))
}

function Protect-TdText {
    <# Replaces every registered secret in the text with [redacted]. #>
    param([AllowEmptyString()][string] $Text)
    if (-not $Text) { return $Text }
    foreach ($s in $script:Secrets) {
        if ($s -and $s.Length -ge 3) { $Text = $Text.Replace($s, '[redacted]') }
    }
    $Text
}

function Register-TdSecret {
    param([AllowEmptyString()][string] $Value)
    if ($Value) { $script:Secrets.Add($Value) }
}

function Get-TdSecret {
    <#
    .SYNOPSIS
        Reads TEMPDESK_SECRET_<Name> from the environment, removes it, and returns a SecureString.
        Returns $null when it is not set. -AsPlainText returns the string (only for building files
        that Windows Setup itself needs, such as firstboot.json on the install media).
    #>
    param([Parameter(Mandatory)][string] $Name, [switch] $AsPlainText, [switch] $Required)
    $var = 'TEMPDESK_SECRET_' + $Name.ToUpperInvariant()
    $v = [Environment]::GetEnvironmentVariable($var)
    if ($null -ne $v) { [Environment]::SetEnvironmentVariable($var, $null) }
    if (-not $v) {
        if ($Required) { throw "The secret $Name was not provided. The desktop app passes it through the environment variable $var." }
        return $null
    }
    Register-TdSecret $v
    if ($AsPlainText) { return $v }
    $ss = New-Object System.Security.SecureString
    foreach ($ch in $v.ToCharArray()) { $ss.AppendChar($ch) }
    $ss.MakeReadOnly()
    $ss
}

function ConvertFrom-TdSecureString {
    param([Parameter(Mandatory)][System.Security.SecureString] $Secure)
    $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}

function Write-TdEvent {
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Event)
    if ($script:Quiet) { return }
    [Console]::Out.WriteLine((ConvertTo-TdJson $Event 0))
    [Console]::Out.Flush()
}

function Write-TdLog {
    param([AllowEmptyString()][string] $Text, [ValidateSet('info', 'warn', 'error', 'debug')][string] $Level = 'info')
    Write-TdEvent ([ordered]@{ type = 'log'; level = $Level; text = (Protect-TdText $Text) })
}

function Write-TdStep {
    param(
        [Parameter(Mandatory)][string] $Id,
        [Parameter(Mandatory)][ValidateSet('pending', 'running', 'done', 'failed', 'skipped')][string] $State,
        [string] $Title, [string] $Hint, [int] $Percent = -1
    )
    $e = [ordered]@{ type = 'step'; id = $Id; state = $State }
    if ($Title) { $e.title = $Title }
    if ($Hint) { $e.hint = (Protect-TdText $Hint) }
    if ($Percent -ge 0) { $e.percent = $Percent }
    Write-TdEvent $e
}

function Write-TdResult {
    param([bool] $Ok, [System.Collections.IDictionary] $Data = @{})
    Write-TdEvent ([ordered]@{ type = 'result'; ok = $Ok; data = $Data })
}

function Set-TdQuiet { param([bool] $Quiet) $script:Quiet = $Quiet }

# ------------------------------------------------------------------------------------------
# Resumable steps
# ------------------------------------------------------------------------------------------
function Initialize-TdState {
    param([Parameter(Mandatory)][string] $Path, [switch] $Reset)
    $script:StateFile = $Path
    $script:State = @{ done = @() }
    if (-not $Reset -and (Test-Path -LiteralPath $Path)) {
        try { $script:State = @{ done = @((Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json).done) } } catch { $script:State = @{ done = @() } }
    }
}

function Save-TdState {
    if (-not $script:StateFile) { return }
    $dir = Split-Path -Parent $script:StateFile
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Set-Content -LiteralPath $script:StateFile -Value (ConvertTo-TdJson ([ordered]@{ done = @($script:State.done) })) -Encoding UTF8
}

function Get-TdCompletedSteps { if ($script:State) { @($script:State.done) } else { @() } }

function Invoke-TdStep {
    <#
    .SYNOPSIS
        Runs one named step with progress events. Steps already recorded as done are skipped
        unless -Always. On failure the step is reported failed with the recovery hint and the
        exception is rethrown so the phase stops (the app offers "resume from failed step").
    #>
    param(
        [Parameter(Mandatory)][string] $Id,
        [Parameter(Mandatory)][string] $Title,
        [Parameter(Mandatory)][scriptblock] $Action,
        [string] $Hint = '',
        [switch] $Always
    )
    if (-not $Always -and $script:State -and ($script:State.done -contains $Id)) {
        Write-TdStep -Id $Id -State skipped -Title $Title
        return
    }
    Write-TdStep -Id $Id -State running -Title $Title
    try {
        & $Action
        if ($script:State) {
            if ($script:State.done -notcontains $Id) { $script:State.done = @($script:State.done) + $Id }
            Save-TdState
        }
        Write-TdStep -Id $Id -State done -Title $Title
    }
    catch {
        Write-TdLog -Level error -Text ("{0}: {1}" -f $Title, $_.Exception.Message)
        Write-TdStep -Id $Id -State failed -Title $Title -Hint $Hint
        throw
    }
}

# ------------------------------------------------------------------------------------------
# Files
# ------------------------------------------------------------------------------------------
function Get-TdDataRoot {
    $base = [Environment]::GetFolderPath('LocalApplicationData')
    if (-not $base) { $base = Join-Path ([IO.Path]::GetTempPath()) 'tempdesk-local' }
    Join-Path $base 'TempDesk'
}

function Test-TdSafeName {
    param([string] $Name)
    return [bool]($Name -match '^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$') -and ($Name -notmatch '\.\.')
}

function New-TdProtectedDirectory {
    <#
    .SYNOPSIS
        Creates a folder readable only by the current user (inheritance removed) on Windows.
        On other platforms (tests) it sets mode 700.
    #>
    param([Parameter(Mandatory)][string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
        $acl = New-Object System.Security.AccessControl.DirectorySecurity
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
        $acl.SetOwner($sid)
        Set-Acl -LiteralPath $Path -AclObject $acl
    }
    elseif (Get-Command chmod -ErrorAction SilentlyContinue) {
        & chmod 700 $Path
    }
    (Resolve-Path -LiteralPath $Path).ProviderPath
}

function Get-TdDeploymentDirectory {
    param([Parameter(Mandatory)][string] $Name, [string] $Root = (Get-TdDataRoot))
    if (-not (Test-TdSafeName $Name)) { throw "Deployment name '$Name' may use letters, numbers, dot, dash, underscore and space (1 to 64)." }
    New-TdProtectedDirectory -Path (Join-Path (Join-Path $Root 'deployments') $Name)
}

function Write-TdUtf8File {
    <# Writes text as UTF-8 without BOM, with LF or CRLF line endings preserved as given. #>
    param([Parameter(Mandatory)][string] $Path, [Parameter(Mandatory)][AllowEmptyString()][string] $Text)
    $dir = Split-Path -Parent $Path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

# ------------------------------------------------------------------------------------------
# Env files for the portals and streaming
# ------------------------------------------------------------------------------------------
function ConvertTo-TdEnvFile {
    <#
    .SYNOPSIS
        Renders an ordered dictionary as a docker compose .env file. Values with spaces, quotes,
        # or $ are double-quoted with escaping; newlines are rejected.
    #>
    param([Parameter(Mandatory)][System.Collections.IDictionary] $Values, [string[]] $Comment = @())
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($c in $Comment) { $lines.Add('# ' + $c) }
    foreach ($k in $Values.Keys) {
        if ($k -notmatch '^[A-Z_][A-Z0-9_]*$') { throw "Invalid env key '$k'." }
        $v = [string]$Values[$k]
        if ($v -match "[\r\n]") { throw "The value of $k contains a line break." }
        if ($v -match '[\s"''#$\\`]') { $v = '"' + ($v -replace '\\', '\\' -replace '"', '\"' -replace '\$', '\$') + '"' }
        $lines.Add("$k=$v")
    }
    ($lines -join "`n") + "`n"
}

function New-TdRandomHex {
    param([int] $Bytes = 16)
    $b = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    -join ($b | ForEach-Object { $_.ToString('x2') })
}

function New-TdRandomToken {
    param([int] $Bytes = 36)
    $b = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function New-TdPortalEnv {
    <#
    .SYNOPSIS
        Builds the three env files for a deployment from agent.json values.
        Returns @{ guest = text; admin = text; streaming = text }.
    .PARAMETER Agent
        Object with guestKey, adminKey, and optionally tls, port.
    .PARAMETER AgentHost
        Address the portals use to reach the agent.
    .PARAMETER CertSha256
        Pin for an HTTPS agent (64 hex), required when the agent uses TLS.
    #>
    param(
        [Parameter(Mandatory)] $Agent,
        [Parameter(Mandatory)][string] $AgentHost,
        [string] $CertSha256 = '',
        [string] $StreamingHost = '',
        [string] $GuacSecret = '',
        [string] $SessionSecret = ''
    )
    $tls = $false
    if ($Agent.PSObject.Properties['tls'] -or ($Agent -is [System.Collections.IDictionary] -and $Agent.Contains('tls'))) { $tls = [bool]$Agent.tls }
    $port = if ($tls) { 8443 } else { 8080 }
    $hasPort = ($Agent -is [System.Collections.IDictionary] -and $Agent.Contains('port')) -or ($Agent -isnot [System.Collections.IDictionary] -and $Agent.PSObject.Properties['port'])
    if ($hasPort -and [int]$Agent.port -gt 0) { $port = [int]$Agent.port }
    if (-not $Agent.guestKey -or -not $Agent.adminKey) { throw 'agent.json does not contain guestKey and adminKey.' }
    $scheme = if ($tls) { 'https' } else { 'http' }
    $url = '{0}://{1}:{2}/api/v1' -f $scheme, $AgentHost, $port
    if ($tls -and $CertSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'The agent uses HTTPS: the certificate SHA-256 pin is required.' }
    if (-not $GuacSecret) { $GuacSecret = New-TdRandomHex 16 }
    if (-not $SessionSecret) { $SessionSecret = New-TdRandomToken 36 }
    if (-not $StreamingHost) { $StreamingHost = $AgentHost }
    $common = [ordered]@{ AGENT_URL = $url }
    if ($tls) { $common.AGENT_CERT_SHA256 = $CertSha256.ToLowerInvariant() }
    $guest = [ordered]@{ PORTAL_MODE = 'guest' }
    foreach ($k in $common.Keys) { $guest[$k] = $common[$k] }
    $guest.AGENT_KEY = [string]$Agent.guestKey
    $guest.PORT = '8080'
    $admin = [ordered]@{ PORTAL_MODE = 'admin' }
    foreach ($k in $common.Keys) { $admin[$k] = $common[$k] }
    $admin.AGENT_KEY = [string]$Agent.adminKey
    $admin.SESSION_SECRET = $SessionSecret
    $admin.PORT = '8081'
    $admin.GUAC_URL = "http://${StreamingHost}:8090/"
    $admin.GUAC_JSON_SECRET_KEY = $GuacSecret
    $stream = [ordered]@{ JSON_SECRET_KEY = $GuacSecret; GUAC_PORT = '8090'; GUAC_BIND = '0.0.0.0'; REMOTE_IP_VALVE_ENABLED = 'false'; GUACD_LOG_LEVEL = 'info' }
    $note = @('Generated by TempDesk Deployer. Contains agent keys: keep private, never commit.')
    @{
        guest     = ConvertTo-TdEnvFile -Values $guest -Comment $note
        admin     = ConvertTo-TdEnvFile -Values $admin -Comment $note
        streaming = ConvertTo-TdEnvFile -Values $stream -Comment $note
    }
}

function Save-TdPortalEnv {
    param([Parameter(Mandatory)][hashtable] $Env, [Parameter(Mandatory)][string] $Directory)
    Write-TdUtf8File -Path (Join-Path $Directory 'portal\.env.guest') -Text $Env.guest
    Write-TdUtf8File -Path (Join-Path $Directory 'portal\.env.admin') -Text $Env.admin
    Write-TdUtf8File -Path (Join-Path $Directory 'streaming\.env') -Text $Env.streaming
}

Export-ModuleMember -Function *-Td*
