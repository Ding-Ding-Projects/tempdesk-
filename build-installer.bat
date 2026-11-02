@echo off
rem Builds TempDesk Deployer and packages the Squirrel.Windows installer (unsigned by owner
rem decision) into deployer\output\squirrel-windows\: Setup.exe, RELEASES, the full .nupkg and a
rem delta .nupkg when a previous release exists (set TEMPDESK_REMOTE_RELEASES to the GitHub repo
rem URL to enable deltas). Usage: build-installer.bat [/s]
setlocal EnableExtensions
set "ROOT=%~dp0"
set "ARG=%~1"
call "%ROOT%build.bat" %ARG% || exit /b %ERRORLEVEL%
set "QUIET="
if /I "%ARG%"=="/s" set "QUIET=1"
if exist "%ROOT%.tools\node\node.exe" set "PATH=%ROOT%.tools\node;%PATH%"
set "CSC_LINK=" & set "WIN_CSC_LINK=" & set "CSC_KEY_PASSWORD=" & set "WIN_CSC_KEY_PASSWORD="
set "CSC_IDENTITY_AUTO_DISCOVERY=false"
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "EXTRA="
if defined TEMPDESK_REMOTE_RELEASES set "EXTRA=-c.squirrelWindows.remoteReleases=%TEMPDESK_REMOTE_RELEASES%"
if defined TEMPDESK_VERSION set "EXTRA=%EXTRA% -c.extraMetadata.version=%TEMPDESK_VERSION%"

pushd "%ROOT%deployer\app"
if not defined QUIET echo == Packaging the Squirrel.Windows installer (Squirrel 2.0.1 tools, no MSI, not signed)
rem The nuspec (id TempDeskDeployer) is generated from package.json by the packager, packed with
rem the pinned nuget.exe, then Squirrel --releasify runs with --no-msi and no signing options.
call npx electron-builder --win squirrel --x64 --publish never -c.squirrelWindows.customSquirrelVendorDir="%ROOT%.tools\squirrel" %EXTRA%
if errorlevel 1 (set "CODE=%ERRORLEVEL%" & popd & echo ERROR: packaging failed. & exit /b 4)
popd

set "OUT=%ROOT%deployer\output\squirrel-windows"
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $o='%OUT%';" ^
  "$setup = Get-ChildItem -LiteralPath $o -Filter '*Setup*.exe' | Select-Object -First 1; if (-not $setup) { throw 'Setup.exe was not produced.' }" ^
  "Copy-Item $setup.FullName (Join-Path $o 'Setup.exe') -Force;" ^
  "if (-not (Test-Path (Join-Path $o 'RELEASES'))) { throw 'RELEASES was not produced.' }" ^
  "if (-not (Get-ChildItem -LiteralPath $o -Filter '*-full.nupkg')) { throw 'The full .nupkg was not produced.' }" ^
  "$sig = Get-AuthenticodeSignature -LiteralPath (Join-Path $o 'Setup.exe');" ^
  "if ($sig.Status -ne 'NotSigned') { throw ('Setup.exe must be unsigned (owner decision) but reports ' + $sig.Status) }" ^
  "Write-Host ('Setup.exe signature status: ' + $sig.Status + ' (expected NotSigned)');" ^
  "Get-ChildItem -LiteralPath $o | Format-Table Name, Length -AutoSize | Out-String | Write-Host"
if errorlevel 1 (echo ERROR: installer verification failed. & exit /b 5)
if not defined QUIET echo Installer ready in %OUT%
exit /b 0
