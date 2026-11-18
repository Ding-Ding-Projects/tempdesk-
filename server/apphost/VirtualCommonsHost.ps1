function Set-TdVirtualCommonsLocale {
    param([ValidateSet('en', 'zh-HK', 'bi')][string]$Language)

    $locales = if ($Language -eq 'bi') { @('en', 'zh-HK') } else { @($Language) }
    $script:TdVirtualCommonsCatalogs = @($locales | ForEach-Object {
        Get-Content -LiteralPath (Join-Path $PSScriptRoot "i18n/$_.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    })
}

function Get-TdVirtualCommonsText {
    param([string]$Key, [object[]]$Values = @())

    ($script:TdVirtualCommonsCatalogs | ForEach-Object { $_.$Key -f $Values }) -join ' / '
}

function Assert-TdWatcherPath {
    param([string]$Path, [System.Security.AccessControl.FileSystemRights]$UntrustedRights)

    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw (Get-TdVirtualCommonsText 'redirectedPath' $item.Name)
    }
    $trusted = @('S-1-5-18', 'S-1-5-32-544')
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) {
        throw (Get-TdVirtualCommonsText 'untrustedOwner' $item.Name)
    }
    foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and
            $rule.IdentityReference.Value -notin $trusted -and
            -not ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -and
            ($rule.FileSystemRights -band $UntrustedRights)) {
            throw (Get-TdVirtualCommonsText 'unprotectedPath' $item.Name)
        }
    }
}

function Assert-TdVirtualCommonsTask {
    param($Task, [string]$WatcherPath)

    if (-not $Task -or $Task.State -notin @('Ready', 'Running', 'Queued')) {
        throw (Get-TdVirtualCommonsText 'watcherMissing')
    }
    $actions = @($Task.Actions)
    $triggers = @($Task.Triggers)
    $expected = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $WatcherPath
    if ($Task.Principal.UserId -notin @('SYSTEM', 'NT AUTHORITY\SYSTEM', 'S-1-5-18') -or
        $Task.Principal.LogonType -ne 'ServiceAccount' -or
        $actions.Count -ne 1 -or $actions[0].Execute -ne 'powershell.exe' -or
        $actions[0].WorkingDirectory -or $actions[0].Arguments -ne $expected -or
        $triggers.Count -ne 1 -or $triggers[0].CimClass.CimClassName -ne 'MSFT_TaskTimeTrigger' -or
        -not $triggers[0].Enabled -or
        -not $triggers[0].Repetition -or
        $triggers[0].Repetition.Interval -ne 'PT2M' -or
        $triggers[0].Repetition.Duration -or $triggers[0].EndBoundary) {
        throw (Get-TdVirtualCommonsText 'watcherDefinition')
    }
}

