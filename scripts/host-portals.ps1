[CmdletBinding()]
param([ValidateSet('menu','detached','logs','verify')][string]$Mode = 'menu')

$ErrorActionPreference = 'Stop'
$registryImage = 'ghcr.io/ding-ding-projects/tempdesk-portal'
$sourceUrl = 'https://github.com/Ding-Ding-Projects/tempdesk-'
$linuxEngine = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$deploymentLock = $null
$lockHeld = $false
$services = [ordered]@{
    'tempdesk-guest' = @{ label='Guest kiosk'; port=8080; path='/' }
    'tempdesk-admin' = @{ label='Management'; port=8081; path='/login' }
}

function Invoke-Docker {
    param([string[]]$Arguments, [string]$Failure)
    # Windows PowerShell treats native standard error as error records. Compose also sends progress there.
    $ErrorActionPreference = 'Continue'
    $result = & $dockerPath --host $linuxEngine @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { throw $Failure }
    return $result
}

function Get-LanAddress {
    $local = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.|0\.)' })
    $selected = $env:TEMPDESK_LAN_ADDRESS
    if (!$selected) {
        $routes = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' |
            Sort-Object { $_.RouteMetric + $_.InterfaceMetric }
        foreach ($route in $routes) {
            $candidate = @($local | Where-Object InterfaceIndex -eq $route.InterfaceIndex)
            if ($candidate.Count -eq 1) { $selected = $candidate[0].IPAddress; break }
        }
    }
    if (!$selected -or $selected -notin @($local.IPAddress)) {
        throw 'Set TEMPDESK_LAN_ADDRESS to a non-loopback IPv4 address assigned to this computer.'
    }
    return $selected
}

function Read-Publication {
    param([string]$Path)
    $file = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
    if (!$file -or $file.PSIsContainer) { throw 'Save the accepted portal publication receipt or set TEMPDESK_PORTAL_RECEIPT.' }
    if ($file.Length -gt 16384) { throw 'The publication receipt exceeds the supported size.' }
    try { $value = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json }
    catch { throw 'The publication receipt is not valid JSON.' }
    if ($value.schemaVersion -ne 1 -or $value.image -cne $registryImage -or $value.source -cne $sourceUrl -or
        $value.state -notin 'published','already-published' -or $value.revision -cnotmatch '^[a-f0-9]{40}$' -or
        $value.version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
        $value.digest -cnotmatch '^sha256:[a-f0-9]{64}$' -or $value.tag -cne ('sha-'+$value.revision) -or
        $value.releaseTag -cne ('v'+$value.version) -or
        $value.immutableReference -cne ($registryImage+'@'+$value.digest)) {
        throw 'Use the verified receipt from an accepted TempDesk portal release.'
    }
    return $value
}

function Watch-PortalLogs {
    param([string[]]$Compose, [string[]]$ProtectedValues)
    $ErrorActionPreference = 'Continue'
    $selected = 'tempdesk-guest'
    $paused = $false
    $lines = @()
    while ($true) {
        if (!$paused) {
            $lines = @(& $dockerPath --host $linuxEngine @Compose logs --no-color --tail 24 $selected 2>$null)
            if ($LASTEXITCODE -ne 0) { $lines = @('Logs are currently unavailable.') }
        }
        Clear-Host
        Write-Host ('TempDesk portal logs | '+$services[$selected].label)
        & $dockerPath --host $linuxEngine @Compose ps --format 'table {{.Service}}\t{{.Status}}' 2>$null
        Write-Host '[G] Guest   [M] Management   [P] Pause or resume   [Q] Exit'
        if ($paused) { Write-Host 'Log following paused.' }
        foreach ($line in $lines) {
            $visible = [string]$line
            foreach ($value in $ProtectedValues) { if ($value) { $visible = $visible.Replace($value,'[redacted]') } }
            Write-Host $visible
        }
        for ($iteration=0; $iteration -lt 12; $iteration++) {
            if ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true).Key
                switch ($key) {
                    'G' { $selected='tempdesk-guest'; $paused=$false }
                    'M' { $selected='tempdesk-admin'; $paused=$false }
                    'P' { $paused=!$paused }
                    'Escape' { return }
                    'Q' { return }
                }
                break
            }
            Start-Sleep -Milliseconds 125
        }
    }
}

function Stop-BeforeStartup {
    if ($env:TEMPDESK_PORTAL_CANCEL_FILE -and (Test-Path -LiteralPath $env:TEMPDESK_PORTAL_CANCEL_FILE -PathType Leaf)) {
        Write-Host 'Deployment cancelled before startup.'
        exit 3
    }
}

