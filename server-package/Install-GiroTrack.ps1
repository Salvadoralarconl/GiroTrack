<#
Installs GiroTrack on a Windows PC. Run through Install.cmd as Administrator.
Running it again upgrades the program. Existing data and the encryption key are never replaced.
No secret is printed.
#>
param(
    [string]$InstallDir = "$env:ProgramFiles\GiroTrack",
    [string]$DataDir = "$env:ProgramData\GiroTrack",
    [int]$HttpsPort = 8443,
    [int]$AppPort = 8788,
    [string]$HostName,                # The address people open. Default: this PC's full name.
    [string]$AllowFrom = '172.21.0.0/16',
    [string]$ServiceAccount,          # DOMAIN\user that runs GiroTrack.
    [switch]$NoService                # Copy files only: no task, firewall rule or admin rights.
)
$ErrorActionPreference = 'Stop'
$package = $PSScriptRoot
$taskName = 'GiroTrack'
$defaultAccount = 'GIROSOL\Salarcon'
$secretsFile = "$DataDir\secrets.env"
$pfxFile = "$DataDir\girotrack.pfx"

function Write-TextFile($path, $text) {
    # UTF-8 without a BOM: a BOM would corrupt the first line of the secrets file.
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))
}

function New-RandomHex {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Set-Secret([string]$text, [string]$name, [string]$value) {
    if ($text -match "(?m)^$name=") { return [regex]::Replace($text, "(?m)^$name=.*$", "$name=$value") }
    $text.TrimEnd() + "`n$name=$value`n"
}

function Get-Secret([string]$text, [string]$name) {
    $found = [regex]::Match($text, "(?m)^$name=(\S+)")
    if ($found.Success) { $found.Groups[1].Value }
}

function Resolve-Account([string]$name) {
    # Accepts user, DOMAIN\user, .\user or user@domain, and returns the full DOMAIN\user name.
    $name = $name.Trim()
    if ($name -like '.\*') { $name = "$env:COMPUTERNAME\$($name.Substring(2))" }
    $names = @($name)
    if ($name -and $name -notmatch '[\\@]') {
        $computer = Get-CimInstance Win32_ComputerSystem
        if ($computer.PartOfDomain) { $names = @("$($computer.Domain.Split('.')[0])\$name", $name) }
    }
    foreach ($candidate in $names) {
        try {
            $sid = (New-Object Security.Principal.NTAccount($candidate)).Translate([Security.Principal.SecurityIdentifier])
            $full = $sid.Translate([Security.Principal.NTAccount]).Value
            # A bare domain name also resolves, but it is not an account that can sign in.
            if ($full -match '\\.+$') { return $full }
        } catch {}
    }
    return $null
}

function Test-ServiceLogon([string]$account, [string]$secret) {
    # A batch logon is how the task will sign in, so this checks the same thing the task needs.
    if (-not ('GiroLogon' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GiroLogon {
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool LogonUser(string user, string domain, string password, int type, int provider, out IntPtr token);
    [DllImport("kernel32.dll")]
    public static extern bool CloseHandle(IntPtr handle);
    public static int Check(string user, string domain, string password) {
        IntPtr token;
        if (!LogonUser(user, domain, password, 4, 0, out token)) return Marshal.GetLastWin32Error();
        CloseHandle(token);
        return 0;
    }
}
'@
    }
    $domain, $user = $account -split '\\', 2
    [GiroLogon]::Check($user, $domain, $secret)
}

function Get-ServiceLogin([string]$account) {
    # Three tries at most, so a mistyped password cannot lock the account.
    foreach ($attempt in 1..3) {
        if (-not $account) {
            $account = Read-Host "Account that will run GiroTrack [$defaultAccount]"
            if (-not $account) { $account = $defaultAccount }
        }
        $resolved = Resolve-Account $account
        if (-not $resolved) {
            Write-Warning "Windows cannot find the account '$account'. Enter it as DOMAIN\user."
            $account = ''
            continue
        }
        $secure = Read-Host "Password for $resolved" -AsSecureString
        $secret = (New-Object Net.NetworkCredential('', $secure)).Password
        if (-not $secret) {
            Write-Warning 'The password was empty. Characters do not appear while you type, so type it and press Enter.'
            continue
        }
        $code = Test-ServiceLogon $resolved $secret
        if ($code -eq 0 -or $code -eq 1385) {
            if ($code -eq 1385) {
                Write-Warning "$resolved is missing 'Log on as a batch job'. If GiroTrack does not start, add it in Local Security Policy."
            }
            return @{ Account = $resolved; Password = $secret }
        }
        if ($code -eq 1326) {
            Write-Warning "That password is not correct for $resolved."
            continue
        }
        throw "Windows refused $resolved : $((New-Object ComponentModel.Win32Exception($code)).Message)"
    }
    throw 'Too many tries, so nothing was changed. Run Install.cmd again.'
}

function Stop-GiroTrack {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName }
    Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='workerd.exe'" |
        Where-Object { $_.ExecutablePath -like "$InstallDir\*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep 2
}

function Assert-PortFree([int]$port) {
    $used = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($used) { throw "Port $port is already used by $((Get-Process -Id $used.OwningProcess).ProcessName). Run the installer again with another port." }
}

foreach ($needed in 'runtime\node.exe', 'app\scripts\windows-server.mjs', 'app\dist\server\wrangler.json') {
    if (-not (Test-Path "$package\$needed")) { throw "$needed is missing. Extract the whole ZIP before running the installer." }
}

# A database with the wrong key would leave saved passwords unreadable, so a new key is only for a new database.
$hasState = Test-Path "$DataDir\state"
$hasSecrets = Test-Path $secretsFile
if ($hasState -ne $hasSecrets) {
    throw "$DataDir has only one of state and secrets.env. Restore the missing one from your backup. Nothing was changed."
}

if (-not $NoService) {
    $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Right-click Install.cmd and choose Run as administrator.'
    }
    $login = Get-ServiceLogin $ServiceAccount
    $ServiceAccount = $login.Account
    Write-Host "Signed in as $ServiceAccount."
    Stop-GiroTrack
    Assert-PortFree $HttpsPort
    Assert-PortFree $AppPort
}

if (-not $HostName) {
    $computer = Get-CimInstance Win32_ComputerSystem
    $HostName = if ($computer.PartOfDomain) { "$env:COMPUTERNAME.$($computer.Domain)" } else { $env:COMPUTERNAME }
}
$HostName = $HostName.Trim().ToLowerInvariant()
$origin = if ($HttpsPort -eq 443) { "https://$HostName" } else { "https://${HostName}:$HttpsPort" }

Get-ChildItem $package -Recurse -File -Include *.exe, *.ps1 | Unblock-File

Write-Host "Copying program to $InstallDir"
foreach ($folder in 'runtime', 'app') {
    robocopy "$package\$folder" "$InstallDir\$folder" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not copy $folder (robocopy code $LASTEXITCODE)." }
}
Copy-Item "$package\Uninstall-GiroTrack.ps1" $InstallDir -Force
$node = "$InstallDir\runtime\node.exe"

& "$InstallDir\app\node_modules\@cloudflare\workerd-windows-64\bin\workerd.exe" --version | Out-Null
if ($LASTEXITCODE) { throw 'The bundled runtime would not start. Run Check-Server.cmd to see what is missing.' }

New-Item -ItemType Directory -Force $DataDir | Out-Null
if (-not $NoService) {
    # Passwords and records live here, so only the task account and admins may open it.
    icacls $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "${ServiceAccount}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE) { throw "Could not give $ServiceAccount access to $DataDir." }
    # The local runtime writes its working files beside the app.
    icacls "$InstallDir\app" /grant "${ServiceAccount}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE) { throw "Could not give $ServiceAccount access to $InstallDir\app." }
}

if ($hasState) {
    $backup = "$DataDir\backups\state-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Write-Host "Keeping the existing data. Copying it to $backup first."
    robocopy "$DataDir\state" $backup /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Could not back up the data (robocopy code $LASTEXITCODE). Nothing was changed." }
} else {
    Write-Host 'Starting with an empty GiroTrack.'
    $env:GIROTRACK_EMPTY_WORKSPACE = '1'
}

Write-Host 'Preparing the database'
$env:GIROTRACK_LOCAL_STATE = "$DataDir\state"
$env:GIROTRACK_SECRETS_FILE = $secretsFile
Push-Location "$InstallDir\app"
try {
    # Keeps existing records and never replaces an existing key.
    & $node scripts\init-local.mjs | Out-Null
    if ($LASTEXITCODE) { throw 'Preparing the database failed.' }
} finally { Pop-Location }

$secrets = [IO.File]::ReadAllText($secretsFile)
$secrets = Set-Secret $secrets 'GIROTRACK_PUBLIC_ORIGIN' $origin
if (-not (Get-Secret $secrets 'GIROTRACK_PROXY_SECRET')) { $secrets = Set-Secret $secrets 'GIROTRACK_PROXY_SECRET' (New-RandomHex) }
$passphrase = Get-Secret $secrets 'GIROTRACK_TLS_PASSPHRASE'

$names = @($HostName, $env:COMPUTERNAME.ToLowerInvariant(), 'localhost') +
    @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress })
