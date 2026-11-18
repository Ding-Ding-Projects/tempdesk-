@echo off
rem Builds TempDesk Deployer and packages the Squirrel.Windows installer (unsigned by owner
rem decision) into deployer\output\squirrel-windows\: Setup.exe, RELEASES, the full .nupkg and a
rem delta .nupkg when a previous release exists (set TEMPDESK_REMOTE_RELEASES to the GitHub repo
rem URL to enable deltas). Usage: build-installer.bat [/s]
setlocal EnableExtensions
set "ROOT=%~dp0"
set "QUIET="
set "SKIPTESTS="
if "%SILENT%"=="1" set "QUIET=/s"
:installerargs
if "%~1"=="" goto :build
if /I "%~1"=="/s" (set "QUIET=/s"& goto :next)
if /I "%~1"=="--silent" (set "QUIET=/s"& goto :next)
if /I "%~1"=="--skip-tests" (set "SKIPTESTS=--skip-tests"& goto :next)
echo Unknown installer option.
exit /b 2
:next
shift
goto :installerargs
:build
call "%ROOT%build.bat" %QUIET% %SKIPTESTS%
if errorlevel 1 exit /b %ERRORLEVEL%
if exist "%ROOT%.tools\git\cmd\git.exe" set "PATH=%ROOT%.tools\git\cmd;%PATH%"
if exist "%ROOT%.tools\node\node.exe" set "PATH=%ROOT%.tools\node;%PATH%"
set "CSC_LINK=" & set "WIN_CSC_LINK=" & set "CSC_KEY_PASSWORD=" & set "WIN_CSC_KEY_PASSWORD="
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
rem Started from PowerShell 7, the inherited module path breaks Windows PowerShell 5.1 (Get-FileHash goes missing).
set "PSModulePath="
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\package-installer.ps1"
exit /b %ERRORLEVEL%
