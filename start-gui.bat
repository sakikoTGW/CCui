@echo off
setlocal
set "ROOT=%~dp0"
set "GUI=%ROOT%gui"
set "BUN=%APPDATA%\npm\node_modules\bun\bin\bun.exe"
if not exist "%BUN%" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
rem Avoid %E:...% cmd substring trap on variable name ELECTRON
set "_EL_BIN=%GUI%\node_modules\electron\dist\electron.exe"

if not exist "%BUN%" (
  echo [ERROR] bun.exe not found. Run: npm install -g bun
  pause
  exit /b 1
)

if not exist "%_EL_BIN%" (
  echo Installing GUI dependencies, first run only. Please wait...
  pushd "%GUI%"
  call npm install
  popd
)

if not exist "%_EL_BIN%" (
  echo [ERROR] Electron not installed. Open a terminal in the gui folder and run: npm install
  pause
  exit /b 1
)

echo [1/2] Seeding dev config and skills...
"%BUN%" --define MACRO.VERSION="2.0.0-dev" "%ROOT%scripts\seed-dev.ts"
if errorlevel 1 (
  echo [WARN] seed-dev failed, continuing anyway
)

echo [2/2] Starting CCui desktop...
echo Log: %ROOT%logs\gui-latest.log
pushd "%GUI%"
"%_EL_BIN%" .
popd