function Get-TdVirtualCommonsWatcherConfig {
    param([string]$DomainDns)

    if ([Uri]::CheckHostName($DomainDns) -ne [UriHostNameType]::Dns -or
        -not (Test-ComputerSecureChannel -ErrorAction Stop)) {
        throw (Get-TdVirtualCommonsText 'secureChannel')
    }
    $task = Get-ScheduledTask -TaskPath '\TempDesk\' -TaskName 'TempDesk Session Watcher' -ErrorAction SilentlyContinue
    $parent = Join-Path $env:ProgramData 'TempDesk'
    $local = Join-Path $parent 'client'
    $watcher = Join-Path $local 'Watch-GuestSession.ps1'
    Assert-TdVirtualCommonsTask -Task $task -WatcherPath $watcher
    $now = Get-Date
    $nextRun = (Get-ScheduledTaskInfo -TaskName 'TempDesk Session Watcher' -TaskPath '\TempDesk\' -ErrorAction Stop).NextRunTime
    if (-not $nextRun -or $nextRun -lt $now.AddSeconds(-15) -or $nextRun -gt $now.AddMinutes(3)) {
        throw (Get-TdVirtualCommonsText 'missingUpcomingRun')
    }

    $replace = [Security.AccessControl.FileSystemRights]'Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
    $write = $replace -bor [Security.AccessControl.FileSystemRights]::Write
    Assert-TdWatcherPath -Path $parent -UntrustedRights $replace
    Assert-TdWatcherPath -Path $local -UntrustedRights $write

    $policyFiles = "\\$DomainDns\SYSVOL\$DomainDns\TempDesk\client"
    Assert-TdWatcherPath -Path $watcher -UntrustedRights $write
    $policyWatcher = Join-Path $policyFiles 'Watch-GuestSession.ps1'
    if (-not (Test-Path -LiteralPath $policyWatcher -PathType Leaf) -or
        (Get-FileHash -LiteralPath $watcher -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $policyWatcher -Algorithm SHA256).Hash) {
        throw (Get-TdVirtualCommonsText 'policyMismatch' 'Watch-GuestSession.ps1')
    }

    $localConfig = Join-Path $local 'client.json'
    Assert-TdWatcherPath -Path $localConfig -UntrustedRights $write
    $settings = Get-Content -LiteralPath $localConfig -Raw -Encoding UTF8
    $policyConfig = Join-Path $policyFiles 'client.json'
    if (-not (Test-Path -LiteralPath $policyConfig -PathType Leaf) -or
        $settings -cne (Get-Content -LiteralPath $policyConfig -Raw -Encoding UTF8)) {
        throw (Get-TdVirtualCommonsText 'policyMismatch' 'client.json')
    }
    $config = $settings | ConvertFrom-Json
    $required = 'domainDns', 'domainNetbios', 'guestGroup', 'guestOuDn', 'usernamePrefix'
    foreach ($field in $required) {
        if (-not $config.PSObject.Properties[$field] -or [string]::IsNullOrWhiteSpace([string]$config.$field)) {
            throw (Get-TdVirtualCommonsText 'incompleteConfiguration')
        }
    }
    if ($config.domainDns -ne $DomainDns) {
        throw (Get-TdVirtualCommonsText 'differentDomain')
    }
    $config
}

function Find-TdDomainGroups {
    param([string]$DomainDns, [string]$GroupName)

    Add-Type -AssemblyName System.DirectoryServices.AccountManagement
    $context = [DirectoryServices.AccountManagement.PrincipalContext]::new(
        [DirectoryServices.AccountManagement.ContextType]::Domain, $DomainDns)
    try {
        foreach ($type in [DirectoryServices.AccountManagement.IdentityType]::Name, [DirectoryServices.AccountManagement.IdentityType]::SamAccountName) {
            $group = [DirectoryServices.AccountManagement.GroupPrincipal]::FindByIdentity($context, $type, $GroupName)
            if ($group) {
                try {
                    [pscustomobject]@{ Sid = $group.Sid.Value; IsSecurityGroup = $group.IsSecurityGroup }
                } finally {
                    $group.Dispose()
                }
            }
        }
    } finally {
        $context.Dispose()
    }
}

function Resolve-TdVirtualCommonsGuestSid {
    param([string]$DomainDns, [string]$GroupName)

    $groups = @(Find-TdDomainGroups -DomainDns $DomainDns -GroupName $GroupName | Sort-Object -Property Sid -Unique)
    if ($groups.Count -ne 1 -or -not $groups[0].Sid -or $groups[0].IsSecurityGroup -ne $true) {
        throw (Get-TdVirtualCommonsText 'unresolvedGuestGroup')
    }
    $groups[0].Sid
}

function Assert-TdVirtualCommonsGrant {
    param([string]$DomainDns, [string]$GuestGroup, [string]$GuestSid)

    $config = Get-TdVirtualCommonsWatcherConfig -DomainDns $DomainDns
    if ($config.guestGroup -ine $GuestGroup -or
        (Resolve-TdVirtualCommonsGuestSid -DomainDns $DomainDns -GroupName $GuestGroup) -ne $GuestSid) {
        throw (Get-TdVirtualCommonsText 'changedGuestGroup')
    }
}
