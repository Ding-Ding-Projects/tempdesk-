<#
.SYNOPSIS
    TempDesk Lite deployment over SSH with the in-box OpenSSH client (ssh.exe / scp.exe).

.DESCRIPTION
    Key authentication is recommended: New-TdSshKey creates an ed25519 key for the desktop app
    and returns the public key for the Linux host's ~/.ssh/authorized_keys. Password sign-in is
    supported by the desktop app opening a visible console for the first connection; this
    module always runs ssh with BatchMode=yes so it never waits for a hidden prompt.

    The Samba administrator password never appears on a command line: it is written to the
    remote secrets/admin_password through ssh's standard input with umask 077 and chmod 600.
#>
Set-StrictMode -Version 3

function Get-TdSshTool {
    param([ValidateSet('ssh', 'scp', 'ssh-keygen')][string] $Name = 'ssh')
    $exe = if ($IsWindows -or $env:OS -eq 'Windows_NT') { "$Name.exe" } else { $Name }
    $inbox = Join-Path $env:SystemRoot "System32\OpenSSH\$exe"
    if ($env:SystemRoot -and (Test-Path -LiteralPath $inbox)) { return $inbox }
    $cmd = Get-Command $exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "OpenSSH client ($exe) not found. Install it in Settings > System > Optional features > OpenSSH Client."
}

function Test-TdSshTarget {
    param([string] $User, [string] $HostName, [int] $Port = 22)
    ($User -match '^[a-z_][a-z0-9_.-]{0,31}$') -and ($HostName -match '^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})$') -and $Port -ge 1 -and $Port -le 65535
}

function Get-TdSshArgs {
    <# Common ssh/scp options. Never includes passwords. #>
    param([Parameter(Mandatory)] $Ssh, [switch] $Scp)
    $a = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=20')
    $a += @('-o', ('StrictHostKeyChecking={0}' -f $(if ($Ssh.PSObject.Properties['acceptNewHostKey'] -and $Ssh.acceptNewHostKey) { 'accept-new' } else { 'yes' })))
    if ($Ssh.PSObject.Properties['identityFile'] -and $Ssh.identityFile) { $a += @('-i', [string]$Ssh.identityFile, '-o', 'IdentitiesOnly=yes') }
    $port = if ($Ssh.PSObject.Properties['port'] -and $Ssh.port) { [int]$Ssh.port } else { 22 }
    if ($Scp) { $a += @('-P', [string]$port) } else { $a += @('-p', [string]$port) }
    $a
}

function ConvertTo-TdShellQuote {
    <# POSIX single-quote quoting for remote command arguments. #>
    param([AllowEmptyString()][string] $Value)
    "'" + $Value.Replace("'", "'\''") + "'"
}

function Invoke-TdSsh {
    <#
    .SYNOPSIS
        Runs one remote command. -InputText is sent on stdin (used for secrets). Output lines are
        logged (secrets redacted) and returned.
    #>
    param([Parameter(Mandatory)] $Ssh, [Parameter(Mandatory)][string] $Command, [string] $InputText, [switch] $Quiet, [switch] $AllowFailure)
    $exe = Get-TdSshTool ssh
    $target = '{0}@{1}' -f $Ssh.user, $Ssh.host
    $args = @(Get-TdSshArgs $Ssh) + @($target, $Command)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    foreach ($x in $args) { [void]$psi.ArgumentList.Add($x) }
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    if ($InputText) { $p.StandardInput.Write($InputText) }
    $p.StandardInput.Close()
    $errTask = $p.StandardError.ReadToEndAsync()
    $lines = New-Object System.Collections.Generic.List[string]
    while ($null -ne ($l = $p.StandardOutput.ReadLine())) { $lines.Add($l); if (-not $Quiet) { Write-TdLog $l } }
    $p.WaitForExit()
    $err = $errTask.Result
    if ($err -and -not $Quiet) { foreach ($e in ($err -split "`r?`n" | Where-Object { $_ })) { Write-TdLog -Level warn -Text $e } }
    if ($p.ExitCode -ne 0 -and -not $AllowFailure) {
        $msg = "Remote command failed (exit $($p.ExitCode))."
        if ($err -match 'Permission denied') { $msg += ' The host refused the key: add the public key to ~/.ssh/authorized_keys, or run the first connection with a password.' }
        elseif ($err -match 'Host key verification failed') { $msg += ' The host key is unknown or changed. Run the first connection in the console window to confirm it.' }
        throw $msg
    }
    [pscustomobject]@{ ExitCode = $p.ExitCode; Output = $lines.ToArray(); Error = $err }
}

