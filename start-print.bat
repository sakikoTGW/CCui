@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "BUN=%APPDATA%\npm\node_modules\bun\bin\bun.exe"
if not exist "%BUN%" (
  set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
)
if not exist "%BUN%" (
  echo [ERROR] bun.exe not found.
  exit /b 1
)

set "CLAUDE_CODE_DEV=1"
set "MSG=%~1"
if "%MSG%"=="" set "MSG=hi"

"%BUN%" scripts\run-deepseek.ts -- -p "%MSG%" --model deepseek-v4-flash
