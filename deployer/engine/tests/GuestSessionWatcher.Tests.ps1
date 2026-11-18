#Requires -Modules Pester

BeforeAll {
    . (Join-Path $PSScriptRoot '../../../client/Watch-GuestSession.ps1')

    function Invoke-LabPoll($Previous, [datetime] $At, [int[]] $Ids = @(17), [string] $Domain = 'LAB') {
        Invoke-TdSessionPoll -Config $script:config -DomainName $Domain -SessionIds $Ids -Previous $Previous -NowUtc $At
    }
}

Describe 'The TempDesk guest session watcher' {
    BeforeEach {
        $script:now = [datetime]::SpecifyKind([datetime]'2030-01-01T12:00:00', [DateTimeKind]::Utc)
        $script:config = @{
            domainDns = 'lab.example.invalid'
            guestOuDn = 'OU=Guests,DC=lab,DC=example,DC=invalid'
            logoffWarningMinutes = 5
        }
        $script:guest = [pscustomobject]@{
            Id = 17; User = 'guest-test'; Domain = 'LAB'; Sid = 'S-1-5-21-100-200-300-1000'; LogonTime = $script:now.ToFileTimeUtc()
        }
        $script:expiry = $script:now.AddMinutes(20)
        $script:account = [pscustomobject]@{ Guest = $true; Expiry = $script:expiry.ToFileTimeUtc(); Disabled = $false }
        Mock Read-TdNativeSession { $script:guest }
        Mock Find-TdWatchedAccount { $script:account }
        Mock Request-TdSessionLogoff { $true }
        Mock Send-TdSessionWarning { $true }
        Mock Write-TdSessionLog {}
    }

    It 'honors a previously observed deadline during a directory outage' {
        $first = Invoke-LabPoll @{} $script:now
        $serialized = @{
            Version = 1; Domain = $script:config.domainDns; GuestOu = $script:config.guestOuDn; Records = @($first.Values)
        } | ConvertTo-Json -Depth 4 -Compress
        $reopened = ConvertFrom-TdSessionLedger $script:config $serialized
        Mock Find-TdWatchedAccount { throw 'Test directory unavailable' }

        $before = Invoke-LabPoll $reopened $script:expiry.AddMinutes(-2)
        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
        Should -Invoke Send-TdSessionWarning -Times 1 -Exactly -ParameterFilter { $Id -eq 17 }
        $null = Invoke-LabPoll $before $script:expiry.AddSeconds(-1)
        Should -Invoke Send-TdSessionWarning -Times 1 -Exactly

        $null = Invoke-LabPoll $before $script:expiry
        Should -Invoke Request-TdSessionLogoff -Times 1 -Exactly -ParameterFilter { $Id -eq 17 }
    }

    It 'refreshes a deadline that was extended while the directory was reachable' {
        $first = Invoke-LabPoll @{} $script:now
        $script:account.Expiry = $script:expiry.AddMinutes(10).ToFileTimeUtc()
        $extended = Invoke-LabPoll $first $script:now.AddMinutes(15)
        Mock Find-TdWatchedAccount { throw 'Test directory unavailable' }
        $null = Invoke-LabPoll $extended $script:expiry

        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
        $null = Invoke-LabPoll $extended $script:expiry.AddMinutes(10)
        Should -Invoke Request-TdSessionLogoff -Times 1 -Exactly
    }

    It 'retains an authoritative removal across a failed sign-out request and a later outage' {
        $first = Invoke-LabPoll @{} $script:now
        Mock Find-TdWatchedAccount {}
        Mock Request-TdSessionLogoff { $false }
        $removed = Invoke-LabPoll $first $script:now.AddMinutes(3)
        @($removed.Values)[0].Revoked | Should -Be 'deleted'

        Mock Find-TdWatchedAccount { throw 'Test directory unavailable' }
        $null = Invoke-LabPoll $removed $script:now.AddMinutes(4)
        Should -Invoke Request-TdSessionLogoff -Times 2 -Exactly
    }

    It 'does not apply a deadline to a newly occupied session slot after lookup' {
        $first = Invoke-LabPoll @{} $script:now
        Mock Find-TdWatchedAccount {
            $script:guest = [pscustomobject]@{
                Id = 17; User = 'guest-test'; Domain = 'LAB'; Sid = 'S-1-5-21-100-200-300-1000'
                LogonTime = $script:expiry.ToFileTimeUtc()
            }
            throw 'Test directory unavailable'
        }
        $null = Invoke-LabPoll $first $script:expiry
        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
    }

    It 'follows a renamed account by its original SID' {
        $first = Invoke-LabPoll @{} $script:now
        $script:guest.User = 'guest-renamed'
        $current = Invoke-LabPoll $first $script:now.AddMinutes(2)
        $current.Count | Should -Be 1
        Should -Invoke Find-TdWatchedAccount -Times 2 -Exactly -ParameterFilter { $Sid -eq 'S-1-5-21-100-200-300-1000' }
        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
    }

    It 'does not adopt a replacement account with a matching name' {
        Mock Find-TdWatchedAccount {}
        Mock Find-TdWatchedAccount { $script:account } -ParameterFilter { $Sid -eq 'S-1-5-21-100-200-300-1001' }
        $current = Invoke-LabPoll @{} $script:expiry
        $current.Count | Should -Be 0
        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
        Should -Invoke Find-TdWatchedAccount -Times 1 -Exactly -ParameterFilter { $Sid -eq 'S-1-5-21-100-200-300-1000' }
    }

    It 'keeps separate session slots and clears identities after a confirmed sign-out' {
        $first = Invoke-LabPoll @{} $script:now
        Mock Read-TdNativeSession {
            if ($Id -eq 17) { return }
            [pscustomobject]@{
                Id = 18; User = 'guest-test'; Domain = 'LAB'; Sid = 'S-1-5-21-100-200-300-1000'
                LogonTime = $script:expiry.ToFileTimeUtc()
            }
        }
        Mock Find-TdWatchedAccount { throw 'Test directory unavailable' }

        $unknown = Invoke-LabPoll $first $script:expiry @(17, 18)
        $unknown.Count | Should -Be 1
        $removed = Invoke-LabPoll $unknown $script:expiry @(18)
        $removed.Count | Should -Be 0
        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
    }

    It 'leaves a never-expiring or unobserved account signed in during an outage' {
        $script:account.Expiry = 0
        $first = Invoke-LabPoll @{} $script:now
        Mock Find-TdWatchedAccount { throw 'Test directory unavailable' }
        $null = Invoke-LabPoll $first $script:expiry
        $null = Invoke-LabPoll @{} $script:expiry
        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
        Should -Invoke Send-TdSessionWarning -Times 0 -Exactly
    }

    It 'waits for a readable SID before acting on a retained deadline' {
        $first = Invoke-LabPoll @{} $script:now
        $script:guest.Sid = ''
        $current = Invoke-LabPoll $first $script:expiry
        $current.Count | Should -Be 1
        Should -Invoke Request-TdSessionLogoff -Times 0 -Exactly
        Should -Invoke Find-TdWatchedAccount -Times 1 -Exactly
    }

    It 'discards saved records from a different guest OU' {
        $first = Invoke-LabPoll @{} $script:now
        $serialized = @{ Version = 1; Domain = $script:config.domainDns; GuestOu = 'OU=FormerGuests'; Records = @($first.Values) } |
            ConvertTo-Json -Depth 4 -Compress
        $parsed = ConvertFrom-TdSessionLedger $script:config $serialized
        $parsed.Count | Should -Be 0
    }
}
