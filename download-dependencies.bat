@echo off
setlocal EnableExtensions
set "PSModulePath="
set "QUIET="
if "%SILENT%"=="1" set "QUIET=-Silent"
if /i "%~1"=="/s" set "QUIET=-Silent"
if /i "%~1"=="--silent" set "QUIET=-Silent"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\download-dependencies.ps1" %QUIET%
exit /b %ERRORLEVEL%
