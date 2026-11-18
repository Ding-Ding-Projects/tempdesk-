#Requires -Modules Pester

BeforeAll {
    . (Join-Path $PSScriptRoot '../../../server/apphost/VirtualCommonsHost.ps1')
    Set-TdVirtualCommonsLocale 'en'

    function New-WatcherDefinition([string]$Path) {
        $arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $Path
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
        $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        [pscustomobject]@{ State = 'Ready'; Actions = @($action); Triggers = @($trigger); Principal = $principal }
    }

    $script:watcherPath = Join-Path $env:ProgramData 'TempDesk\client\Watch-GuestSession.ps1'
}

Describe 'Virtual Commons verifies the installed watcher definition' {
    It 'accepts the definition produced by the guest computer startup script' {
        { Assert-TdVirtualCommonsTask -Task (New-WatcherDefinition $script:watcherPath) -WatcherPath $script:watcherPath } |
            Should -Not -Throw
    }

    It 'rejects a missing watcher or a disabled watcher' {
        { Assert-TdVirtualCommonsTask -Task $null -WatcherPath $script:watcherPath } | Should -Throw '*enabled TempDesk Session Watcher*'
        $task = New-WatcherDefinition $script:watcherPath
        $task.State = 'Disabled'
        { Assert-TdVirtualCommonsTask -Task $task -WatcherPath $script:watcherPath } | Should -Throw '*enabled TempDesk Session Watcher*'
    }

    It 'rejects a task whose action, principal, or recurrence differs' {
        $differentAction = New-WatcherDefinition (Join-Path $TestDrive 'different.ps1')
        { Assert-TdVirtualCommonsTask -Task $differentAction -WatcherPath $script:watcherPath } | Should -Throw '*does not match*'

        $differentPrincipal = New-WatcherDefinition $script:watcherPath
        $differentPrincipal.Principal.UserId = 'LOCAL SERVICE'
        { Assert-TdVirtualCommonsTask -Task $differentPrincipal -WatcherPath $script:watcherPath } | Should -Throw '*does not match*'

        $finite = New-WatcherDefinition $script:watcherPath
        $finite.Triggers[0].Repetition.Duration = 'PT4M'
        { Assert-TdVirtualCommonsTask -Task $finite -WatcherPath $script:watcherPath } | Should -Throw '*does not match*'
    }
}

Describe 'Virtual Commons requires protected watcher paths' {
    BeforeEach {
        $script:acl = [Security.AccessControl.FileSecurity]::new()
        $script:acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-18'))
        Mock Get-Acl { $script:acl }
        Mock Get-Item { [pscustomobject]@{ Name = 'Watch-GuestSession.ps1'; Attributes = [IO.FileAttributes]::Normal } }
    }

    It 'accepts standard-user read access and rejects standard-user write access' {
        $users = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
        $script:acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users, 'Read', 'Allow'))
        { Assert-TdWatcherPath -Path $script:watcherPath -UntrustedRights Write } | Should -Not -Throw

        $script:acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users, 'Write', 'Allow'))
        { Assert-TdWatcherPath -Path $script:watcherPath -UntrustedRights Write } | Should -Throw '*requires a protected watcher path*'
    }

    It 'rejects a redirected watcher file before inspecting its access rules' {
        Mock Get-Item { [pscustomobject]@{ Name = 'Watch-GuestSession.ps1'; Attributes = [IO.FileAttributes]::ReparsePoint } }
        { Assert-TdWatcherPath -Path $script:watcherPath -UntrustedRights Write } | Should -Throw '*redirected watcher path*'
        Should -Invoke Get-Acl -Times 0 -Exactly
    }
}