function Copy-TdToRemote {
    param([Parameter(Mandatory)] $Ssh, [Parameter(Mandatory)][string[]] $LocalPath, [Parameter(Mandatory)][string] $RemoteDir)
    $exe = Get-TdSshTool scp
    $args = @(Get-TdSshArgs $Ssh -Scp) + @('-r', '-q') + $LocalPath + @(('{0}@{1}:{2}' -f $Ssh.user, $Ssh.host, $RemoteDir))
    & $exe @args
    if ($LASTEXITCODE -ne 0) { throw "scp failed with exit code $LASTEXITCODE." }
}

function New-TdSshKey {
    <# Creates an ed25519 key (no passphrase) in the protected folder; returns the public key text. #>
    param([Parameter(Mandatory)][string] $Directory, [string] $Comment = 'tempdesk-deployer')
    $key = Join-Path $Directory 'id_ed25519'
    if (-not (Test-Path -LiteralPath $key)) {
        $exe = Get-TdSshTool ssh-keygen
        & $exe -q -t ed25519 -N '""' -C $Comment -f $key | Out-Null
        if (-not (Test-Path -LiteralPath $key)) { & $exe -q -t ed25519 -N '' -C $Comment -f $key | Out-Null }
        if (-not (Test-Path -LiteralPath $key)) { throw 'ssh-keygen did not create the key.' }
    }
    (Get-Content -LiteralPath "$key.pub" -Raw).Trim()
}

