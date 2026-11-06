@echo off
rem Starts the GiroTrack update, asking for administrator rights if needed.
net session >nul 2>&1
if errorlevel 1 (
  powershell.exe -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update-GiroTrack.ps1" %*
pause
