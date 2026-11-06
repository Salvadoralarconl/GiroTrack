GiroTrack setup
===============

This installs a new, empty GiroTrack: no accounts and no records. Nothing else
needs installing: Node.js and the app are inside.

To install
----------
1. Extract the whole ZIP.
2. Optional: run Check-Server.cmd. It changes nothing.
3. Run Install.cmd and approve the administrator prompt.
4. Enter the domain account that will run GiroTrack, and its password.
5. Open the address shown at the end and create the first account. It becomes
   the Manager, so do this straight away.

Browsers warn about the certificate until it is trusted. To trust it, install
C:\ProgramData\GiroTrack\girotrack.cer under Trusted Root Certification
Authorities on employee PCs, or send it out by Group Policy.

What it changes
---------------
- Program:   C:\Program Files\GiroTrack
- Data:      C:\ProgramData\GiroTrack
- Task:      GiroTrack, which starts with Windows
- Firewall:  a rule allowing port 8443 from 172.21.0.0/16
- Power:     sleep is turned off while plugged in

To update
---------
Run Install.cmd from a newer ZIP. Existing data and the key are never replaced,
and a copy of the data goes to C:\ProgramData\GiroTrack\backups first.

If the account's password changes, run Install.cmd again, or GiroTrack won't
start after the next restart.

Back up these together
----------------------
C:\ProgramData\GiroTrack\state
C:\ProgramData\GiroTrack\secrets.env

Without the key file, saved vendor passwords can't be opened.

If something goes wrong
-----------------------
Log: C:\ProgramData\GiroTrack\logs\girotrack.log

To remove GiroTrack, run C:\Program Files\GiroTrack\Uninstall-GiroTrack.ps1 as
administrator. The data folder is kept.
