# Native authorization and durable state for one dedicated workstation.
function Assert-SeatStorage {
    $trusted = @('S-1-5-18','S-1-5-32-544')
    $dir = Get-Item -LiteralPath $script:SeatDirectory -Force -ErrorAction Stop
    if (-not $dir.PSIsContainer) { throw 'Missing protected seat directory.' }
    Assert-TdWatcherPath $dir.Parent.FullName ([Security.AccessControl.FileSystemRights]'Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership')
    foreach ($path in @($dir.FullName) + @(Get-ChildItem -LiteralPath $dir.FullName -Force | ForEach-Object FullName)) {
        $item = Get-Item -LiteralPath $path -Force
        $acl = Get-Acl -LiteralPath $path
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) {
            throw 'Seat storage owner or location is unsafe.'
        }
        foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted) {
                throw 'Seat storage is accessible to another principal.'
            }
        }
    }
}

function Get-SeatState {
    $file = Join-Path $script:SeatDirectory 'state.json'
    $state = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($state.version -ne 1 -or $state.target -cne $script:SeatTarget -or $state.state -notin @('empty','reserved','granting','assigned','revoking')) {
        throw 'Invalid saved seat state.'
    }
    foreach ($field in 'state','lease','target','sid','username','expiresAt') {
        if ($state.$field -isnot [string]) { throw 'Invalid saved seat field.' }
    }
    if ($state.state -eq 'empty') {
        if ($state.lease -or $state.sid -or $state.username -or $state.expiresAt) { throw 'Unexpected empty-seat metadata.' }
    } elseif ($state.lease -cnotmatch '^[a-zA-Z0-9_-]{24}$') { throw 'Invalid saved lease.' }
    if ($state.sid) {
        if ($state.state -notin @('granting','assigned','revoking') -or $state.sid -notmatch '^S-1-5-21-\d+-\d+-\d+-\d+$' -or
            $state.username -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}@' -or $state.expiresAt -notmatch '(Z|[+-]\d\d:\d\d)$') {
            throw 'Invalid persisted account attachment.'
        }
        $null = [datetimeoffset]::Parse($state.expiresAt,[cultureinfo]::InvariantCulture)
    } elseif ($state.state -in @('granting','assigned') -or $state.username -or $state.expiresAt) {
        throw 'Incomplete persisted account attachment.'
    }
    $state
}

function Save-SeatState($State, [switch]$Initialize) {
    $path = Join-Path $script:SeatDirectory 'state.json'
    $temp = Join-Path $script:SeatDirectory ([guid]::NewGuid().ToString('N') + '.tmp')
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($State | ConvertTo-Json -Compress))
    $file = [IO.File]::Open($temp, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $file.Write($bytes,0,$bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
    try {
        if ($Initialize) { [IO.File]::Move($temp,$path) }
        else { [IO.File]::Replace($temp,$path,[NullString]::Value) }
    } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp } }
}

function New-SeatState {
    [pscustomobject]@{ version=1; target=$script:SeatTarget; state='empty'; lease=''; sid=''; username=''; expiresAt='' }
}

function Get-SeatMembers {
    @(Get-LocalGroupMember -SID 'S-1-5-32-555' -ErrorAction Stop | ForEach-Object { $_.SID.Value })
}