try {
    if ($Mode -eq 'menu') {
        if ([Console]::IsInputRedirected) { throw 'Use host.bat --detached when input is redirected.' }
        Write-Host 'TempDesk hosting'
        Write-Host '[D] Start in background   [L] Start and follow logs   [Q] Exit'
        do { $key = [Console]::ReadKey($true).Key } until ($key -in 'D','L','Q','Escape')
        if ($key -in 'Q','Escape') { exit 0 }
        $Mode = if ($key -eq 'L') { 'logs' } else { 'detached' }
    }
    if ($Mode -eq 'logs' -and [Console]::IsInputRedirected) { throw 'The log view requires an interactive terminal.' }

    $dockerPath = (Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (!$dockerPath) { throw 'Docker Desktop is unavailable on this computer.' }
    $engine = Invoke-Docker @('info','--format','{{.OSType}}|{{.OperatingSystem}}') 'Start the local Docker Desktop Linux engine.'
    if ($engine -ne 'linux|Docker Desktop') { throw 'TempDesk hosting requires the local Docker Desktop Linux engine.' }
    $null = Invoke-Docker @('compose','version','--short') 'The Docker Compose plugin is unavailable.'

    $source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../portal')).Path
    $configuration = if ($env:TEMPDESK_PORTAL_CONFIG_DIR) {
        (Resolve-Path -LiteralPath $env:TEMPDESK_PORTAL_CONFIG_DIR).Path
    } else { $source }
    $receiptPath = if ($env:TEMPDESK_PORTAL_RECEIPT) { $env:TEMPDESK_PORTAL_RECEIPT } else {
        Join-Path $configuration 'tempdesk-portal-publication.json'
    }
    $receipt = Read-Publication $receiptPath
    $address = Get-LanAddress
    $env:TEMPDESK_PORTAL_DIGEST = $receipt.digest
    $files = @((Join-Path $source 'compose.yaml'))
    if ($env:TEMPDESK_PORTAL_COMPOSE_OVERRIDES) {
        foreach ($override in $env:TEMPDESK_PORTAL_COMPOSE_OVERRIDES.Split(';')) {
            if ($override -eq '-') { throw 'Supply override file paths for the configured project.' }
            $file = Get-Item -LiteralPath $override
            if ($file.PSIsContainer) { throw 'Supply a file for each Compose override.' }
            $files += $file.FullName
        }
    }
    $files += Join-Path $source 'compose.published.yaml'
    $compose = @('compose','--ansi','never','--project-directory',$configuration)
    foreach ($file in $files) { $compose += @('-f',$file) }
    $raw = Invoke-Docker ($compose+@('config','--format','json')) 'The portal Compose configuration is invalid. Check the role environment files and existing overlays.'
    try { $model = ($raw -join [Environment]::NewLine) | ConvertFrom-Json }
    catch { throw 'Cannot validate the resolved portal configuration.' }
    if ($model.name -cnotmatch '^[a-z0-9][a-z0-9_-]*$' -or @($model.services.PSObject.Properties.Name).Count -ne 2) {
        throw 'Use a Compose project containing the two TempDesk portal services.'
    }
    $deploymentLock = [Threading.Mutex]::new($false,('Global\TempDeskPortal_'+$model.name))
    try { $lockHeld = $deploymentLock.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $lockHeld = $true }
    if (!$lockHeld) { throw 'This project already has a TempDesk hosting operation in progress.' }
    $protectedValues = @()
    foreach ($name in $services.Keys) {
        $service = $model.services.$name
        $target = $services[$name].port
        $binding = @($service.ports | Where-Object {
            $_.target -eq $target -and $_.protocol -eq 'tcp' -and $_.host_ip -in '',$null,'0.0.0.0',$address
        })
        if ($service.image -cne $receipt.immutableReference -or $service.build -or $binding.Count -ne 1 -or
            $binding[0].published -notmatch '^[1-9][0-9]{0,4}$' -or [int]$binding[0].published -gt 65535) {
            throw ('Check the published image and LAN port mapping for '+$services[$name].label+'.')
        }
        $services[$name].publishedPort = [int]$binding[0].published
        foreach ($property in $service.environment.PSObject.Properties) {
            if ($property.Name -match '(KEY|SECRET|PASSWORD|TOKEN)$' -and $property.Value) { $protectedValues += [string]$property.Value }
        }
    }

    $existing = @(Invoke-Docker @('ps','-a','-q','--filter',('label=com.docker.compose.project='+$model.name)) 'Cannot inspect the selected Compose project.')
    foreach ($id in $existing) {
        $labels = Invoke-Docker @('inspect',$id,'--format','{{json .Config.Labels}}') 'Cannot confirm the ownership of existing containers.' | ConvertFrom-Json
        $existingFiles = ([string]$labels.'com.docker.compose.project.config_files').Split(',')
        $knownFiles = @($existingFiles | Where-Object { $_ -in $files })
        if ($labels.'com.docker.compose.project.working_dir' -ine $configuration -or
            $labels.'com.docker.compose.service' -notin $services.Keys -or $knownFiles.Count -ne $existingFiles.Count) {
            throw 'The project has containers from another configuration. Supply the original project directory and overlays.'
        }
        $installedId = Invoke-Docker @('inspect',$id,'--format','{{.Image}}') 'Cannot read the existing portal image.'
        $labels = Invoke-Docker @('image','inspect',$installedId,'--format','{{json .Config.Labels}}') 'Cannot read the existing image metadata.' | ConvertFrom-Json
        if ($labels.'org.opencontainers.image.source' -ceq $sourceUrl -and
            $labels.'org.opencontainers.image.version' -match '^\d+\.\d+\.\d+$' -and
            ([version]$labels.'org.opencontainers.image.version') -gt ([version]$receipt.version)) {
            throw 'This receipt is older than a running TempDesk version.'
        }
    }

    if ($Mode -ne 'verify') {
        Stop-BeforeStartup
        Write-Host ('Pulling TempDesk '+$receipt.version+' by digest...')
        $null = Invoke-Docker ($compose+@('pull','tempdesk-guest','tempdesk-admin')) 'Cannot pull the published portal image. Check registry access and the receipt.'
        Stop-BeforeStartup
    }
    $labels = Invoke-Docker @('image','inspect',$receipt.immutableReference,'--format','{{json .Config.Labels}}') 'Cannot inspect the pulled digest.' | ConvertFrom-Json
    if ($labels.'org.opencontainers.image.source' -cne $sourceUrl -or
        $labels.'org.opencontainers.image.revision' -cne $receipt.revision -or
        $labels.'org.opencontainers.image.version' -cne $receipt.version) { throw 'The pulled image differs from the accepted receipt.' }
    $imageId = Invoke-Docker @('image','inspect',$receipt.immutableReference,'--format','{{.Id}}') 'Cannot read the pulled image identity.'

    $operationPassed = $true
    if ($Mode -ne 'verify') {
        Stop-BeforeStartup
        Write-Host 'Starting both portals and waiting for health...'
        try {
            $null = Invoke-Docker ($compose+@('up','-d','--no-build','--pull','never','--wait','--wait-timeout','90','tempdesk-guest','tempdesk-admin')) 'Portal startup or health verification failed. Review the configured project and Docker logs.'
        } catch {
            $operationPassed = $false
            [Console]::Error.WriteLine($_.Exception.Message)
        }
    }
    Write-Host 'Checking the published portal endpoints...'
    foreach ($name in $services.Keys) {
      try {
        $service = $services[$name]
        $ids = @(Invoke-Docker ($compose+@('ps','-q',$name)) 'Cannot identify the running portal.')
        if ($ids.Count -ne 1) { throw 'Expected one container for each configured portal.' }
        $runtime = Invoke-Docker @('inspect',$ids[0],'--format','{{.Image}} {{.State.Health.Status}} {{.State.StartedAt}}') 'Cannot read portal health.'
        $fields = $runtime -split ' '
        if ($fields.Count -ne 3 -or $fields[0] -ne $imageId -or $fields[1] -ne 'healthy') {
            throw 'A running portal differs from the healthy pulled image.'
        }
        $publishedPorts = Invoke-Docker @('inspect',$ids[0],'--format','{{json .NetworkSettings.Ports}}') 'Cannot read the running port mapping.' | ConvertFrom-Json
        $published = @($publishedPorts.("$($service.port)/tcp") | Where-Object {
            $_.HostPort -eq [string]$service.publishedPort -and $_.HostIp -in '0.0.0.0',$address
        })
        if ($published.Count -ne 1) { throw ('The running port mapping differs for '+$service.label+'.') }
        $origin = 'http://{0}:{1}' -f $address,$service.publishedPort
        $url = $origin+$service.path
        try {
            $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
            $health = Invoke-WebRequest -Uri ($origin+'/healthz') -UseBasicParsing -TimeoutSec 10
        } catch { throw ('The LAN endpoint did not respond for '+$service.label+'.') }
        if ($page.StatusCode -ne 200 -or $health.StatusCode -ne 200 -or
            !$page.Content.Contains('<code>'+$receipt.revision+'</code>') -or !$page.Content.Contains('<dd>'+$receipt.version+'</dd>')) {
            throw ('The LAN endpoint did not confirm the expected running build for '+$service.label+'.')
        }
        $startedAt = [DateTimeOffset]::Parse($fields[2]).UtcDateTime.ToString('yyyy-MM-dd HH:mm:ss')
        Write-Host ('{0} {1} | {2} | Started {3} UTC | Verified {4} UTC' -f $service.label,$receipt.version,$url,$startedAt,[DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss'))
      } catch {
        $operationPassed = $false
        [Console]::Error.WriteLine($_.Exception.Message)
      }
    }
    $deploymentLock.ReleaseMutex()
    $lockHeld = $false
    if (!$operationPassed) { exit 1 }
    if ($Mode -eq 'logs') { Watch-PortalLogs $compose $protectedValues }
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($lockHeld) { $deploymentLock.ReleaseMutex() }
    if ($deploymentLock) { $deploymentLock.Dispose() }
}