$names = @($names | Select-Object -Unique)
$savedNames = if (Test-Path "$DataDir\server.json") { (Get-Content "$DataDir\server.json" -Raw | ConvertFrom-Json).certificateNames }
if (-not (Test-Path $pfxFile) -or -not $passphrase -or (($savedNames -join ',') -ne ($names -join ','))) {
    Write-Host 'Creating the HTTPS certificate'
    if (-not $passphrase) {
        $passphrase = New-RandomHex
        $secrets = Set-Secret $secrets 'GIROTRACK_TLS_PASSPHRASE' $passphrase
    }
    $sans = ($names | ForEach-Object { if ($_ -match '^[\d.]+$') { "IPAddress=$_" } else { "DNS=$_" } }) -join '&'
    $cert = New-SelfSignedCertificate -Subject "CN=$HostName" -TextExtension @("2.5.29.17={text}$sans") -CertStoreLocation Cert:\CurrentUser\My `
        -FriendlyName 'GiroTrack' -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(10)
    $password = ConvertTo-SecureString $passphrase -AsPlainText -Force
    Export-PfxCertificate -Cert $cert -FilePath $pfxFile -Password $password | Out-Null
    Export-Certificate -Cert $cert -FilePath "$DataDir\girotrack.cer" | Out-Null
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -DeleteKey
}
Write-TextFile $secretsFile $secrets
Write-TextFile "$DataDir\server.json" (@{ httpsPort = $HttpsPort; appPort = $AppPort; certificateNames = $names } | ConvertTo-Json)

if ($NoService) {
    Write-Host 'Files copied. No task or firewall rule was created.'
    exit 0
}

# A desktop edition sleeps by default, which would take GiroTrack down for everyone.
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0

$action = New-ScheduledTaskAction -Execute $node -Argument "scripts\windows-server.mjs `"$DataDir`"" -WorkingDirectory "$InstallDir\app"
$trigger = New-ScheduledTaskTrigger -AtStartup
$options = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $options `
    -User $ServiceAccount -Password $login.Password -RunLevel Limited -Force | Out-Null
$login.Password = $null

Get-NetFirewallRule -DisplayName $taskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $taskName -Direction Inbound -Action Allow -Protocol TCP `
    -LocalPort $HttpsPort -RemoteAddress $AllowFrom -Profile Domain, Private | Out-Null

Start-ScheduledTask -TaskName $taskName
$ready = $false
foreach ($attempt in 1..45) {
    Start-Sleep 2
    try {
        Invoke-WebRequest "http://127.0.0.1:$AppPort/" -UseBasicParsing -TimeoutSec 5 | Out-Null
        $ready = $true
    } catch { if ($_.Exception.Response) { $ready = $true } }
    if ($ready) { break }
}
if (-not $ready) { throw "GiroTrack did not start. Check $DataDir\logs\girotrack.log and the GiroTrack task in Task Scheduler." }

Write-Host ''
Write-Host "GiroTrack is running. Open $origin" -ForegroundColor Green
Write-Host "Browsers warn about the certificate until $DataDir\girotrack.cer is trusted on employee PCs."
if (-not $hasState) { Write-Host 'Open it now and create the first account. It becomes the Manager.' -ForegroundColor Yellow }