function New-TdSambaEnv {
    <# samba/.env for TempDesk Lite from the form. Validates every value. #>
    param([Parameter(Mandatory)] $Lite)
    $ip = '^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$'
    $realm = ([string]$Lite.realm).ToUpperInvariant()
    $fqdn = ([string]$Lite.realm).ToLowerInvariant()
    if ($fqdn -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { throw 'Realm must be a DNS name such as lab.example.org.' }
    $nb = ([string]$Lite.netbios).ToUpperInvariant()
    if ($nb -notmatch '^[A-Z0-9-]{1,15}$') { throw 'NetBIOS name: 1 to 15 letters, numbers or hyphens.' }
    foreach ($k in @('dcIp', 'gateway')) { if ([string]$Lite.$k -notmatch $ip) { throw "$k must be an IPv4 address." } }
    if ([string]$Lite.subnet -notmatch '^(\d{1,3}\.){3}\d{1,3}/\d{1,2}$') { throw 'Subnet must look like 192.168.1.0/24.' }
    if ([string]$Lite.parentInterface -notmatch '^[A-Za-z0-9_.:-]{1,15}$') { throw 'Parent interface must be a Linux interface name such as eth0.' }
    $fwd = if ($Lite.PSObject.Properties['dnsForwarder'] -and $Lite.dnsForwarder) { [string]$Lite.dnsForwarder } else { '1.1.1.1' }
    if ($fwd -notmatch $ip) { throw 'DNS forwarder must be an IPv4 address.' }
    $dcName = if ($Lite.PSObject.Properties['dcHostname'] -and $Lite.dcHostname) { [string]$Lite.dcHostname } else { 'dc1' }
    if ($dcName -notmatch '^[A-Za-z0-9-]{1,15}$') { throw 'DC host name: 1 to 15 letters, numbers or hyphens.' }
    $values = [ordered]@{
        REALM = $realm; DOMAIN_FQDN = $fqdn; NETBIOS = $nb; DC_HOSTNAME = $dcName; DC_IP = [string]$Lite.dcIp
        LAN_PARENT_IF = [string]$Lite.parentInterface; LAN_SUBNET = [string]$Lite.subnet; LAN_GATEWAY = [string]$Lite.gateway
        LAN_IP_RANGE = ('{0}/32' -f $Lite.dcIp); DNS_FORWARDER = $fwd; INITIAL_ADMIN = 'Administrator'
    }
    ConvertTo-TdEnvFile -Values $values -Comment @('Generated by TempDesk Deployer. The Administrator password is in secrets/admin_password, not here.')
}

function Invoke-TdLiteDeploy {
    param([Parameter(Mandatory)] $Config, [Parameter(Mandatory)][System.Security.SecureString] $AdminPassword, [Parameter(Mandatory)][string] $PayloadRoot, [string] $Directory)
    $ssh = $Config.ssh
    if (-not (Test-TdSshTarget -User $ssh.user -HostName $ssh.host -Port $(if ($ssh.PSObject.Properties['port'] -and $ssh.port) { [int]$ssh.port } else { 22 }))) { throw 'SSH user or host is not valid.' }
    $remote = if ($ssh.PSObject.Properties['remoteDir'] -and $ssh.remoteDir) { [string]$ssh.remoteDir } else { 'tempdesk' }
    if ($remote -notmatch '^[A-Za-z0-9_./~-]{1,128}$' -or $remote -match '\.\.') { throw 'Remote folder may use letters, numbers and . _ / ~ - only.' }
    $q = ConvertTo-TdShellQuote $remote
    Invoke-TdStep -Id 'connect' -Title 'Connect over SSH' -Always -Hint 'Paste the public key into ~/.ssh/authorized_keys on the host, or use "First connection in a console" to confirm the host key.' -Action {
        Invoke-TdSsh -Ssh $ssh -Command 'uname -a' | Out-Null
    }
    Invoke-TdStep -Id 'docker' -Title 'Check Docker and Docker Compose' -Always -Hint 'Install Docker Engine and the compose plugin, and add this user to the docker group (then sign in again).' -Action {
        Invoke-TdSsh -Ssh $ssh -Command 'docker version --format "Docker {{.Server.Version}}" && docker compose version' | Out-Null
    }
    Invoke-TdStep -Id 'upload' -Title 'Upload TempDesk files' -Hint 'Check free disk space and write access to the remote folder.' -Action {
        Invoke-TdSsh -Ssh $ssh -Command ("mkdir -p $q") | Out-Null
        $paths = @('samba', 'client', 'portal', 'streaming') | ForEach-Object { Join-Path $PayloadRoot $_ }
        foreach ($p in $paths) { if (-not (Test-Path -LiteralPath $p)) { throw "Payload folder missing: $p" } }
        Copy-TdToRemote -Ssh $ssh -LocalPath $paths -RemoteDir $remote
    }
    Invoke-TdStep -Id 'config' -Title 'Write domain settings and the password secret' -Always -Action {
        $envText = New-TdSambaEnv -Lite $Config.lite
        Invoke-TdSsh -Ssh $ssh -Command ("cat > $q/samba/.env") -InputText $envText -Quiet | Out-Null
        $pw = ConvertFrom-TdSecureString $AdminPassword
        Register-TdSecret $pw
        Invoke-TdSsh -Ssh $ssh -Command ("umask 077 && mkdir -p $q/samba/secrets && cat > $q/samba/secrets/admin_password && chmod 600 $q/samba/secrets/admin_password") -InputText ($pw + "`n") -Quiet | Out-Null
        $pw = $null
    }
    Invoke-TdStep -Id 'up' -Title 'Build and start the domain controller' -Hint 'Run "docker compose logs dc" in the samba folder on the host.' -Action {
        Invoke-TdSsh -Ssh $ssh -Command ("cd $q/samba && docker compose up -d --build 2>&1") | Out-Null
    }
    Invoke-TdStep -Id 'health' -Title 'Wait until the domain controller is healthy' -Hint 'The first start provisions the domain and can take several minutes. Check "docker compose ps" on the host.' -Action {
        $deadline = (Get-Date).AddMinutes(20)
        while ($true) {
            $r = Invoke-TdSsh -Ssh $ssh -Command ("cd $q/samba && docker inspect --format '{{.State.Health.Status}}' `$(docker compose ps -q dc)") -Quiet -AllowFailure
            $st = ($r.Output -join '').Trim()
            Write-TdLog "Container health: $st"
            if ($st -eq 'healthy') { break }
            if ((Get-Date) -gt $deadline) { throw "The domain controller container is '$st' after 20 minutes." }
            Start-Sleep -Seconds 15
        }
    }
    Invoke-TdStep -Id 'keys' -Title 'Fetch agent keys' -Always -Action {
        $r = Invoke-TdSsh -Ssh $ssh -Command ("cd $q/samba && docker compose exec -T dc cat /var/lib/tempdesk/agent.json") -Quiet
        $script:Agent = Save-TdAgentJson -Raw ($r.Output -join "`n") -Directory $Directory
    }
    Invoke-TdStep -Id 'envs' -Title 'Write portal settings' -Always -Action {
        $envs = New-TdPortalEnv -Agent $script:Agent -AgentHost ([string]$Config.lite.dcIp) -StreamingHost ([string]$ssh.host)
        Save-TdPortalEnv -Env $envs -Directory $Directory
    }
}

Export-ModuleMember -Function Get-TdSshTool, Test-TdSshTarget, Get-TdSshArgs, ConvertTo-TdShellQuote, Invoke-TdSsh, Copy-TdToRemote, New-TdSshKey, New-TdSambaEnv, Invoke-TdLiteDeploy
