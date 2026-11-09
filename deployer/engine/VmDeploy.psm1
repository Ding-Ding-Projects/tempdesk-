<#
.SYNOPSIS
    Creates and starts a VMware Workstation virtual machine for the unattended TempDesk server
    install: a new empty disk, the Windows Server ISO as the first CD and the TempDesk answer ISO
    as the second CD, then presses a key so the Windows ISO boots without anyone at the keyboard.

.DESCRIPTION
    Uses the tools that ship with VMware Workstation Pro: vmware-vdiskmanager.exe (disk),
    vmrun.exe (power) and, when present, vmcli.exe (keyboard and screen). Nothing is installed and
    no existing virtual machine is changed: the phase refuses a folder that already holds a
    different virtual machine.
#>
Set-StrictMode -Version 3

function Get-TdVmwareTools {
    <# Returns @{ Root; Vmrun; DiskManager; Vmcli } or throws when VMware Workstation is not installed. #>
    $roots = @()
    foreach ($key in @('HKLM:\SOFTWARE\WOW6432Node\VMware, Inc.\VMware Workstation', 'HKLM:\SOFTWARE\VMware, Inc.\VMware Workstation')) {
        try { $p = (Get-ItemProperty -LiteralPath $key -Name InstallPath -ErrorAction Stop).InstallPath; if ($p) { $roots += [string]$p } } catch { }
    }
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) { if ($base) { $roots += (Join-Path $base 'VMware\VMware Workstation') } }
    foreach ($r in $roots) {
        $vmrun = Join-Path $r 'vmrun.exe'
        $disk = Join-Path $r 'vmware-vdiskmanager.exe'
        if ((Test-Path -LiteralPath $vmrun) -and (Test-Path -LiteralPath $disk)) {
            $cli = Join-Path $r 'vmcli.exe'
            return [pscustomobject]@{ Root = $r; Vmrun = $vmrun; DiskManager = $disk; Vmcli = $(if (Test-Path -LiteralPath $cli) { $cli } else { '' }) }
        }
    }
    throw 'VMware Workstation was not found on this PC (vmrun.exe and vmware-vdiskmanager.exe).'
}

function Test-TdVmName {
    param([string] $Name)
    [bool]($Name -match '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$') -and ($Name -notmatch '\.\.') -and ($Name -notmatch '[ .]$')
}

function ConvertTo-TdVmxValue {
    <# A .vmx value is written in double quotes; quotes and line breaks are not allowed in it. #>
    param([AllowEmptyString()][string] $Value)
    if ($Value -match '["\r\n]') { throw 'A virtual machine setting contains a quote or a line break.' }
    $Value
}

