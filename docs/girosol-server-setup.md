# Running GiroTrack on the Girosol server

Employees open GiroTrack from their own computers at an HTTPS address such as
`https://girotrack.girosol.local`. On the server, IIS answers that address and
passes requests to GiroTrack, which listens only on the server itself
(`127.0.0.1`). Nothing goes to Cloudflare or any other outside service.

```
Employee PCs ──HTTPS──▶ IIS on the server ──▶ GiroTrack on 127.0.0.1:8788
                                              ├─ C:\GiroTrack\.wrangler\state           database + uploaded files
                                              └─ C:\ProgramData\GiroTrack\secrets.env   encryption key and settings
```

GiroTrack runs on Cloudflare's local runtime (Wrangler), the same one used in
development. It suits a small internal team; see "Later" at the end.

## What you need on the server

- Windows Server with IIS, plus the **URL Rewrite** and **Application Request
  Routing (ARR)** modules (free downloads from Microsoft).
- **Node.js 22.13 or newer** and **pnpm 11** (`npm install -g pnpm@11`).
- An internal name for GiroTrack (DNS), e.g. `girotrack.girosol.local`, and a
  certificate for it that employee PCs trust.
- A Windows account to run GiroTrack as, e.g. `svc-girotrack` (not an admin).
- `C:\GiroTrack` for the app, outside any shared drive.

## 1. Install GiroTrack

In `C:\GiroTrack` (a copy of the GitHub repository), as administrator:

```powershell
New-Item -ItemType Directory C:\ProgramData\GiroTrack
$env:GIROTRACK_SECRETS_FILE = 'C:\ProgramData\GiroTrack\secrets.env'
pnpm install
pnpm run local:setup     # empty database + a new encryption key, written straight into secrets.env
pnpm run build
```

`local:setup` only creates a key when the secrets file doesn't exist **and**
the database holds no encrypted passwords. With encrypted data present it
stops and asks for your backup instead, because a new key can't open them.

Add two settings to `C:\ProgramData\GiroTrack\secrets.env` (keep the existing
`GIROTRACK_VAULT_KEY` line):

```
GIROTRACK_PUBLIC_ORIGIN=https://girotrack.girosol.local
GIROTRACK_PROXY_SECRET=<a long random value>
```

Make the proxy secret with
`node -e "require('fs').appendFileSync('C:/ProgramData/GiroTrack/secrets.env','GIROTRACK_PROXY_SECRET='+require('crypto').randomBytes(32).toString('hex')+'\n')"`
(it writes the value without showing it), then put the same value in IIS in step 3.

What each setting does:

| Setting | Purpose |
|---|---|
| `GIROTRACK_VAULT_KEY` | Encrypts vendor portal passwords and authenticator seeds (AES-256-GCM). Required; GiroTrack refuses to start without a valid one. |
| `GIROTRACK_VAULT_KEY_ID` | The key's id (default `1`). Set by the rotation tool. |
| `GIROTRACK_VAULT_OLD_KEYS` | Older keys still needed to read older values, during a rotation. |
| `GIROTRACK_PUBLIC_ORIGIN` | The HTTPS address employees use, so sign-in and saving work behind IIS and cookies are marked Secure. |
| `GIROTRACK_PROXY_SECRET` | Lets GiroTrack trust the employee's address that IIS forwards (used for sign-in throttling). |

## 2. Lock down the secrets and data

As administrator:

```powershell
icacls C:\ProgramData\GiroTrack /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "svc-girotrack:(OI)(CI)R"
icacls C:\GiroTrack /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "svc-girotrack:(OI)(CI)M"
```

Only the service account (read) and administrators can open the key; only the
service account and administrators can open the database and uploads. The
start script passes the key to GiroTrack through its environment — it never
writes a copy into the project or build folders. Anyone who can read **both**
the key and the database can decrypt the saved portal passwords, so keep both
folders out of shares and backups readable by staff.

## 3. Run it as a service

