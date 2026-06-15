# 在当前终端直接启动交互 REPL（不弹 Windows Terminal，PATH 问题最少）
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $Root

$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $k = $matches[1].Trim()
      $v = $matches[2].Trim().Trim('"').Trim("'")
      if (-not [Environment]::GetEnvironmentVariable($k, 'Process')) {
        [Environment]::SetEnvironmentVariable($k, $v, 'Process')
      }
    }
  }
}

$bunExe = Join-Path $env:APPDATA "npm\node_modules\bun\bin\bun.exe"
if (-not (Test-Path $bunExe)) {
  $bunExe = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
}
if (-not (Test-Path $bunExe)) {
  $cmd = Get-Command bun.exe -ErrorAction SilentlyContinue
  if ($cmd) { $bunExe = $cmd.Source }
}

if (-not $bunExe -or -not (Test-Path $bunExe)) {
  Write-Host "bun.exe not found. Run: npm install -g bun" -ForegroundColor Red
  exit 1
}

if (-not $env:ANTHROPIC_API_KEY) {
  Write-Host "Set ANTHROPIC_API_KEY or create .env" -ForegroundColor Red
  exit 1
}
if (-not $env:ANTHROPIC_BASE_URL) {
  $env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
}

Write-Host "Starting REPL with $bunExe ..." -ForegroundColor Cyan
Write-Host "Progress bar: [####----] pct% status" -ForegroundColor DarkGray
& $bunExe (Join-Path $Root "scripts\run-deepseek.ts") -- --bare --model deepseek-v4-flash
