<#
Updates an installed GiroTrack to the app in this patch. Run through Update.cmd as Administrator.
Only the program files change: accounts, records, uploads and the encryption key stay as they are.
The task keeps its saved sign-in, so no password is needed.
#>
param(
    [string]$InstallDir = "$env:ProgramFiles\GiroTrack",
    [string]$DataDir = "$env:ProgramData\GiroTrack",
    [switch]$NoService                # Replace files only, for testing: no task, no admin rights.
)
$ErrorActionPreference = 'Stop'
$package = $PSScriptRoot
$taskName = 'GiroTrack'

foreach ($needed in "$InstallDir\app\scripts\windows-server.mjs", "$DataDir\state", "$DataDir\secrets.env", "$DataDir\server.json") {
    if (-not (Test-Path $needed)) { throw "$needed is missing, so GiroTrack isn't installed here. Nothing was changed." }
}
if (-not (Test-Path "$package\dist\server\wrangler.json")) { throw 'Extract the whole ZIP before running the update.' }

if (-not $NoService) {
    $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Right-click Update.cmd and choose Run as administrator.'
    }
    if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) { throw 'The GiroTrack task is missing. Run Install.cmd from the full ZIP instead.' }
    Write-Host 'Stopping GiroTrack'
    Stop-ScheduledTask -TaskName $taskName
}
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
    Where-Object { $_.ExecutablePath -like "$InstallDir\*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep 2

# GiroTrack is stopped here, so this copy of the data is complete.
$backup = "$DataDir\backups\state-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Write-Host "Copying the data to $backup"
robocopy "$DataDir\state" $backup /E /NFL /NDL /NJH /NJS /NP | Out-Null
$copied = $LASTEXITCODE
if ($copied -lt 8) {
    Write-Host 'Replacing the program files'
    robocopy "$package\dist" "$InstallDir\app\dist" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    $copied = $LASTEXITCODE
}

if ($NoService) {
    if ($copied -ge 8) { throw "Copying failed (robocopy code $copied)." }
    Write-Host 'Files replaced.'
    exit 0
}

# Started again even if copying failed, so a failed update doesn't leave GiroTrack down.
Start-ScheduledTask -TaskName $taskName
if ($copied -ge 8) { throw "Copying failed (robocopy code $copied). GiroTrack was started again." }

$appPort = (Get-Content "$DataDir\server.json" -Raw | ConvertFrom-Json).appPort
$ready = $false
foreach ($attempt in 1..45) {
    Start-Sleep 2
    try {
        Invoke-WebRequest "http://127.0.0.1:$appPort/" -UseBasicParsing -TimeoutSec 5 | Out-Null
        $ready = $true
    } catch { if ($_.Exception.Response) { $ready = $true } }
    if ($ready) { break }
}
if (-not $ready) { throw "GiroTrack did not start. Check $DataDir\logs\girotrack.log. The data was copied to $backup." }
Write-Host ''
Write-Host 'GiroTrack is updated and running. Accounts and records were kept.' -ForegroundColor Green
