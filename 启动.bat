@echo off
cd /d "%~dp0"
set "BUN=%APPDATA%\npm\node_modules\bun\bin\bun.exe"
if not exist "%BUN%" set "BUN=%USERPROFILE%\.bun\bin\bun.exe"
if not exist "%BUN%" (
  echo Bun not found. Run: npm install -g bun
  pause
  exit /b 1
)
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do (
  if not "%%b"=="" set "%%a=%%b"
)
if "%ANTHROPIC_BASE_URL%"=="" set "ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic"
if "%ANTHROPIC_API_KEY%"=="" (
  echo Missing ANTHROPIC_API_KEY in .env
  pause
  exit /b 1
)
set CLAUDE_CODE_DEV=1
echo Starting CCui REPL...
"%BUN%" run start:here
