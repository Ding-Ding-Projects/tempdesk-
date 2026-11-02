<#
.SYNOPSIS
    Deletes expired TempDesk guest accounts. Runs every few minutes as SYSTEM on the domain controller.

.DESCRIPTION
    Only touches user objects inside the configured guest OU that carry the "TempDesk guest"
    description. Profiles on guest PCs are removed by the client cleanup task once the account is gone.
    The TempDesk Agent also runs this logic, so this task is a backstop when the agent is stopped.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string] $SettingsPath = (Join-Path $env:ProgramData 'TempDesk\settings.json'),
    [int] $GraceMinutes = 0
)

$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$source = 'TempDesk Reaper'
if (-not [Diagnostics.EventLog]::SourceExists($source)) { New-EventLog -LogName Application -Source $source }

$settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
$domainDn = (Get-ADDomain).DistinguishedName
$guestOuDn = "$($settings.guestOu),$domainDn"
$cutoff = (Get-Date).ToUniversalTime().AddMinutes(-$GraceMinutes).ToFileTimeUtc()

# accountExpires 0 and 9223372036854775807 both mean "never".
$filter = "(&(objectCategory=person)(objectClass=user)(description=TempDesk guest)(accountExpires>=1)(accountExpires<=$cutoff))"
$expired = Get-ADUser -LDAPFilter $filter -SearchBase $guestOuDn -SearchScope OneLevel -Properties accountExpires

$deleted = 0
foreach ($u in $expired) {
    if (-not $u.DistinguishedName.EndsWith(",$guestOuDn", [StringComparison]::OrdinalIgnoreCase)) { continue }
    if ($PSCmdlet.ShouldProcess($u.SamAccountName, 'Delete expired guest')) {
        try {
            Remove-ADUser -Identity $u.DistinguishedName -Confirm:$false
            $deleted++
            Write-EventLog -LogName Application -Source $source -EventId 2001 -EntryType Information `
                -Message ("Deleted expired guest {0} (expired {1:u})." -f $u.SamAccountName, [DateTime]::FromFileTimeUtc($u.accountExpires))
        }
        catch {
            Write-EventLog -LogName Application -Source $source -EventId 2901 -EntryType Warning `
                -Message ("Could not delete guest {0}: {1}" -f $u.SamAccountName, $_.Exception.Message)
        }
    }
}
Write-Output "Deleted $deleted expired guest account(s)."
