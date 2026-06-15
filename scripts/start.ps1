# Launch DeepSeek interactive REPL in Windows Terminal
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Get-BunExe {
  $candidates = @(
    (Join-Path $env:APPDATA "npm\node_modules\bun\bin\bun.exe"),
    (Join-Path $env:USERPROFILE ".bun\bin\bun.exe"),
    (Join-Path ${env:ProgramFiles} "Bun\bun.exe")
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  $cmd = Get-Command bun.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  return $null
}

if (-not $env:ANTHROPIC_API_KEY) {
  $envFile = Join-Path $Root ".env"
  if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
      if ($_ -match '^\s*([^#=]+)=(.*)$') {
        $k = $matches[1].Trim()
        $v = $matches[2].Trim().Trim('"').Trim("'")
        [Environment]::SetEnvironmentVariable($k, $v, 'Process')
      }
    }
  }
}

if (-not $env:ANTHROPIC_API_KEY) {
  Write-Host "Set ANTHROPIC_API_KEY or create $Root\.env" -ForegroundColor Red
  exit 1
}

if (-not $env:ANTHROPIC_BASE_URL) {
  $env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
}

$bunExe = Get-BunExe
if (-not $bunExe) {
  Write-Host "bun.exe not found. Install: npm install -g bun" -ForegroundColor Red
  exit 1
}

$runScript = Join-Path $Root "scripts\run-deepseek.ts"
$key = $env:ANTHROPIC_API_KEY -replace "'", "''"
$base = $env:ANTHROPIC_BASE_URL -replace "'", "''"

# Use bun.exe absolute path — fresh WT sessions often lack npm global bin in PATH
$inner = @"
Set-Location -LiteralPath '$Root'
`$env:ANTHROPIC_API_KEY = '$key'
`$env:ANTHROPIC_BASE_URL = '$base'
`$env:CLAUDE_CODE_DEV = '1'
Write-Host 'DeepSeek REPL starting (first launch ~20-30s)...' -ForegroundColor Cyan
& '$bunExe' '$runScript' -- --bare --model deepseek-v4-flash
"@

$wt = Get-Command wt.exe -ErrorAction SilentlyContinue
if ($wt) {
  Start-Process -FilePath $wt.Source -ArgumentList @(
    "-d", $Root,
    "powershell", "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $inner
  )
  Write-Host "Opened Windows Terminal (bun: $bunExe)" -ForegroundColor Green
} else {
  # Fallback: current console
  Write-Host "wt.exe not found, starting in this window..." -ForegroundColor Yellow
  Invoke-Expression $inner.Replace('`$', '$')
}
