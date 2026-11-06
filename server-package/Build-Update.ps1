<#
Builds outputs\GiroTrack-Update.zip on this PC: only the built app and the update script,
with no data or keys. For changes to the app itself. A change to Node.js, Wrangler or
the scripts in app\scripts needs the full zip from Build-Installer.ps1.
#>
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $root
$stage = Join-Path $env:TEMP 'GiroTrack-Update'
$zip = Join-Path $root 'outputs\GiroTrack-Update.zip'

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force $stage, (Split-Path $zip) | Out-Null
try {
    & node scripts\build-app.mjs
    if ($LASTEXITCODE) { throw 'The build failed.' }
    robocopy dist "$stage\dist" /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not copy dist (robocopy code $LASTEXITCODE)." }
    Copy-Item "$PSScriptRoot\Update.cmd", "$PSScriptRoot\Update-GiroTrack.ps1" $stage
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
} finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}
Write-Host "Built $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)"
