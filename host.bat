@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "TEMPDESK_HOST_MODE=menu"
if not "%~2"=="" goto :usage
if "%~1"=="" goto :run
if /i "%~1"=="--detached" (
  set "TEMPDESK_HOST_MODE=detached"
  goto :run
)
if /i "%~1"=="--logs" (
  set "TEMPDESK_HOST_MODE=logs"
  goto :run
)
if /i "%~1"=="--help" (
  echo Usage: host.bat [--detached ^| --logs]
  exit /b 0
)
:usage
echo Usage: host.bat [--detached ^| --logs] 1>&2
exit /b 2
:run
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\host-portals.ps1" -Mode %TEMPDESK_HOST_MODE%
exit /b %errorlevel%
