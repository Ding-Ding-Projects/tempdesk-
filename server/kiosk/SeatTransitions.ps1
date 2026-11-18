# One process holds the storage lock before calling these transitions.
function Invoke-SeatTransition([string]$Route, $Body) {
    $state = Get-SeatState
    if ($Route -eq '/seat') {
        $ready = $false
        if ($state.state -eq 'empty') {
            try { Assert-SeatHost; Assert-SeatEmptySessions; $ready = @(Get-SeatMembers).Count -eq 0 } catch { $ready = $false }
        }
        return @{ target=$script:SeatTarget; ready=$ready }
    }
    if ($Body.target -ine $script:SeatTarget -or $Body.lease -cnotmatch '^[a-zA-Z0-9_-]{24}$') { throw 'Invalid lease or target.' }
    if ($Route -eq '/seat/reserve') {
        Assert-SeatHost
        Assert-SeatEmptySessions
        if (@(Get-SeatMembers).Count) { throw 'Remote logon grant exists.' }
        if ($state.state -eq 'empty') {
            $state.state='reserved'
            $state.lease=$Body.lease
            Save-SeatState $state
        } elseif ($state.state -ne 'reserved' -or $state.lease -cne $Body.lease) { throw 'Workstation already reserved.' }
        return @{ lease=$state.lease; target=$state.target; state='reserved' }
    }
    if ($state.lease -cne $Body.lease) { throw 'Lease does not own this workstation.' }
    if ($Route -eq '/seat/cancel') {
        if ($state.state -notin @('reserved','granting','assigned','revoking')) { throw 'No active reservation.' }
        $state.state='revoking'
        Save-SeatState $state
        $members = @(Get-SeatMembers)
        if ($state.sid -and $state.sid -in $members) {
            Remove-LocalGroupMember -SID 'S-1-5-32-555' -Member ([Security.Principal.SecurityIdentifier]::new($state.sid)) -ErrorAction Stop
        }
        # An existing session may retain its logon token after membership is removed.
        # Never disconnect another occupant; the watcher enforces directory expiry.
        if (@(Get-SeatMembers).Count -or [TempDesk.SeatSessions]::Occupied()) {
            return @{ lease=$Body.lease; target=$script:SeatTarget; state='releasing' }
        }
        Save-SeatState (New-SeatState)
        return @{ lease=$Body.lease; target=$script:SeatTarget; state='released' }
    }
    if ($Route -ne '/seat/assign' -or $state.state -notin @('reserved','granting','assigned')) { throw 'Invalid seat transition.' }
    if ($Body.expiresAt -notmatch '(Z|[+-]\d\d:\d\d)$') { throw 'Guest expiry must have a timezone.' }
    $expiry = [datetimeoffset]::Parse($Body.expiresAt,[cultureinfo]::InvariantCulture)
    if ($expiry -le [datetimeoffset]::UtcNow) { throw 'Guest expired.' }
    Assert-SeatHost
    $sid = Resolve-SeatAccount $Body.username $expiry
    $members = @(Get-SeatMembers)
    if ($state.state -eq 'reserved') {
        Assert-SeatEmptySessions
        if ($members.Count) { throw 'Workstation has an existing grant.' }
        $state.state='granting'
        $state.username=$Body.username
        $state.expiresAt=$Body.expiresAt
        $state.sid=$sid
        Save-SeatState $state
    } elseif ($state.sid -ne $sid -or $state.username -cne $Body.username -or [datetimeoffset]::Parse($state.expiresAt) -ne $expiry) {
        throw 'Reservation is already attached to another account or expiry.'
    }
    if ($members.Count -eq 0 -and $state.state -eq 'granting') {
        Assert-SeatEmptySessions
        Add-LocalGroupMember -SID 'S-1-5-32-555' -Member ([Security.Principal.SecurityIdentifier]::new($sid)) -ErrorAction Stop
    }
    $members = @(Get-SeatMembers)
    if ($members.Count -ne 1 -or $members[0] -ne $sid) { throw 'Could not verify the exclusive grant.' }
    $state.state='assigned'
    Save-SeatState $state
    @{ lease=$state.lease; target=$state.target; state='assigned'; username=$state.username; expiresAt=$state.expiresAt }
}