function Assert-SeatRights {
    # Check the effective LSA allow right. Other local or domain policy grants would
    # otherwise make an empty Remote Desktop Users group insufficient.
    $file = Join-Path $script:SeatDirectory ([guid]::NewGuid().ToString('N') + '.inf')
    try {
        & "$env:SystemRoot/System32/secedit.exe" /export /mergedpolicy /cfg $file /areas USER_RIGHTS /quiet | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not read effective user rights.' }
        $allow = @(Get-Content -LiteralPath $file | Where-Object { $_ -match '^\s*SeRemoteInteractiveLogonRight\s*=' })
        if ($allow.Count -ne 1 -or $allow[0] -notmatch '^\s*SeRemoteInteractiveLogonRight\s*=\s*\*S-1-5-32-555\s*$') {
            throw 'The only effective RDP allow right must be Remote Desktop Users.'
        }
        $deny = @(Get-Content -LiteralPath $file | Where-Object { $_ -match '^\s*SeDenyRemoteInteractiveLogonRight\s*=' })
        if ($deny.Count -and ($deny.Count -ne 1 -or $deny[0] -notmatch '^\s*SeDenyRemoteInteractiveLogonRight\s*=\s*(\*S-1-5-32-546)?\s*$')) {
            throw 'Unrecognized remote interactive deny assignment.'
        }
    } finally { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
}

function Assert-SeatEmptySessions {
    if ([TempDesk.SeatSessions]::Occupied()) { throw 'An occupied workstation session exists.' }
}

function Assert-SeatHost {
    $readiness = & (Join-Path $PSScriptRoot 'Get-CommonsKioskReadiness.ps1') -ComputerName $script:SeatComputer -DomainDns $script:SeatDomain
    if (-not $readiness.RdpEnabled -or -not $readiness.NetworkLevelAuthentication) { throw 'NLA-protected RDP is required.' }
    Assert-SeatRights
}

function Resolve-SeatAccount([string]$Username,[datetimeoffset]$Expiry) {
    $parts = $Username.Split('@')
    if ($parts.Count -ne 2 -or $parts[1] -ine $script:SeatDomain -or $parts[0] -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$') {
        throw 'Invalid guest account UPN.'
    }
    $sam = $parts[0]
    $config = Get-TdVirtualCommonsWatcherConfig -DomainDns $script:SeatDomain
    if (-not $sam.StartsWith($config.usernamePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Wrong guest prefix.' }
    # The AD module is an operator-installed RSAT prerequisite. Pin queries to
    # one writable controller so revocation and authorization read the same replica.
    $dc = @( (Get-ADDomainController -Discover -DomainName $script:SeatDomain -Writable -ErrorAction Stop).HostName )[0]
    $users = @(Get-ADUser -Server $dc -SearchBase $config.guestOuDn -SearchScope OneLevel -LDAPFilter "(sAMAccountName=$sam)" -Properties accountExpirationDate -ErrorAction Stop)
    if ($users.Count -ne 1) { throw 'Could not resolve one guest in the approved OU.' }
    $user = $users[0]
    if (-not $user.Enabled -or $user.SamAccountName -ine $sam -or $user.UserPrincipalName -ine $Username -or -not $user.AccountExpirationDate) { throw 'Guest is unavailable.' }
    $until = $user.AccountExpirationDate.ToUniversalTime()
    if ($until -le [datetime]::UtcNow -or [math]::Abs(($until - $Expiry.UtcDateTime).TotalSeconds) -gt 1) { throw 'Directory expiry does not match the booking.' }
    $domainSid = $user.SID.AccountDomainSid.Value
    $guestGroup = Resolve-TdVirtualCommonsGuestSid -DomainDns $script:SeatDomain -GroupName $config.guestGroup
    $allowed = @("$domainSid-513", $guestGroup)
    $groups = @(Get-ADAccountAuthorizationGroup -Identity $user -Server $dc -ErrorAction Stop | ForEach-Object { $_.SID.Value })
    if ($guestGroup -notin $groups -or @($groups | Where-Object { $_ -notin $allowed }).Count) { throw 'Guest has unexpected security group memberships.' }
    # Restrict local privilege paths as well as directory-side memberships.
    $candidateSids = @($user.SID.Value) + $groups + @('S-1-1-0','S-1-5-11','S-1-5-4','S-1-5-14')
    foreach ($group in Get-LocalGroup) {
        if ($group.SID.Value -in @('S-1-5-32-545','S-1-5-32-555')) { continue }
        foreach ($member in Get-LocalGroupMember -SID $group.SID) {
            if ($member.SID.Value -in $candidateSids) { throw 'A local privilege or deny group contains this guest.' }
            if ($member.ObjectClass -eq 'Group' -and $member.PrincipalSource -eq 'Local' -and $member.SID.Value -in @('S-1-5-32-545','S-1-5-32-555')) { throw 'A privileged local group nests a guest-accessible group.' }
        }
    }
    $user.SID.Value
}
