# 自动验收：真实 CMD 窗口启动交互 REPL，轮询 .ccui-startup-status 直到 100%
$ErrorActionPreference = "Stop"
$Root = "e:\CCui"
$Log = Join-Path $Root "repl-verify.log"
$Status = Join-Path $Root ".ccui-startup-status"
$Bun = Join-Path $env:APPDATA "npm\node_modules\bun\bin\bun.exe"
if (-not (Test-Path $Bun)) { $Bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe" }

function Log([string]$msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
  Add-Content -Path $Log -Value $line -Encoding utf8
  Write-Host $line
}

Set-Location $Root
Set-Content -Path $Log -Value "" -Encoding utf8
Remove-Item $Status -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $Bun)) { throw "bun.exe not found" }
if (-not (Test-Path (Join-Path $Root ".env"))) { throw ".env missing" }

Log "=== REPL open verification ==="
Log "Launching interactive REPL in CMD (max 180s) ..."

$cmdLine = "cd /d `"$Root`" && `"$Bun`" scripts\run-deepseek.ts -- --bare --model deepseek-v4-flash --debug-file `"$Root\repl-debug.log`""
$proc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $cmdLine -PassThru -WindowStyle Normal

$deadline = (Get-Date).AddSeconds(180)
$ready = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  if (Test-Path $Status) {
    try {
      $json = Get-Content $Status -Raw -Encoding utf8 | ConvertFrom-Json
      Log "progress: $($json.percent)% $($json.label)"
      if ($json.percent -ge 100) {
        $ready = $true
        break
      }
    } catch { }
  }
  if ($proc.HasExited -and -not $ready) {
    Log "FAIL: process exited before REPL ready (code=$($proc.ExitCode))"
    exit 1
  }
}

if (-not $ready) {
  Log "FAIL: timeout 180s, REPL not ready"
  exit 1
}

Log "PASS: REPL opened and ready"
Log "Process still running for user (pid=$($proc.Id))"
exit 0
