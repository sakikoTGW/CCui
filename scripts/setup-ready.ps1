# 全自动开箱（无需人工确认）
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$bunExe = Join-Path $env:APPDATA "npm\node_modules\bun\bin\bun.exe"
if (-not (Test-Path $bunExe)) {
  $bunExe = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
}
if (-not (Test-Path $bunExe)) {
  Write-Host "安装 Bun: npm install -g bun" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".env")) {
  if ($env:ANTHROPIC_API_KEY) {
    @"
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_API_KEY=$($env:ANTHROPIC_API_KEY)
DEEPSEEK_MODEL=deepseek-v4-flash
"@ | Set-Content -Path ".env" -Encoding UTF8
    Write-Host "已从环境变量写入 .env"
  } else {
    Copy-Item ".env.example" ".env"
    Write-Host "已创建 .env，请填入 ANTHROPIC_API_KEY 后重新运行 bun run setup" -ForegroundColor Yellow
    exit 1
  }
}

Get-Content ".env" | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    $k = $matches[1].Trim()
    $v = $matches[2].Trim().Trim('"').Trim("'")
    if ($v) { [Environment]::SetEnvironmentVariable($k, $v, 'Process') }
  }
}

if (-not $env:ANTHROPIC_API_KEY) {
  Write-Host ".env 缺少 ANTHROPIC_API_KEY" -ForegroundColor Red
  exit 1
}
if (-not $env:ANTHROPIC_BASE_URL) {
  $env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
}

Write-Host "[1/3] 信任目录 + 跳过引导" -ForegroundColor Cyan
& $bunExe --define 'MACRO.VERSION="2.0.0-dev"' scripts/seed-dev.ts

Write-Host "[2/3] 冒烟测试" -ForegroundColor Cyan
& $bunExe run smoke
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[3/3] 完成" -ForegroundColor Green
Write-Host "双击 启动.bat  或运行 bun run start:here"
