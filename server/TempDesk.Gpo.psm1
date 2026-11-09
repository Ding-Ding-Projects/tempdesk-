<#
    Helpers for the parts of Group Policy that have no PowerShell cmdlet:
    startup and logon script lists, client-side extension (CSE) registration,
    and GPO version bumps. Works on Windows Server Core.
#>

Set-StrictMode -Version Latest

# Client-side extension and tool pairs written to gPCMachineExtensionNames / gPCUserExtensionNames.
$script:CsePairs = @{
    ScriptsMachine = '[{42B5FAAE-6536-11D2-AE5A-0000F87571E3}{40B6664F-4972-11D1-A7CA-0000F87571E3}]'
    ScriptsUser    = '[{42B5FAAE-6536-11D2-AE5A-0000F87571E3}{40B66650-4972-11D1-A7CA-0000F87571E3}]'
}

function Get-TempDeskGpoPaths {
    param([Parameter(Mandatory)] [Guid] $GpoId)
    $domain = Get-ADDomain
    $dns = $domain.DNSRoot
    $id = "{$($GpoId.ToString().ToUpper())}"
    $root = "\\$dns\SYSVOL\$dns\Policies\$id"
    # On the domain controller itself use the local SYSVOL folder. Right after the promotion restart the
    # domain path is not reachable yet, and setup stopped with "The network path was not found" although
    # the policy folder was already there locally.
    try {
        $sysvol = [string](Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\Netlogon\Parameters' -Name SysVol -ErrorAction Stop).SysVol
        $local = Join-Path (Join-Path (Join-Path $sysvol $dns) 'Policies') $id
        if ($sysvol -and (Test-Path -LiteralPath $local)) { $root = $local }
    } catch { }
    [pscustomobject]@{
        Dn      = "CN=$id,CN=Policies,CN=System,$($domain.DistinguishedName)"
        SysvolRoot = $root
    }
}

function Merge-CseList {
    <# Merges one "[{CSE}{TOOL}]" pair into an extension-name string, keeping the list sorted by CSE GUID as Windows expects. #>
    param([string] $Existing, [Parameter(Mandatory)] [string] $Pair)
    $items = @()
    if ($Existing) {
        $items = [regex]::Matches($Existing, '\[[^\]]+\]') | ForEach-Object { $_.Value }
    }
    if ($items -notcontains $Pair) {
        # Same CSE with a different tool list: merge the tool GUIDs into one bracket.
        $cse = ([regex]::Match($Pair, '^\[(\{[^}]+\})')).Groups[1].Value
        $sameCse = $items | Where-Object { $_.StartsWith("[$cse", [StringComparison]::OrdinalIgnoreCase) }
        if ($sameCse) {
            $guids = @([regex]::Matches(($sameCse + $Pair), '\{[^}]+\}') | ForEach-Object { $_.Value.ToUpperInvariant() } |
                Where-Object { $_ -ne $cse.ToUpperInvariant() } | Sort-Object -Unique)
            $merged = '[' + $cse.ToUpperInvariant() + ($guids -join '') + ']'
            $items = @($items | Where-Object { $_ -ne $sameCse }) + $merged
        }
        else {
            $items += $Pair
        }
    }
    ($items | Sort-Object { ([regex]::Match($_, '^\[(\{[^}]+\})')).Groups[1].Value.ToUpperInvariant() }) -join ''
}

function Step-TempDeskGpoVersion {
    <# Bumps the user or machine half of the GPO version in AD and in GPT.INI so clients re-apply it. #>
    param([Parameter(Mandatory)] [Guid] $GpoId, [Parameter(Mandatory)] [ValidateSet('Machine', 'User')] [string] $Side)
    $p = Get-TempDeskGpoPaths -GpoId $GpoId
    $obj = Get-ADObject -Identity $p.Dn -Properties versionNumber
    $v = [int64]$obj.versionNumber
    $user = ($v -shr 16) -band 0xFFFF
    $machine = $v -band 0xFFFF
    if ($Side -eq 'Machine') { $machine = ($machine + 1) -band 0xFFFF } else { $user = ($user + 1) -band 0xFFFF }
    $new = [int](($user -shl 16) -bor $machine)
    Set-ADObject -Identity $p.Dn -Replace @{ versionNumber = $new }
    $gpt = Join-Path $p.SysvolRoot 'GPT.INI'
    $lines = if (Test-Path $gpt) { Get-Content -LiteralPath $gpt } else { @('[General]') }
    if ($lines -match '^Version=') { $lines = $lines -replace '^Version=.*$', "Version=$new" } else { $lines += "Version=$new" }
    Set-Content -LiteralPath $gpt -Value $lines -Encoding ascii
    $new
}

function Set-TempDeskGpoScript {
    <#
    .SYNOPSIS
        Sets the single TempDesk entry of a GPO's startup (computer) or logon (user) script list.
    .DESCRIPTION
        Writes scripts.ini (UTF-16 LE, as GPMC writes it) so the command runs powershell.exe with
        -ExecutionPolicy Bypass against a script on SYSVOL. Registers the scripts CSE and bumps the version.
    #>
    param(
        [Parameter(Mandatory)] [Guid] $GpoId,
        [Parameter(Mandatory)] [ValidateSet('Startup', 'Logon')] [string] $Kind,
        [Parameter(Mandatory)] [string] $ScriptUncPath
    )
    $p = Get-TempDeskGpoPaths -GpoId $GpoId
    $side = if ($Kind -eq 'Startup') { 'Machine' } else { 'User' }
    $dir = Join-Path $p.SysvolRoot "$side\Scripts"
    New-Item -ItemType Directory -Force -Path (Join-Path $dir $Kind) | Out-Null
    $ini = @(
        '',
        "[$Kind]",
        '0CmdLine=powershell.exe',
        "0Parameters=-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptUncPath`""
    ) -join "`r`n"
    [IO.File]::WriteAllText((Join-Path $dir 'scripts.ini'), $ini + "`r`n", [Text.Encoding]::Unicode)
    $attr = if ($side -eq 'Machine') { 'gPCMachineExtensionNames' } else { 'gPCUserExtensionNames' }
    $pair = if ($side -eq 'Machine') { $script:CsePairs.ScriptsMachine } else { $script:CsePairs.ScriptsUser }
    $obj = Get-ADObject -Identity $p.Dn -Properties $attr
    $merged = Merge-CseList -Existing ([string]$obj.$attr) -Pair $pair
    Set-ADObject -Identity $p.Dn -Replace @{ $attr = $merged }
    Step-TempDeskGpoVersion -GpoId $GpoId -Side $side | Out-Null
}

function Set-TempDeskFolderAcl {
    <# Replaces a folder ACL with explicit, non-inherited rules. Rules: @(@('DOMAIN\Group','ReadAndExecute'), ...) #>
    param([Parameter(Mandatory)] [string] $Path, [Parameter(Mandatory)] [object[]] $Rules)
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($r in $Rules) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $r[0], [System.Security.AccessControl.FileSystemRights]$r[1],
            'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
}

Export-ModuleMember -Function Get-TempDeskGpoPaths, Merge-CseList, Step-TempDeskGpoVersion, Set-TempDeskGpoScript, Set-TempDeskFolderAcl