With [NSSM](https://nssm.cc) (as administrator):

```powershell
nssm install GiroTrack "C:\Program Files\nodejs\node.exe" scripts\start-server.mjs
nssm set GiroTrack AppDirectory C:\GiroTrack
nssm set GiroTrack AppEnvironmentExtra GIROTRACK_PORT=8788 GIROTRACK_SECRETS_FILE=C:\ProgramData\GiroTrack\secrets.env
nssm set GiroTrack ObjectName .\svc-girotrack <password>
nssm set GiroTrack AppStdout C:\GiroTrack\logs\girotrack.txt
nssm set GiroTrack AppStderr C:\GiroTrack\logs\girotrack.txt
nssm set GiroTrack AppRotateFiles 1
nssm set GiroTrack AppRotateBytes 10485760
nssm start GiroTrack
```

It starts with the server and restarts if it stops. If the key is missing or
malformed it doesn't start and the log says why (without printing the key).

## 4. Put IIS in front

1. IIS Manager › server › **Application Request Routing Cache** › Server Proxy
   Settings: tick **Enable proxy** (leave "Preserve client IP in
   X-Forwarded-For" ticked).
2. IIS Manager › server › **URL Rewrite** › View Server Variables: add
   `HTTP_X_GIROTRACK_PROXY`.
3. Create a site `GiroTrack` with an **https** binding for
   `girotrack.girosol.local` and its certificate. Its folder can be an empty
   one such as `C:\inetpub\girotrack` (not `C:\GiroTrack`).
4. Put this `web.config` in that folder, with your proxy secret:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="GiroTrack" stopProcessing="true">
          <match url="(.*)" />
          <serverVariables>
            <!-- The same value as GIROTRACK_PROXY_SECRET; replaces anything a browser sends. -->
            <set name="HTTP_X_GIROTRACK_PROXY" value="PASTE-THE-PROXY-SECRET-HERE" />
          </serverVariables>
          <action type="Rewrite" url="http://127.0.0.1:8788/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <security>
      <!-- Uploads are up to 15 MB. -->
      <requestFiltering><requestLimits maxAllowedContentLength="20971520" /></requestFiltering>
    </security>
    <httpProtocol>
      <customHeaders>
        <add name="Strict-Transport-Security" value="max-age=31536000" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

   Restrict that folder like the others (it contains the proxy secret):
   `icacls C:\inetpub\girotrack /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "IIS_IUSRS:(OI)(CI)R"`.
5. Don't add a plain `http` binding. Don't open port 8788 in the firewall —
   GiroTrack only listens on `127.0.0.1` anyway.
6. Open `https://girotrack.girosol.local` from an employee PC and create the
   first account; it becomes the **Manager**, who adds everyone else. Delete
   the sample records (FPL - Lights, Willow Properties …) before real use.

## How sign-in works

- **Passwords** are stored as salted scrypt hashes (N = 2^15, r = 8, p = 3,
  16-byte random salt, 32-byte output, constant-time comparison) — never in a
  readable form. Older PBKDF2 hashes are upgraded to scrypt at the next
  sign-in. Nobody, including the Manager, can see an employee's password; the
  Manager can only set a new one.
- **Lockout:** 10 failed passwords for an account lock it for 15 minutes, from
  any browser or computer; the 10th failure starts it, and attempts during the
  lockout (even with the right password) are refused without extending it.
  A successful sign-in before that resets the count. The count is stored in
  the database, so restarting GiroTrack doesn't clear it. To unlock someone
  early, the Manager resets their password.
- **Per computer:** 100 failed sign-ins from one employee address in 15
  minutes block that address for 15 minutes, on top of the per-account
  lockout. This uses the address IIS forwards, so it needs the proxy secret
  set up in step 4 (without it, all requests count as one address).
- **Authenticator codes** (password recovery and setup) have their own limit:
  5 per 15 minutes per account.
- **Tabs:** each browser tab signs in on its own. Reloading the tab and moving
  around GiroTrack keep it signed in; a new tab, "Reopen closed tab", a
  restored browser session and a duplicated tab show the sign-in screen.
  Signing out of one tab leaves your other tabs signed in. Details and limits
  are in "Tab sign-in, in detail" below.

## Vendor passwords

- Encrypted with AES-256-GCM, a fresh random 96-bit nonce for every
  encryption, and bound to their vendor (a password copied onto another vendor
  won't open). Usernames and links are shown on the vendor page as before and
  aren't encrypted.
- The password is fetched only when someone presses Copy or the eye button,
  over HTTPS, never cached, and never included in the vendor list or page.
- Every retrieval and change is recorded with the employee, vendor, action,
  time and outcome — never the password. Copy is recorded as "copied" only
  when the browser confirms the clipboard write; otherwise "retrieved for
  copying (copy not confirmed)". The vendor's Login Information window shows
  this Password history.

## Backups

Back up `C:\GiroTrack\.wrangler\state` and
`C:\ProgramData\GiroTrack\secrets.env` **together**: the database without its
key can't open saved passwords, and the key alone is useless. A nightly
scheduled task (as administrator), with GiroTrack stopped for a moment so the
database copy is consistent:

```powershell
$dest = "D:\Backups\GiroTrack\$(Get-Date -Format yyyy-MM-dd)"
nssm stop GiroTrack
robocopy C:\GiroTrack\.wrangler\state "$dest\state" /E /R:2 /W:5
Copy-Item C:\ProgramData\GiroTrack\secrets.env $dest
nssm start GiroTrack
```

`D:\Backups\GiroTrack` must be administrators-only
(`icacls D:\Backups\GiroTrack /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F"`).
Keep one copy off the server too, equally protected. Never delete the only
copy of a key that still opens data.

**Restoring** (test this once on another machine before relying on it):

```powershell
nssm stop GiroTrack
robocopy <backup>\state C:\GiroTrack\.wrangler\state /MIR
Copy-Item <backup>\secrets.env C:\ProgramData\GiroTrack\secrets.env
node scripts\vault-keys.mjs status     # every stored secret must open
nssm start GiroTrack
```

Run `vault-keys.mjs` from `C:\GiroTrack` with `GIROTRACK_SECRETS_FILE` set as
in step 1.

## Changing the encryption key (rotation)

Do this if the key may have been exposed, or on a schedule you choose. Old
data stays readable throughout; nothing is removed until it has been
verified.

```powershell
cd C:\GiroTrack
$env:GIROTRACK_SECRETS_FILE = 'C:\ProgramData\GiroTrack\secrets.env'
nssm stop GiroTrack
node scripts\vault-keys.mjs status                       # all values open
node scripts\vault-keys.mjs new-key                      # new key becomes current; old key kept for reading
nssm start GiroTrack                                     # check a vendor password opens, then:
nssm stop GiroTrack
node scripts\vault-keys.mjs reencrypt --backup D:\Backups\GiroTrack\before-rekey
node scripts\vault-keys.mjs status                       # all values now on the new key
node scripts\vault-keys.mjs drop-key --id 1              # remove the old key (refused if anything still needs it)
nssm start GiroTrack
```

`reencrypt` first copies the database and secrets file to the backup folder,
refuses to change anything if a value can't be opened, re-encrypts, then reads
every value back and compares it with the original. If it reports a failure,
restore that backup folder before starting GiroTrack. Keep the backup (it holds
the old key) protected until you're sure. The tools never print keys or
passwords.

Values saved by earlier GiroTrack versions are moved to the current format
the first time they're opened; `reencrypt` moves the rest.

## Updating GiroTrack

```powershell
nssm stop GiroTrack
# take a backup (above), then get the new code, keeping .wrangler and the secrets file
pnpm install
pnpm run build
nssm start GiroTrack
```

Never delete `.wrangler\state` or the secrets file. To roll back, put the
previous code back, build, and if needed restore the backup taken before the
update (an older version can't read values saved in the newer format).

## Tab sign-in, in detail

Every request needs two things: the browser's session cookie (HttpOnly,
SameSite=Strict, Secure, and not persistent — it's dropped when the browser
session ends) and a token belonging to that tab, sent in a request header —
never in a URL. The token lives in the tab's memory and `sessionStorage`. The
server checks both on every request, including file downloads.

- **Reload:** when a page goes away (reload, close, or leaving for another
  site) it tells the server, which then accepts its token only to resume, for
  15 seconds. The reloaded page resumes only if the browser reports the load
  as a reload, and swaps the token for a new one.
- **New tab:** no token, so the sign-in screen (the cookie alone is refused).
- **Duplicated tab:** browsers copy `sessionStorage` into the copy. The copy
  asks the other GiroTrack tabs whether one is using that token; if so it signs
  in fresh. The server also lets a token resume only once.
- **Reopen closed tab / restored session:** the load isn't a reload, so the
  page signs in fresh; and when the closing page managed to report itself, the
  server refuses its token after 15 seconds anyway.
- **While open:** each tab checks in every minute; 3 minutes without a check-in
  ends it on the server.

Known limits:

- A page that disappears without reporting (browser crash, killed process, or
  a browser that drops the final request) leaves its token valid on the
  server until 3 minutes pass. A restored copy is still sent to sign-in by the
  page itself unless the browser reports the restore as a reload — browsers
  differ here, and this was not tested in Chrome, Edge or Firefox.
- A tab the browser freezes or a computer that sleeps for more than 3 minutes
  must sign in again.
- Page scripts can read the tab token (they must send it). It's useless
  without the HttpOnly cookie and expires quickly, but script injected into
  GiroTrack could act as the signed-in person while the tab is open.
- One person per browser: signing in as someone else in the same browser
  signs the first person's tabs out.

## Later

For dependable daily use by more people, GiroTrack's server part should move
to a regular Node.js app with a SQLite file and a normal uploads folder, and
its data from one shared document into proper tables (so two people can save
at once). That's a larger project; this setup keeps working until then.