function New-TdVmwareVmx {
    <#
    .SYNOPSIS
        Returns the text of a .vmx file for the TempDesk server install.
    .PARAMETER Network
        bridged (the server is on your LAN, matching the answer file), nat or hostonly.
    #>
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][string] $DiskFile,
        [Parameter(Mandatory)][string] $WindowsIso,
        [Parameter(Mandatory)][string] $KitIso,
        [ValidateSet('uefi', 'bios')][string] $Firmware = 'uefi',
        [ValidateRange(1, 64)][int] $Cpus = 2,
        [ValidateRange(2048, 1048576)][int] $MemoryMb = 4096,
        [ValidateSet('bridged', 'nat', 'hostonly')][string] $Network = 'bridged'
    )
    if (-not (Test-TdVmName $Name)) { throw 'Virtual machine name: letters, numbers, space, dot, dash or underscore (1 to 63).' }
    $l = New-Object System.Collections.Generic.List[string]
    $add = { param($k, $v) $l.Add(('{0} = "{1}"' -f $k, (ConvertTo-TdVmxValue ([string]$v)))) }
    & $add '.encoding' 'UTF-8'
    & $add 'config.version' '8'
    & $add 'virtualHW.version' '19'
    & $add 'displayName' $Name
    & $add 'guestOS' 'windows2019srvnext-64'
    & $add 'firmware' $(if ($Firmware -eq 'bios') { 'bios' } else { 'efi' })
    & $add 'numvcpus' $Cpus
    & $add 'cpuid.coresPerSocket' $Cpus
    & $add 'memsize' $MemoryMb
    & $add 'pciBridge0.present' 'TRUE'
    foreach ($n in 4..7) {
        & $add "pciBridge$n.present" 'TRUE'
        & $add "pciBridge$n.virtualDev" 'pcieRootPort'
        & $add "pciBridge$n.functions" '8'
    }
    & $add 'vmci0.present' 'TRUE'
    & $add 'hpet0.present' 'TRUE'
    if ($Firmware -eq 'bios') {
        # A BIOS machine cannot start Windows from NVMe: use the SAS controller Windows has a driver for.
        & $add 'scsi0.present' 'TRUE'
        & $add 'scsi0.virtualDev' 'lsisas1068'
        & $add 'scsi0:0.present' 'TRUE'
        & $add 'scsi0:0.fileName' $DiskFile
    }
    else {
        & $add 'nvme0.present' 'TRUE'
        & $add 'nvme0:0.present' 'TRUE'
        & $add 'nvme0:0.fileName' $DiskFile
    }
    & $add 'sata0.present' 'TRUE'
    & $add 'sata0:0.present' 'TRUE'
    & $add 'sata0:0.deviceType' 'cdrom-image'
    & $add 'sata0:0.fileName' $WindowsIso
    & $add 'sata0:1.present' 'TRUE'
    & $add 'sata0:1.deviceType' 'cdrom-image'
    & $add 'sata0:1.fileName' $KitIso
    & $add 'ethernet0.present' 'TRUE'
    & $add 'ethernet0.connectionType' $Network
    & $add 'ethernet0.virtualDev' 'e1000e'
    & $add 'ethernet0.addressType' 'generated'
    & $add 'usb.present' 'TRUE'
    & $add 'ehci.present' 'TRUE'
    & $add 'usb_xhci.present' 'TRUE'
    & $add 'tools.syncTime' 'FALSE'
    & $add 'bios.bootOrder' 'cdrom,hdd'
    # Answer VMware's own questions (for example about a moved or copied machine) with the default.
    & $add 'msg.autoAnswer' 'TRUE'
    ($l -join "`r`n") + "`r`n"
}

function Invoke-TdVmTool {
    <# Runs one VMware command line tool. Returns @{ ExitCode; Output }. #>
    param([Parameter(Mandatory)][string] $Exe, [Parameter(Mandatory)][string[]] $Arguments, [int] $TimeoutSec = 120)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = (@($Arguments | ForEach-Object { ConvertTo-TdWindowsArg $_ })) -join ' '
    $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEndAsync(); $err = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) { try { $p.Kill() } catch { }; throw "$([IO.Path]::GetFileName($Exe)) did not finish within $TimeoutSec seconds." }
    [pscustomobject]@{ ExitCode = $p.ExitCode; Output = (($out.Result + "`n" + $err.Result).Trim()) }
}

function Test-TdVmRunning {
    param([Parameter(Mandatory)] $Tools, [Parameter(Mandatory)][string] $Vmx)
    $r = Invoke-TdVmTool -Exe $Tools.Vmrun -Arguments @('-T', 'ws', 'list')
    [bool](@($r.Output -split '\r?\n' | Where-Object { $_.Trim() -ieq $Vmx }).Count)
}

