<#
.SYNOPSIS
    TempDesk server deployment over WinRM HTTP (5985): monitor the unattended chain, or deploy to
    an existing Windows Server step by step (Advanced).

.DESCRIPTION
    Owner choice: plain HTTP WinRM. Windows still encrypts the remoting payload at the message
    level with Negotiate (NTLM/Kerberos) session keys. Adding the server to WSMan TrustedHosts
    needs elevation: the desktop app runs Set-TdTrustedHost in a separate helper started with the
    normal Windows consent prompt (Verb RunAs). If the prompt is cancelled the phase reports
    "incomplete" and stops. This module never bypasses or auto-approves elevation.
#>
Set-StrictMode -Version 3

$script:StageOrder = @('copy', 'network', 'forest', 'adws', 'domain', 'agent', 'portals', 'ready')

function Test-TdIPv4 { param([string] $Address) [bool]($Address -match '^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$') }

function Get-TdTrustedHostList {
    <# Splits a TrustedHosts value into entries. #>
    param([AllowEmptyString()][string] $Value)
    @(([string]$Value) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

function Get-TdTrustedHostValue {
    <# Returns the new TrustedHosts value with Address appended, or $null when already covered. #>
    param([AllowEmptyString()][string] $Current, [Parameter(Mandatory)][string] $Address)
    $list = Get-TdTrustedHostList $Current
    if ($list -contains '*' -or $list -contains $Address) { return $null }
    (@($list) + $Address) -join ','
}

function Test-TdTrustedHost {
    param([Parameter(Mandatory)][string] $Address)
    try { $cur = (Get-Item WSMan:\localhost\Client\TrustedHosts -ErrorAction Stop).Value } catch { return $false }
    $null -eq (Get-TdTrustedHostValue -Current $cur -Address $Address)
}

function Set-TdTrustedHost {
    <# Must run elevated (the helper process). Appends the address without replacing other entries. #>
    param([Parameter(Mandatory)][string] $Address)
    if (-not (Test-TdIPv4 $Address) -and $Address -notmatch '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$') { throw "Not a host name or IPv4 address: $Address" }
    $cur = (Get-Item WSMan:\localhost\Client\TrustedHosts).Value
    $new = Get-TdTrustedHostValue -Current $cur -Address $Address
    if ($null -ne $new) { Set-Item WSMan:\localhost\Client\TrustedHosts -Value $new -Force }
}

function ConvertTo-TdStageView {
    <#
    .SYNOPSIS
        Maps setup-status.json (written by server/firstboot/SetupStatus.ps1) to step states for the
        progress UI: @{ <stage> = pending|running|done|failed }, plus Ready and Failed flags.
    #>
    param([Parameter(Mandatory)] $Status, [bool] $NativePortals = $false)
    $order = @($script:StageOrder | Where-Object { $NativePortals -or $_ -ne 'portals' })
    $view = [ordered]@{}
    foreach ($s in $order) { $view[$s] = 'pending' }
    $seen = @()
    foreach ($h in @($(if ($Status.PSObject.Properties['history']) { $Status.history } else { @() }))) { if ($h -and $h.PSObject.Properties['stage'] -and $h.stage) { $seen += [string]$h.stage } }
    $prop = { param($n) if ($Status.PSObject.Properties[$n]) { [string]$Status.$n } else { '' } }
    $current = & $prop 'stage'
    $state = & $prop 'state'
    $idx = [Array]::IndexOf($order, $current)
    if ($state -eq 'ready') { foreach ($s in $order) { $view[$s] = 'done' } }
    else {
        foreach ($s in $order) { if ($seen -contains $s -and $s -ne $current) { $view[$s] = 'done' } }
        if ($idx -ge 0) {
            for ($i = 0; $i -lt $idx; $i++) { $view[$order[$i]] = 'done' }
            $view[$current] = if ($state -eq 'failed') { 'failed' } else { 'running' }
        } elseif ($state -eq 'failed') {
            # 'firstlogon' or 'continue' failures: mark the first not-done stage as failed.
            foreach ($s in $order) { if ($view[$s] -ne 'done') { $view[$s] = 'failed'; break } }
        }
    }
    [pscustomobject]@{ Stages = $view; Ready = ($state -eq 'ready'); Failed = ($state -eq 'failed'); Message = (& $prop 'message'); Updated = (& $prop 'updated') }
}

function New-TdCredential {
    param([Parameter(Mandatory)][string] $UserName, [Parameter(Mandatory)][System.Security.SecureString] $Password)
    New-Object System.Management.Automation.PSCredential($UserName, $Password)
}

function Wait-TdWinRM {
    param([Parameter(Mandatory)][string] $Address, [int] $TimeoutMinutes = 90, [scriptblock] $OnWait)
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    while ((Get-Date) -lt $deadline) {
        try { Test-WSMan -ComputerName $Address -ErrorAction Stop | Out-Null; return $true } catch { if ($OnWait) { & $OnWait } ; Start-Sleep -Seconds 10 }
    }
    throw "The server $Address did not answer on WinRM (TCP 5985) within $TimeoutMinutes minutes."
}

function Get-TdRemoteStatus {
    param([Parameter(Mandatory)][string] $Address, [Parameter(Mandatory)][pscredential] $Credential)
    $raw = Invoke-Command -ComputerName $Address -Credential $Credential -Authentication Negotiate -ErrorAction Stop -ScriptBlock {
        $p = 'C:\ProgramData\TempDesk\setup-status.json'
        if (Test-Path -LiteralPath $p) { Get-Content -LiteralPath $p -Raw } else { '' }
    }
    if (-not $raw) { return $null }
    $raw | ConvertFrom-Json
}

function Get-TdRemoteAgentJson {
    param([Parameter(Mandatory)][string] $Address, [Parameter(Mandatory)][pscredential] $Credential)
    $raw = Invoke-Command -ComputerName $Address -Credential $Credential -Authentication Negotiate -ErrorAction Stop -ScriptBlock {
        Get-Content -LiteralPath 'C:\ProgramData\TempDesk\agent.json' -Raw
    }
    $raw
}

function Save-TdAgentJson {
    <# Stores agent.json in the protected deployment folder and returns the parsed object. #>
    param([Parameter(Mandatory)][string] $Raw, [Parameter(Mandatory)][string] $Directory)
    $obj = $Raw | ConvertFrom-Json
    if (-not $obj.guestKey -or -not $obj.adminKey) { throw 'agent.json from the server has no guestKey/adminKey.' }
    Register-TdSecret ([string]$obj.guestKey); Register-TdSecret ([string]$obj.adminKey)
    if ($obj.PSObject.Properties['hmacSecret']) { Register-TdSecret ([string]$obj.hmacSecret) }
    Write-TdUtf8File -Path (Join-Path $Directory 'agent.json') -Text $Raw
    $obj
}

function Invoke-TdServerMonitor {
    <#
    .SYNOPSIS
        Watches the fully unattended install: waits for WinRM, polls setup-status.json and emits a
        step event per stage, then fetches agent.json and writes the portal env files.
    #>
    param([Parameter(Mandatory)] $Config, [Parameter(Mandatory)][System.Security.SecureString] $AdminPassword, [string] $Directory, [int] $PollSeconds = 10, [int] $TimeoutMinutes = 180)
    $addr = [string]$Config.server.ipAddress
    $native = ([string]$Config.server.portalsMode) -eq 'native'
    $cred = New-TdCredential -UserName ("{0}\Administrator" -f $addr) -Password $AdminPassword
    Invoke-TdStep -Id 'trust' -Title 'Trust the server for remoting' -Always -Hint 'Approve the Windows prompt, or run "Set-Item WSMan:\localhost\Client\TrustedHosts -Concatenate -Value <ip>" in an elevated PowerShell.' -Action {
        if (-not (Test-TdTrustedHost $addr)) { throw "The server is not in WSMan TrustedHosts yet. The desktop app asks for approval to add $addr; the step stays incomplete until it is approved." }
    }
    Invoke-TdStep -Id 'reach' -Title 'Wait for the server to answer' -Always -Hint 'Check the server is powered on, has the IP address from the answer file and that this PC can reach TCP 5985.' -Action {
        Wait-TdWinRM -Address $addr -TimeoutMinutes 90 -OnWait { Write-TdLog 'Waiting for WinRM on the server (Windows Setup may still be running)' } | Out-Null
    }
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $last = ''
    $lastStages = @{}
    while ($true) {
        if ((Get-Date) -gt $deadline) { throw "Setup did not report ready within $TimeoutMinutes minutes." }
        $status = $null
        try { $status = Get-TdRemoteStatus -Address $addr -Credential $cred }
        catch {
            # Reboots and the domain sign-in switch make remoting fail for a while; that is expected.
            Write-TdLog -Level debug -Text ('Status not readable yet: ' + $_.Exception.Message)
            if ($_.Exception.Message -match 'Access is denied|logon failure|user name or password') {
                # After promotion the local Administrator becomes the domain Administrator.
                $cred = New-TdCredential -UserName ("{0}\Administrator" -f $Config.server.netbiosName) -Password $AdminPassword
            }
        }
        if ($status) {
            $view = ConvertTo-TdStageView -Status $status -NativePortals $native
            foreach ($k in $view.Stages.Keys) {
                if ($lastStages[$k] -ne $view.Stages[$k]) { Write-TdStep -Id ('stage-' + $k) -State $view.Stages[$k]; $lastStages[$k] = $view.Stages[$k] }
            }
            if ($view.Message -and $view.Message -ne $last) { Write-TdLog $view.Message; $last = $view.Message }
            if ($view.Failed) { Write-TdStep -Id 'monitor' -State failed -Hint 'See C:\ProgramData\TempDesk\logs on the server. Fix the cause, then restart the server: the setup task continues from where it stopped.'; throw ('Server setup failed: ' + $view.Message) }
            if ($view.Ready) { break }
        }
        Start-Sleep -Seconds $PollSeconds
    }
    Invoke-TdStep -Id 'keys' -Title 'Fetch agent keys' -Always -Hint 'Make sure the TempDesk Agent service is installed (C:\ProgramData\TempDesk\agent.json exists on the server).' -Action {
        $raw = Get-TdRemoteAgentJson -Address $addr -Credential $cred
        $script:Agent = Save-TdAgentJson -Raw $raw -Directory $Directory
    }
    Invoke-TdStep -Id 'envs' -Title 'Write portal settings' -Always -Action {
        $envs = New-TdPortalEnv -Agent $script:Agent -AgentHost $addr
        Save-TdPortalEnv -Env $envs -Directory $Directory
    }
}

function Invoke-TdServerAdvanced {
    <#
    .SYNOPSIS
        Advanced: deploy to an existing Windows Server (not installed from TempDesk media).
        Copies the payload, creates the forest, waits across the reboot, runs Initialize-TempDesk,
        installs the agent and writes the portal env files. Resumable per step.
    #>
    param([Parameter(Mandatory)] $Config, [Parameter(Mandatory)][System.Security.SecureString] $AdminPassword, [Parameter(Mandatory)][System.Security.SecureString] $DsrmPassword, [Parameter(Mandatory)][string] $PayloadRoot, [string] $Directory)
    $s = $Config.server
    $addr = [string]$s.ipAddress
    $cred = New-TdCredential -UserName ([string]$(if ($s.PSObject.Properties['adminUser'] -and $s.adminUser) { $s.adminUser } else { "$addr\Administrator" })) -Password $AdminPassword
    Invoke-TdStep -Id 'trust' -Title 'Trust the server for remoting' -Always -Hint 'Approve the Windows prompt in the desktop app.' -Action {
        if (-not (Test-TdTrustedHost $addr)) { throw "The server $addr is not in WSMan TrustedHosts." }
    }
    Invoke-TdStep -Id 'reach' -Title 'Connect to the server' -Hint 'Enable remoting on the server: Enable-PSRemoting -Force, and allow TCP 5985.' -Action { Wait-TdWinRM -Address $addr -TimeoutMinutes 10 | Out-Null }
    Invoke-TdStep -Id 'copy' -Title 'Copy TempDesk files' -Hint 'Check free space on C: and that the account is a local administrator.' -Action {
        $sess = New-PSSession -ComputerName $addr -Credential $cred -Authentication Negotiate
        try {
            Invoke-Command -Session $sess -ScriptBlock { New-Item -ItemType Directory -Force -Path 'C:\TempDesk' | Out-Null }
            foreach ($f in @('server', 'agent', 'client')) {
                Write-TdLog "Copying $f"
                Copy-Item -LiteralPath (Join-Path $PayloadRoot $f) -Destination 'C:\TempDesk\' -ToSession $sess -Recurse -Force
            }
        } finally { Remove-PSSession $sess }
    }
    Invoke-TdStep -Id 'forest' -Title ("Create the forest {0}" -f $s.domainName) -Hint 'Read C:\ProgramData\TempDesk\logs\install-forest-*.log on the server.' -Action {
        Invoke-Command -ComputerName $addr -Credential $cred -Authentication Negotiate -ArgumentList $s.domainName, $s.netbiosName, $DsrmPassword, ([string]$s.functionalLevel) -ScriptBlock {
            param($d, $n, $p, $fl)
            & 'C:\TempDesk\server\Install-Forest.ps1' -DomainName $d -NetbiosName $n -SafeModePassword $p -FunctionalLevel $fl
        } -ErrorAction Stop
    }
    $domCred = New-TdCredential -UserName ("{0}\Administrator" -f $s.netbiosName) -Password $AdminPassword
    Invoke-TdStep -Id 'adws' -Title 'Wait for Active Directory after the restart' -Hint 'Active Directory Web Services can take several minutes after the first restart.' -Action {
        Start-Sleep -Seconds 30
        $deadline = (Get-Date).AddMinutes(45)
        while ($true) {
            try {
                Invoke-Command -ComputerName $addr -Credential $domCred -Authentication Negotiate -ErrorAction Stop -ScriptBlock { Import-Module ActiveDirectory; Get-ADDomain | Out-Null }
                break
            } catch {
                if ((Get-Date) -gt $deadline) { throw 'Active Directory did not come online within 45 minutes.' }
                Write-TdLog 'Waiting for Active Directory Web Services'
                Start-Sleep -Seconds 15
            }
        }
    }
    Invoke-TdStep -Id 'domain' -Title 'Create TempDesk OUs, groups and policies' -Hint 'Read C:\ProgramData\TempDesk\logs\initialize-*.log on the server.' -Action {
        Invoke-Command -ComputerName $addr -Credential $domCred -Authentication Negotiate -ErrorAction Stop -ScriptBlock { & 'C:\TempDesk\server\Initialize-TempDesk.ps1' -ClientScripts 'C:\TempDesk\client' } | ForEach-Object { Write-TdLog ([string]$_) }
    }
    Invoke-TdStep -Id 'agent' -Title 'Install the TempDesk Agent' -Hint 'Run C:\TempDesk\agent\install.ps1 on the server to see the full error.' -Action {
        $tls = [bool]($Config.PSObject.Properties['agentTls'] -and $Config.agentTls)
        Invoke-Command -ComputerName $addr -Credential $domCred -Authentication Negotiate -ArgumentList $tls -ErrorAction Stop -ScriptBlock { param($t) if ($t) { & 'C:\TempDesk\agent\install.ps1' -Tls } else { & 'C:\TempDesk\agent\install.ps1' } } | ForEach-Object { Write-TdLog ([string]$_) }
    }
    Invoke-TdStep -Id 'keys' -Title 'Fetch agent keys' -Always -Action {
        $script:Agent = Save-TdAgentJson -Raw (Get-TdRemoteAgentJson -Address $addr -Credential $domCred) -Directory $Directory
    }
    Invoke-TdStep -Id 'envs' -Title 'Write portal settings' -Always -Action {
        Save-TdPortalEnv -Env (New-TdPortalEnv -Agent $script:Agent -AgentHost $addr) -Directory $Directory
    }
}

function Invoke-TdAgentUninstall {
    param([Parameter(Mandatory)][string] $Address, [Parameter(Mandatory)][pscredential] $Credential, [switch] $Purge)
    Invoke-Command -ComputerName $Address -Credential $Credential -Authentication Negotiate -ArgumentList ([bool]$Purge) -ErrorAction Stop -ScriptBlock {
        param($p) if ($p) { & 'C:\TempDesk\agent\install.ps1' -Uninstall -Purge } else { & 'C:\TempDesk\agent\install.ps1' -Uninstall }
    }
}

Export-ModuleMember -Function Test-TdIPv4, Get-TdTrustedHostList, Get-TdTrustedHostValue, Test-TdTrustedHost, Set-TdTrustedHost, ConvertTo-TdStageView,
    New-TdCredential, Wait-TdWinRM, Get-TdRemoteStatus, Get-TdRemoteAgentJson, Save-TdAgentJson, Invoke-TdServerMonitor, Invoke-TdServerAdvanced, Invoke-TdAgentUninstall
