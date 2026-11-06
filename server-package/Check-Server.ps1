<#
Checks whether this Windows PC can run GiroTrack. Changes nothing, and needs no admin rights.
Run through Check-Server.cmd from the extracted package.
#>
param([int]$HttpsPort = 8443, [int]$AppPort = 8788)
$script:failed = 0

function Report([bool]$ok, [string]$name, [string]$detail) {
    if ($ok) { Write-Host "[ OK ] $name - $detail" -ForegroundColor Green }
    else { $script:failed++; Write-Host "[FAIL] $name - $detail" -ForegroundColor Red }
}

$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
Report ([Environment]::Is64BitOperatingSystem -and [int]$os.BuildNumber -ge 17763) 'Windows' "$($os.Caption), build $($os.BuildNumber) (needs 64-bit Windows 10 1809 or newer)"
Report ($PSVersionTable.PSVersion.Major -ge 5) 'PowerShell' "$($PSVersionTable.PSVersion) (needs 5 or newer)"
foreach ($module in 'ScheduledTasks', 'NetSecurity', 'PKI') {
    Report ([bool](Get-Module -ListAvailable $module)) "$module module" 'used for the startup task, firewall rule and certificate'
}
foreach ($tool in 'robocopy.exe', 'icacls.exe') {
    Report ([bool](Get-Command $tool -ErrorAction SilentlyContinue)) $tool 'used to copy files and protect the data folder'
}
foreach ($dll in 'vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll') {
    Report (Test-Path "$env:WINDIR\System32\$dll") $dll 'part of the Visual C++ runtime GiroTrack needs'
}

$free = [math]::Round((Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'").FreeSpace / 1GB, 1)
Report ($free -ge 2) 'Disk space' "$free GB free on $env:SystemDrive (needs 2 GB)"
Report ($computer.PartOfDomain) 'Domain' "$($computer.Domain) (the startup task runs as a domain account)"

foreach ($port in $HttpsPort, $AppPort) {
    $used = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    $owner = if ($used) { (Get-Process -Id $used[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName }
    Report (-not $used) "Port $port" $(if ($used) { "already used by $owner (fine if that is GiroTrack)" } else { 'free' })
}

$node = Join-Path $PSScriptRoot 'runtime\node.exe'
$workerd = Join-Path $PSScriptRoot 'app\node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe'
if ((Test-Path $node) -and (Test-Path $workerd)) {
    $version = & $node -v 2>$null
    Report ($LASTEXITCODE -eq 0) 'Bundled Node.js' $(if ($LASTEXITCODE -eq 0) { "runs, $version" } else { 'would not start' })
    $version = & $workerd --version 2>$null
    Report ($LASTEXITCODE -eq 0) 'Bundled runtime' $(if ($LASTEXITCODE -eq 0) { "runs, $version" } else { 'would not start' })
} else {
    Write-Host '[SKIP] Bundled Node.js - run this from the extracted package to test it'
}

Write-Host ''
if ($script:failed) { Write-Host "$script:failed check(s) need attention." -ForegroundColor Red }
else { Write-Host 'Everything GiroTrack needs is here.' -ForegroundColor Green }
