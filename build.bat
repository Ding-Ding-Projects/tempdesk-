@echo off
rem Builds TempDesk Deployer (the desktop app) into deployer\bin\ as an unpacked app and a
rem portable .exe, plus the standalone documentation in deployer\bin\docs\.
rem Usage: build.bat [/docs] [/s]   /docs = documentation only, /s = silent.
setlocal EnableExtensions
set "ROOT=%~dp0"
set "QUIET="
set "DOCSONLY="
set "BUILDCOMPANION="
set "RUNAPP="
set "SKIPTESTS="
if "%SILENT%"=="1" set "QUIET=1"
:args
if "%~1"=="" goto :parsed
if /I "%~1"=="/docs" (set "DOCSONLY=1"& goto :nextarg)
if /I "%~1"=="--build-companion" (set "BUILDCOMPANION=1"& goto :nextarg)
if /I "%~1"=="--run" (set "RUNAPP=1"& goto :nextarg)
if /I "%~1"=="--skip-tests" (set "SKIPTESTS=1"& goto :nextarg)
if /I "%~1"=="/s" (set "QUIET=1"& goto :nextarg)
if /I "%~1"=="--silent" (set "QUIET=1"& goto :nextarg)
echo Unknown build option.
exit /b 2
:nextarg
shift
goto :args
:parsed
if defined BUILDCOMPANION if defined RUNAPP (echo Choose one build action.& exit /b 2)
if defined BUILDCOMPANION if defined DOCSONLY (echo Choose one companion.& exit /b 2)
if defined RUNAPP if defined DOCSONLY (echo --run requires a desktop build.& exit /b 2)
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
rem Started from PowerShell 7, the inherited module path breaks Windows PowerShell 5.1 (Get-FileHash goes missing).
set "PSModulePath="
set "LOG=%ROOT%deployer\bin\build.log"
if not exist "%ROOT%deployer\bin" mkdir "%ROOT%deployer\bin"
if exist "%LOG%" del "%LOG%"

rem Code signing is prohibited: make sure no certificate reaches the packager.
set "CSC_LINK=" & set "WIN_CSC_LINK=" & set "CSC_KEY_PASSWORD=" & set "WIN_CSC_KEY_PASSWORD="
set "CSC_IDENTITY_AUTO_DISCOVERY=false"

set "CMD=call "%ROOT%download-dependencies.bat" /s"
call :step "Downloading build tools" || goto :fail
if exist "%ROOT%.tools\git\cmd\git.exe" set "PATH=%ROOT%.tools\git\cmd;%PATH%"
if exist "%ROOT%.tools\node\node.exe" set "PATH=%ROOT%.tools\node;%PATH%"
where node >nul 2>&1 || (echo ERROR: Node.js was not found after download.& exit /b 3)

set "CMD="%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\make-icon.ps1" -Ico "%ROOT%deployer\assets\tempdesk.ico" -Png "%ROOT%deployer\app\src\renderer\img\tempdesk.png""
call :step "Generating the app icon" || goto :fail
if not defined DOCSONLY (
  set "CMD="%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\check-powershell.ps1""
  call :step "Checking PowerShell syntax" || goto :fail
)

pushd "%ROOT%deployer\app"
set "CMD=cmd /c npm ci --no-audit --no-fund"
call :step "Installing packages (npm ci)" || goto :fail-in-app
if defined BUILDCOMPANION goto :package-build-companion
if defined DOCSONLY goto :package-docs
set "CMD=cmd /c node scripts\prepare-bundle.js"
call :step "Bundling shared modules" || goto :fail-in-app
set "CMD=cmd /c node scripts\check-syntax.js"
call :step "Checking JavaScript syntax" || goto :fail-in-app
set "VEROPT="
if defined TEMPDESK_VERSION set "VEROPT= -c.extraMetadata.version=%TEMPDESK_VERSION%"
set "CMD=cmd /c npx electron-builder --win dir portable --x64 --publish never -c.directories.output=..\bin%VEROPT%"
call :step "Packaging (unpacked + portable)" || goto :fail-in-app
:package-docs
set "CMD=cmd /c node scripts\build-docs-companion.js"
call :step "Packaging the portable documentation" || goto :fail-in-app
if defined DOCSONLY goto :finished
if defined SKIPTESTS goto :finished
set "CMD=cmd /c node --test test/*.test.js"
call :step "Running unit tests after packaging" || goto :fail-in-app
goto :finished
:package-build-companion
set "CMD=cmd /c node "%ROOT%scripts\build-companion.cjs""
call :step "Packaging the portable build companion" || goto :fail-in-app
:finished
if defined RUNAPP (
  node "%ROOT%scripts\launch-built.cjs"
  if errorlevel 1 goto :fail-in-app
)
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

:fail-in-app
set "CODE=%ERRORLEVEL%"
popd
goto :report-failure
:fail
set "CODE=%ERRORLEVEL%"
:report-failure
if "%CODE%"=="0" set "CODE=1"
echo ERROR: build failed with exit code %CODE%. See the output above or %LOG%.
if defined QUIET if exist "%LOG%" powershell -NoProfile -Command "Get-Content -LiteralPath $env:LOG -Tail 40"
exit /b %CODE%