function Get-TdVmSettings {
    <# Validated virtual machine settings from the deployment config. #>
    param([Parameter(Mandatory)] $Config)
    $vm = if ($Config.PSObject.Properties['vm']) { $Config.vm } else { $null }
    $get = { param($n, $d) if ($vm -and $vm.PSObject.Properties[$n] -and $null -ne $vm.$n -and '' -ne [string]$vm.$n) { $vm.$n } else { $d } }
    $name = [string](& $get 'name' ('TempDesk ' + [string]$Config.server.computerName))
    if (-not (Test-TdVmName $name)) { throw 'Virtual machine name: letters, numbers, space, dot, dash or underscore (1 to 63).' }
    $iso = [string](& $get 'windowsIso' '')
    if (-not $iso) { throw 'Choose the Windows Server ISO file.' }
    $folder = [string](& $get 'folder' '')
    if (-not $folder) { $folder = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Virtual Machines' }
    $cpus = 0; $mem = 0; $disk = 0
    if (-not [int]::TryParse([string](& $get 'cpus' 2), [ref]$cpus) -or $cpus -lt 1 -or $cpus -gt 64) { throw 'Processors: a number from 1 to 64.' }
    if (-not [int]::TryParse([string](& $get 'memoryMb' 4096), [ref]$mem) -or $mem -lt 2048 -or $mem -gt 1048576) { throw 'Memory: at least 2048 MB.' }
    if (-not [int]::TryParse([string](& $get 'diskGb' 60), [ref]$disk) -or $disk -lt 40 -or $disk -gt 2048) { throw 'Disk: 40 to 2048 GB.' }
    $net = [string](& $get 'network' 'bridged')
    if ($net -notin @('bridged', 'nat', 'hostonly')) { throw 'Network must be bridged, nat or hostonly.' }
    $fw = if ($Config.server.PSObject.Properties['firmware'] -and [string]$Config.server.firmware -eq 'bios') { 'bios' } else { 'uefi' }
    $show = $true
    if ($vm -and $vm.PSObject.Properties['showWindow']) { $show = [bool]$vm.showWindow }
    [pscustomobject]@{
        Name = $name; WindowsIso = $iso; Folder = (Join-Path $folder $name); Cpus = $cpus; MemoryMb = $mem; DiskGb = $disk
        Network = $net; Firmware = $fw; ShowWindow = $show
    }
}

function Invoke-TdVmDeploy {
    <#
    .SYNOPSIS
        Creates the virtual machine, attaches both ISOs, starts it and gets it past the
        "Press any key to boot from CD or DVD" prompt. Windows Setup then runs unattended.
    #>
    param([Parameter(Mandatory)] $Config, [Parameter(Mandatory)][string] $Directory, [string] $KitIso = '')
    $s = Get-TdVmSettings -Config $Config
    if (-not $KitIso) { $KitIso = Join-Path $Directory 'media\TempDesk-answer.iso' }
    $vmx = Join-Path $s.Folder ($s.Name + '.vmx')
    $diskName = $s.Name + '.vmdk'

    Invoke-TdStep -Id 'vmware' -Title 'Find VMware Workstation' -Always -Hint 'Install VMware Workstation Pro on this PC, then try again.' -Action {
        $script:VmTools = Get-TdVmwareTools
        Write-TdLog ('VMware Workstation: ' + $script:VmTools.Root)
    }
    Invoke-TdStep -Id 'vmmedia' -Title 'Check the Windows ISO and the answer ISO' -Always -Hint 'Choose the Windows Server 2025 ISO file, and build the install media (step 1) so the answer ISO exists.' -Action {
        if (-not (Test-Path -LiteralPath $s.WindowsIso -PathType Leaf)) { throw "The Windows ISO was not found: $($s.WindowsIso)" }
        if ([IO.Path]::GetExtension($s.WindowsIso) -ine '.iso') { throw 'The Windows installer must be an .iso file.' }
        if (-not (Test-Path -LiteralPath $KitIso -PathType Leaf)) { throw 'The TempDesk answer ISO is missing. Build the install media first.' }
    }
    Invoke-TdStep -Id 'vmcreate' -Title 'Create the virtual machine' -Always -Hint 'Choose another virtual machine name, or delete the old virtual machine in VMware first.' -Action {
        if (Test-Path -LiteralPath $vmx) {
            Write-TdLog 'The virtual machine already exists: using it as it is.'
            return
        }
        if ((Test-Path -LiteralPath $s.Folder) -and @(Get-ChildItem -LiteralPath $s.Folder -Force).Count) {
            throw "The folder $($s.Folder) already has files in it that are not this virtual machine."
        }
        New-Item -ItemType Directory -Force -Path $s.Folder | Out-Null
        $adapter = if ($s.Firmware -eq 'bios') { 'lsilogic' } else { 'nvme' }
        $r = Invoke-TdVmTool -Exe $script:VmTools.DiskManager -Arguments @('-c', '-s', ('{0}GB' -f $s.DiskGb), '-a', $adapter, '-t', '0', (Join-Path $s.Folder $diskName)) -TimeoutSec 300
        if ($r.ExitCode -ne 0) { throw ('The virtual disk could not be created: ' + $r.Output) }
        $text = New-TdVmwareVmx -Name $s.Name -DiskFile $diskName -WindowsIso $s.WindowsIso -KitIso $KitIso -Firmware $s.Firmware -Cpus $s.Cpus -MemoryMb $s.MemoryMb -Network $s.Network
        Write-TdUtf8File -Path $vmx -Text $text
        Write-TdLog ('Created ' + $vmx)
    }
    Invoke-TdStep -Id 'vmstart' -Title 'Start the virtual machine and boot the Windows installer' -Always -Hint 'Open the virtual machine in VMware Workstation, power it on and press a key when it says "Press any key to boot from CD or DVD".' -Action {
        if (Test-TdVmRunning -Tools $script:VmTools -Vmx $vmx) {
            Write-TdLog 'The virtual machine is already running.'
            return
        }
        $mode = if ($s.ShowWindow) { 'gui' } else { 'nogui' }
        $r = Invoke-TdVmTool -Exe $script:VmTools.Vmrun -Arguments @('-T', 'ws', 'start', $vmx, $mode) -TimeoutSec 180
        if ($r.ExitCode -ne 0) { throw ('VMware could not start the virtual machine: ' + $r.Output) }
        if (-not $script:VmTools.Vmcli) {
            Write-TdLog -Level warn -Text 'This VMware version has no vmcli.exe: press a key in the virtual machine window when it says "Press any key to boot from CD or DVD".'
            return
        }
        # The Windows ISO waits about five seconds for a key before it gives up. Press the space bar
        # (sendKeySequence: on current VMware builds sendKeyEvent is accepted but types nothing).
        # for a short while, and stop well before Windows Setup shows its own buttons.
        $until = (Get-Date).AddSeconds(14)
        $sent = 0
        while ((Get-Date) -lt $until) {
            $k = Invoke-TdVmTool -Exe $script:VmTools.Vmcli -Arguments @($vmx, 'MKS', 'sendKeySequence', ' ') -TimeoutSec 20
            if ($k.ExitCode -eq 0) { $sent++ }
            Start-Sleep -Milliseconds 400
        }
        if (-not $sent) { Write-TdLog -Level warn -Text 'The key press could not be sent: press a key in the virtual machine window if it waits at "Press any key to boot from CD or DVD".' }
        else { Write-TdLog 'Pressed a key for the Windows installer boot prompt.' }
    }
    [pscustomobject]@{ Vmx = $vmx; Name = $s.Name; Folder = $s.Folder }
}

function Save-TdVmScreenshot {
    <# Saves a picture of the virtual machine's screen (needs vmcli.exe). Returns the path or ''. #>
    param([Parameter(Mandatory)][string] $Vmx, [Parameter(Mandatory)][string] $Path)
    $tools = Get-TdVmwareTools
    if (-not $tools.Vmcli) { return '' }
    $r = Invoke-TdVmTool -Exe $tools.Vmcli -Arguments @($Vmx, 'MKS', 'captureScreenshot', $Path) -TimeoutSec 30
    if ($r.ExitCode -eq 0 -and (Test-Path -LiteralPath $Path)) { $Path } else { '' }
}

Export-ModuleMember -Function Get-TdVmwareTools, Test-TdVmName, New-TdVmwareVmx, Invoke-TdVmTool, Test-TdVmRunning, Get-TdVmSettings, Invoke-TdVmDeploy, Save-TdVmScreenshot