Describe 'Virtual Commons binds the watcher to the joined domain' {
    BeforeEach {
        Mock Test-ComputerSecureChannel { $true }
        Mock Get-ScheduledTask { New-WatcherDefinition $script:watcherPath }
        Mock Get-ScheduledTaskInfo { [pscustomobject]@{ NextRunTime = (Get-Date).AddMinutes(1) } }
        Mock Assert-TdWatcherPath {}
        Mock Test-Path { $true }
        Mock Get-FileHash { [pscustomobject]@{ Hash = 'published bytes' } }
        Mock Get-Content {
            '{"domainDns":"school.test","domainNetbios":"SCHOOL","guestGroup":"TempDesk Guests","guestOuDn":"OU=Guests,DC=school,DC=test","usernamePrefix":"guest-","logoffWarningMinutes":5}'
        }
    }

    It 'uses the named task and returns the actual configured guest group after matching the policy files' {
        $config = Get-TdVirtualCommonsWatcherConfig -DomainDns 'school.test'
        $config.guestGroup | Should -Be 'TempDesk Guests'
        Should -Invoke Get-ScheduledTask -Times 1 -Exactly -ParameterFilter {
            $TaskPath -eq '\TempDesk\' -and $TaskName -eq 'TempDesk Session Watcher'
        }
        Should -Invoke Assert-TdWatcherPath -Times 4 -Exactly
    }

    It 'stops when the secure channel is unavailable' {
        Mock Test-ComputerSecureChannel { $false }
        { Get-TdVirtualCommonsWatcherConfig -DomainDns 'school.test' } | Should -Throw '*working secure channel*'
        Should -Invoke Get-ScheduledTask -Times 0 -Exactly
    }

    It 'rejects a stale local watcher before reading the group configuration' {
        Mock Get-FileHash { [pscustomobject]@{ Hash = 'old local bytes' } } -ParameterFilter {
            $LiteralPath -eq $script:watcherPath
        }
        { Get-TdVirtualCommonsWatcherConfig -DomainDns 'school.test' } | Should -Throw '*Watch-GuestSession.ps1 does not match*'
        Should -Invoke Get-Content -Times 0 -Exactly
    }

    It 'rejects an apparently ready task that will not actually run soon' {
        Mock Get-ScheduledTaskInfo { [pscustomobject]@{ NextRunTime = (Get-Date).AddHours(1) } }
        { Get-TdVirtualCommonsWatcherConfig -DomainDns 'school.test' } | Should -Throw '*no scheduled run in the next three minutes*'
        Should -Invoke Get-FileHash -Times 0 -Exactly
    }

    It 'rejects a stale local configuration before choosing a guest group' {
        Mock Get-Content { '{"domainDns":"school.test","guestGroup":"Different group"}' } -ParameterFilter {
            $LiteralPath -eq (Join-Path $env:ProgramData 'TempDesk\client\client.json')
        }
        { Get-TdVirtualCommonsWatcherConfig -DomainDns 'school.test' } | Should -Throw '*client.json does not match*'
    }

    It 'rejects an otherwise valid configuration from a different domain' {
        Mock Get-Content {
            '{"domainDns":"other.test","domainNetbios":"OTHER","guestGroup":"Guests","guestOuDn":"OU=Guests,DC=other,DC=test","usernamePrefix":"guest-"}'
        }
        { Get-TdVirtualCommonsWatcherConfig -DomainDns 'school.test' } | Should -Throw '*belongs to a different domain*'
    }
}

Describe 'Virtual Commons resolves the exact domain security group' {
    BeforeEach {
        Mock Find-TdDomainGroups {}
    }

    It 'accepts the configured display name even when the account name has no spaces' {
        Mock Find-TdDomainGroups {
            [pscustomobject]@{ Sid = 'S-1-5-21-100-200-300-400'; IsSecurityGroup = $true; SamAccountName = 'TempDeskGuests' }
        } -ParameterFilter { $GroupName -ceq 'TempDesk Guests' -and $DomainDns -ceq 'school.test' }
        Resolve-TdVirtualCommonsGuestSid -DomainDns 'school.test' -GroupName 'TempDesk Guests' |
            Should -Be 'S-1-5-21-100-200-300-400'
    }

    It 'rejects unresolved groups, distribution groups and ambiguous matches' {
        { Resolve-TdVirtualCommonsGuestSid -DomainDns 'school.test' -GroupName 'Unknown' } | Should -Throw '*one security group*'

        Mock Find-TdDomainGroups { [pscustomobject]@{ Sid = 'S-1-5-21-100-200-300-400'; IsSecurityGroup = $false } }
        { Resolve-TdVirtualCommonsGuestSid -DomainDns 'school.test' -GroupName 'Mail Group' } | Should -Throw '*one security group*'

        Mock Find-TdDomainGroups {
            [pscustomobject]@{ Sid = 'S-1-5-21-100-200-300-400'; IsSecurityGroup = $true }
            [pscustomobject]@{ Sid = 'S-1-5-21-100-200-300-401'; IsSecurityGroup = $true }
        }
        { Resolve-TdVirtualCommonsGuestSid -DomainDns 'school.test' -GroupName 'Ambiguous' } | Should -Throw '*one security group*'
    }
}

Describe 'Virtual Commons setup language' {
    It 'has matching English and Cantonese message keys and renders both in bilingual mode' {
        $catalog = Join-Path $PSScriptRoot '../../../server/apphost/i18n'
        $english = (Get-Content -LiteralPath (Join-Path $catalog 'en.json') -Raw | ConvertFrom-Json).PSObject.Properties.Name
        $cantonese = (Get-Content -LiteralPath (Join-Path $catalog 'zh-HK.json') -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties.Name
        Compare-Object $english $cantonese | Should -BeNullOrEmpty
        try {
            Set-TdVirtualCommonsLocale 'bi'
            Get-TdVirtualCommonsText 'checkingWatcher' | Should -Match '^Checking.* / 正在檢查'
        } finally {
            Set-TdVirtualCommonsLocale 'en'
        }
    }
}

Describe 'App Host installer parameter binding' {
    BeforeAll {
        $entry = Join-Path $PSScriptRoot '../../../server/apphost/Install-AppHost.ps1'
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($entry, [ref]$null, [ref]$null)
        $script:BindAppHost = [ScriptBlock]::Create($ast.ParamBlock.Extent.Text + [Environment]::NewLine + '$PSCmdlet.ParameterSetName')
    }

    It 'rejects switching off Virtual Commons instead of falling through to RemoteApp setup' {
        { & $script:BindAppHost -VirtualCommons:$false } | Should -Throw
        & $script:BindAppHost -VirtualCommons -Language 'zh-HK' | Should -Be 'VirtualCommons'
        & $script:BindAppHost -AppsJson '[]' | Should -Be 'RemoteApps'
    }
}
