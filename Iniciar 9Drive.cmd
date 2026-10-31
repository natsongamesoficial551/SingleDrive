@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-9drive.ps1"
if errorlevel 1 pause
