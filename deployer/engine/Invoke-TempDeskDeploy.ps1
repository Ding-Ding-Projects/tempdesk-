<#
.SYNOPSIS
    TempDesk Deployer engine entry point. The desktop app runs it as a child process and reads
    the JSON-lines progress protocol from stdout; it also works headless from a terminal.

.DESCRIPTION
    Phases:
      Media     Build the TempDesk server install media: folder, zip kit and (Windows) ISO.
      Server    Watch the unattended install over WinRM and collect the agent keys (default),
                or with config "server.advanced": true deploy to an existing server step by step.
      Lite      Deploy TempDesk Lite (Samba domain controller container) over SSH.
      Portals   Start the portals with docker compose on this PC or on the Lite host.
      Health    GET /api/v1/health on the agent.
      Trust     Add the server to WSMan TrustedHosts (run elevated, by the app's consent prompt).
      Uninstall Remove the TempDesk Agent service from the server.

    Secrets are read from environment variables only and are never written to logs:
      TEMPDESK_SECRET_ADMINPASSWORD  Windows Administrator / Samba Administrator password
      TEMPDESK_SECRET_DSRMPASSWORD   Directory Services Restore Mode password

.EXAMPLE
    $env:TEMPDESK_SECRET_ADMINPASSWORD = Read-Host 'Admin password' -MaskInput
    $env:TEMPDESK_SECRET_DSRMPASSWORD = Read-Host 'DSRM password' -MaskInput
    pwsh deployer/engine/Invoke-TempDeskDeploy.ps1 -Config lab.json -Phase Media
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string] $Config,
    [Parameter(Mandatory)][ValidateSet('Media', 'Server', 'Lite', 'Portals', 'Health', 'Trust', 'Uninstall')][string] $Phase,
    [string] $PayloadRoot = '',
    [string] $OutDir = '',
    [switch] $Reset,
    [switch] $NoIso
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
foreach ($m in @('TempDesk.Common', 'AnswerFile', 'ServerDeploy', 'LiteDeploy', 'Portals')) {
    Import-Module (Join-Path $here "$m.psm1") -Force -DisableNameChecking
}
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

function Get-Prop { param($o, [string] $Name, $Default = $null) if ($o -and $o.PSObject.Properties[$Name] -and $null -ne $o.$Name -and '' -ne $o.$Name) { $o.$Name } else { $Default } }

