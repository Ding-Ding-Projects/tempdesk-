@echo off
rem Builds TempDesk Deployer (the desktop app) into deployer\bin\ as an unpacked app and a
rem portable .exe. Usage: build.bat [/s]   /s = silent (errors only). Exit code 0 on success.
setlocal EnableExtensions
set "ROOT=%~dp0"
set "QUIET="
if /I "%~1"=="/s" set "QUIET=1"
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "LOG=%ROOT%deployer\bin\build.log"
if not exist "%ROOT%deployer\bin" mkdir "%ROOT%deployer\bin"
if exist "%LOG%" del "%LOG%"

rem Code signing is prohibited: make sure no certificate reaches the packager.
set "CSC_LINK=" & set "WIN_CSC_LINK=" & set "CSC_KEY_PASSWORD=" & set "WIN_CSC_KEY_PASSWORD="
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

set "CMD="%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\download-dependencies.ps1" -Silent"
call :step "Downloading build tools" || goto :fail
if exist "%ROOT%.tools\node\node.exe" set "PATH=%ROOT%.tools\node;%PATH%"
where node >nul 2>&1 || (echo ERROR: Node.js was not found after download.& exit /b 3)

set "CMD="%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\make-icon.ps1" -Ico "%ROOT%deployer\assets\tempdesk.ico" -Png "%ROOT%deployer\app\src\renderer\img\tempdesk.png""
call :step "Generating the app icon" || goto :fail
set "CMD="%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\check-powershell.ps1""
call :step "Checking PowerShell syntax" || goto :fail

pushd "%ROOT%deployer\app"
set "CMD=cmd /c npm ci --no-audit --no-fund"
call :step "Installing packages (npm ci)" || (popd & goto :fail)
set "CMD=cmd /c node scripts\prepare-bundle.js"
call :step "Bundling shared modules" || (popd & goto :fail)
set "CMD=cmd /c node scripts\check-syntax.js"
call :step "Checking JavaScript syntax" || (popd & goto :fail)
set "CMD=cmd /c node --test test/*.test.js"
call :step "Running unit tests" || (popd & goto :fail)
set "CMD=cmd /c npx electron-builder --win dir portable --x64 --publish never -c.directories.output=..\bin"
call :step "Packaging (unpacked + portable)" || (popd & goto :fail)
popd
if not defined QUIET echo Build finished: %ROOT%deployer\bin
exit /b 0

:step
rem Runs %CMD%; in silent mode its output goes to the log file instead of the console.
if not defined QUIET echo == %~1
if defined QUIET (
  %CMD% >>"%LOG%" 2>&1
) else (
  %CMD%
)
exit /b %ERRORLEVEL%

:fail
set "CODE=%ERRORLEVEL%"
if "%CODE%"=="0" set "CODE=1"
echo ERROR: build failed with exit code %CODE%. See the output above or %LOG%.
if defined QUIET if exist "%LOG%" powershell -NoProfile -Command "Get-Content -LiteralPath '%LOG%' -Tail 40"
exit /b %CODE%
