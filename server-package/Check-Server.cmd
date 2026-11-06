@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Check-Server.ps1" %*
pause