$exit = 0
try {
    if (-not (Test-Path -LiteralPath $Config)) { throw "Config file not found: $Config" }
    $cfg = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
    $name = [string](Get-Prop $cfg 'name' 'default')
    if (-not $PayloadRoot) {
        $PayloadRoot = Get-Prop $cfg 'payloadRoot' ''
        if (-not $PayloadRoot) {
            # Packaged app: resources/payload. Repository checkout: the repository root.
            $candidates = @((Join-Path $here '..\payload'), (Join-Path $here '..\..'), (Join-Path $here '..\..\..\payload'))
            foreach ($c in $candidates) { if (Test-Path -LiteralPath (Join-Path $c 'server\firstboot\FirstLogon.ps1')) { $PayloadRoot = (Resolve-Path $c).ProviderPath; break } }
        }
    }
    $dir = Get-TdDeploymentDirectory -Name $name
    Initialize-TdState -Path (Join-Path $dir ("state-{0}.json" -f $Phase.ToLowerInvariant())) -Reset:$Reset
    Write-TdLog ("TempDesk Deployer engine, phase {0}, deployment '{1}'" -f $Phase, $name)

    switch ($Phase) {
        'Media' {
            $form = [ordered]@{}
            foreach ($p in $cfg.server.PSObject.Properties) { $form[$p.Name] = $p.Value }
            $form.adminPassword = Get-TdSecret -Name AdminPassword -AsPlainText -Required
            $form.dsrmPassword = Get-TdSecret -Name DsrmPassword -AsPlainText -Required
            if (-not $form.netbiosName) { $form.netbiosName = Get-TdSuggestedNetbios $form.domainName }
            $errors = Test-TdServerForm -Form $form
            if ($errors.Count) {
                foreach ($k in $errors.Keys) { Write-TdLog -Level error -Text ("{0}: {1}" -f $k, $errors[$k]) }
                throw 'The answer file settings are not valid.'
            }
            if (-not $OutDir) { $OutDir = Join-Path $dir 'media' }
            $folder = Join-Path $OutDir 'TempDesk-media'
            Invoke-TdStep -Id 'folder' -Title 'Write autounattend.xml and the TempDesk folder' -Always -Hint 'Check the payload folder exists and the output folder is writable.' -Action {
                New-TdMediaFolder -OutDir $folder -Form $form -PayloadRoot $PayloadRoot | Out-Null
            }
            Invoke-TdStep -Id 'zip' -Title 'Create the answer file kit (.zip)' -Always -Action {
                New-TdMediaZip -Folder $folder -ZipPath (Join-Path $OutDir 'TempDesk-answer-kit.zip') | Out-Null
            }
            if (-not $NoIso) {
                Invoke-TdStep -Id 'iso' -Title 'Build the ISO (second CD for virtual machines)' -Always -Hint 'IMAPI2FS is part of Windows. If it fails, use the zip kit and copy it to a USB stick.' -Action {
                    New-TdIso -Folder $folder -IsoPath (Join-Path $OutDir 'TempDesk-answer.iso') | Out-Null
                }
            }
            Write-TdLog -Level warn -Text 'The media contains the DSRM password in plain text and the Administrator password in Windows unattend encoding. Detach or erase it after the install.'
            Write-TdResult $true ([ordered]@{ folder = $folder; zip = (Join-Path $OutDir 'TempDesk-answer-kit.zip'); iso = $(if ($NoIso) { '' } else { Join-Path $OutDir 'TempDesk-answer.iso' }) })
        }
        'Trust' {
            Set-TdTrustedHost -Address ([string]$cfg.server.ipAddress)
            Write-TdResult $true ([ordered]@{ trusted = [string]$cfg.server.ipAddress })
        }
        'Server' {
            $admin = Get-TdSecret -Name AdminPassword -Required
            if ([bool](Get-Prop $cfg.server 'advanced' $false)) {
                $dsrm = Get-TdSecret -Name DsrmPassword -Required
                Invoke-TdServerAdvanced -Config $cfg -AdminPassword $admin -DsrmPassword $dsrm -PayloadRoot $PayloadRoot -Directory $dir
            } else {
                Invoke-TdServerMonitor -Config $cfg -AdminPassword $admin -Directory $dir
            }
            Write-TdResult $true ([ordered]@{ directory = $dir })
        }
        'Lite' {
            $admin = Get-TdSecret -Name AdminPassword -Required
            Invoke-TdLiteDeploy -Config $cfg -AdminPassword $admin -PayloadRoot $PayloadRoot -Directory $dir
            Write-TdResult $true ([ordered]@{ directory = $dir })
        }
        'Portals' {
            $where = [string](Get-Prop $cfg.portals 'where' 'local')
            Invoke-TdStep -Id 'portals' -Title 'Start the portals' -Always -Hint 'Make sure Docker is running on the target, then try again.' -Action {
                if ($where -eq 'ssh') { Start-TdPortalsRemote -Ssh $cfg.ssh -Directory $dir -RemoteDir ([string](Get-Prop $cfg.ssh 'remoteDir' 'tempdesk')) }
                else { Start-TdPortalsLocal -PayloadRoot $PayloadRoot -Directory $dir }
            }
            $hostName = [string](Get-Prop $cfg.portals 'publicHost' $(if ($where -eq 'ssh') { $cfg.ssh.host } else { [Net.Dns]::GetHostName() }))
            Write-TdResult $true (Get-TdPortalUrls -HostName $hostName)
        }
        'Health' {
            $agentHost = [string](Get-Prop $cfg 'agentHost' $(if ($cfg.PSObject.Properties['lite'] -and $cfg.kind -eq 'lite') { $cfg.lite.dcIp } else { $cfg.server.ipAddress }))
            $h = Invoke-TdHealthCheck -AgentUrl ('http://{0}:8080' -f $agentHost)
            Write-TdLog ("Agent {0} on {1}: {2}" -f $h.version, $h.dc, $h.status)
            Write-TdResult $true ([ordered]@{ status = [string]$h.status; version = [string]$h.version; domain = [string]$h.domain; backend = [string]$h.backend })
        }
        'Uninstall' {
            $admin = Get-TdSecret -Name AdminPassword -Required
            $cred = New-TdCredential -UserName ("{0}\Administrator" -f $cfg.server.netbiosName) -Password $admin
            Invoke-TdStep -Id 'uninstall' -Title 'Remove the TempDesk Agent service' -Always -Action { Invoke-TdAgentUninstall -Address ([string]$cfg.server.ipAddress) -Credential $cred | Out-Null }
            Write-TdResult $true @{}
        }
    }
}
catch {
    Write-TdLog -Level error -Text $_.Exception.Message
    Write-TdResult $false ([ordered]@{ error = (Protect-TdText $_.Exception.Message) })
    $exit = 1
}
exit $exit
