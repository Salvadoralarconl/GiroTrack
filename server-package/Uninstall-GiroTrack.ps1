<#
Removes the GiroTrack program, task and firewall rule. Run as Administrator.
Data stays in the data folder (normally C:\ProgramData\GiroTrack) until you delete it.
#>
$ErrorActionPreference = 'Stop'
$installDir = $PSScriptRoot
if (Get-ScheduledTask -TaskName 'GiroTrack' -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName 'GiroTrack'
    Unregister-ScheduledTask -TaskName 'GiroTrack' -Confirm:$false
}
Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
    Where-Object { $_.ExecutablePath -like "$installDir\*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-NetFirewallRule -DisplayName 'GiroTrack' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Set-Location $env:TEMP
Remove-Item $installDir -Recurse -Force
Write-Host 'GiroTrack was removed. Its data folder was kept.'
