[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcherPath = Join-Path $repoRoot "start-yingce-local.cmd"
$iconSource = Join-Path $repoRoot "plugins\yingce\assets\icon.png"
$iconDirectory = Join-Path $repoRoot ".local\launcher"
$iconPath = Join-Path $iconDirectory "yingce.ico"
$appName = [string][char]0x5F71 + [char]0x7B56
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Programs")) ($appName + ".lnk")

if (-not (Test-Path -LiteralPath $launcherPath)) { throw "Local launcher is missing." }
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    if ($existing.Arguments -notlike "*$repoRoot*") {
        throw "A different Yingce shortcut already exists: $shortcutPath"
    }
}

New-Item -ItemType Directory -Force -Path $iconDirectory | Out-Null
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile($iconSource)
$bitmap = New-Object Drawing.Bitmap 256,256
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$png = New-Object IO.MemoryStream
try {
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $ratio = [Math]::Min(256.0 / $source.Width, 256.0 / $source.Height)
    $width = [int]($source.Width * $ratio)
    $height = [int]($source.Height * $ratio)
    $graphics.DrawImage($source, [int]((256 - $width) / 2), [int]((256 - $height) / 2), $width, $height)
    $bitmap.Save($png, [Drawing.Imaging.ImageFormat]::Png)
    $bytes = $png.ToArray()
    $writer = New-Object IO.BinaryWriter ([IO.File]::Create($iconPath))
    try {
        # One 256px PNG-backed Windows icon, preserving the existing brand artwork.
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
        $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]22)
        $writer.Write($bytes)
    } finally { $writer.Dispose() }
} finally {
    $png.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose()
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\cmd.exe"
$shortcut.Arguments = '/d /c ""' + $launcherPath + '""'
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.WindowStyle = 1
$shortcut.Description = "Yingce - start local services and browser; close terminal to stop"
$shortcut.Save()
Write-Host "Installed Start menu shortcut: $shortcutPath" -ForegroundColor Green
