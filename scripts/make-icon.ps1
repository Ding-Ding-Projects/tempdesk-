<#
.SYNOPSIS
    Draws the TempDesk logo (a rounded screen with a dot, teal on near-black) with System.Drawing
    and writes a multi-size .ico (16, 24, 32, 48, 64, 128, 256 px, PNG-compressed entries) and a
    256 px PNG. The SVG version for the website is deployer/assets/tempdesk.svg (same geometry).
.EXAMPLE
    powershell -File scripts\make-icon.ps1 -Ico deployer\assets\tempdesk.ico -Png deployer\app\src\renderer\img\tempdesk.png
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string] $Ico, [string] $Png = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundRect([single] $x, [single] $y, [single] $w, [single] $h, [single] $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure(); $p
}
function New-Logo([int] $size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
    $s = $size / 256.0
    $ground = [System.Drawing.ColorTranslator]::FromHtml('#0B1110')
    $teal = [System.Drawing.ColorTranslator]::FromHtml('#7CF3E6')
    $bg = New-RoundRect 0 0 $size $size (56 * $s)
    $g.FillPath((New-Object System.Drawing.SolidBrush($ground)), $bg)
    $screen = New-RoundRect (36 * $s) (58 * $s) (184 * $s) (124 * $s) (40 * $s)
    $tb = New-Object System.Drawing.SolidBrush($teal)
    $g.FillPath($tb, $screen)
    $g.FillPath($tb, (New-RoundRect (98 * $s) (194 * $s) (60 * $s) (16 * $s) (8 * $s)))
    $g.FillEllipse((New-Object System.Drawing.SolidBrush($ground)), (98 * $s), (90 * $s), (60 * $s), (60 * $s))
    $g.Dispose()
    $bmp
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$images = foreach ($sz in $sizes) {
    $b = New-Logo $sz
    $ms = New-Object System.IO.MemoryStream
    $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    if ($sz -eq 256 -and $Png) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Png) | Out-Null; $b.Save($Png, [System.Drawing.Imaging.ImageFormat]::Png) }
    $b.Dispose()
    , $ms.ToArray()
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Ico) | Out-Null
$fs = [System.IO.File]::Create($Ico)
$w = New-Object System.IO.BinaryWriter($fs)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]; $len = $images[$i].Length
    $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz }))); $w.Write([byte]($(if ($sz -ge 256) { 0 } else { $sz })))
    $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$len); $w.Write([uint32]$offset)
    $offset += $len
}
foreach ($img in $images) { $w.Write($img) }
$w.Flush(); $fs.Dispose()
Write-Host "Wrote $Ico ($($sizes -join ', ') px)"
