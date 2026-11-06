<#
Builds outputs\GiroTrack-Setup.zip on this PC: the app and Node.js, with no data or keys.
Run on 64-bit Windows, after pnpm install.
#>
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $root
# Staged outside the project: Vite's dev server watches it and crashes on these files.
$stage = Join-Path $env:TEMP 'GiroTrack-Setup'
$zip = Join-Path $root 'outputs\GiroTrack-Setup.zip'

function Copy-Tree($from, $to) {
    robocopy $from $to /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not copy $from (robocopy code $LASTEXITCODE)." }
}

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force "$stage\app\scripts", "$stage\app\lib", "$stage\runtime", (Split-Path $zip) | Out-Null

try {
    Write-Host 'Building GiroTrack'
    & node scripts\build-app.mjs
    if ($LASTEXITCODE) { throw 'The build failed.' }

    Write-Host 'Copying the app'
    Copy-Tree dist "$stage\app\dist"
    foreach ($file in 'windows-server', 'start-server', 'init-local', 'secrets-file', 'sites-env', 'tool-environment') {
        Copy-Item "scripts\$file.mjs" "$stage\app\scripts"
    }
    Copy-Item lib\vault.mjs, lib\public-origin.mjs "$stage\app\lib"
    Copy-Item wrangler.local.json "$stage\app"

    # Only Wrangler is needed at runtime; the app itself is already bundled in dist.
    # npm's flat node_modules also survives zipping, unlike pnpm's links.
    $wrangler = (Get-Content package.json -Raw | ConvertFrom-Json).devDependencies.wrangler
    $manifest = [ordered]@{ name = 'girotrack-server'; private = $true; type = 'module'; dependencies = @{ wrangler = $wrangler } } | ConvertTo-Json
    [IO.File]::WriteAllText("$stage\app\package.json", $manifest, (New-Object Text.UTF8Encoding $false))
    Push-Location "$stage\app"
    try {
        & npm.cmd install --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE) { throw 'Installing the runtime failed.' }
    } finally { Pop-Location }

    Write-Host 'Copying Node.js'
    Copy-Item (Get-Command node).Source "$stage\runtime\node.exe"

    Copy-Item "$PSScriptRoot\Install.cmd", "$PSScriptRoot\Install-GiroTrack.ps1", "$PSScriptRoot\Uninstall-GiroTrack.ps1", "$PSScriptRoot\Check-Server.cmd", "$PSScriptRoot\Check-Server.ps1", "$PSScriptRoot\README.txt" $stage

    Write-Host 'Compressing'
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)
} finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}
Write-Host "Built $zip ($([math]::Round((Get-Item $zip).Length / 1MB)) MB)"
