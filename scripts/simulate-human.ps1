# Human-style GUI out-of-box simulation
$ErrorActionPreference = "Stop"
$Root = "e:\CCui"
$Log = Join-Path $Root "human-run.log"
$Bun = Join-Path $env:APPDATA "npm\node_modules\bun\bin\bun.exe"
if (-not (Test-Path $Bun)) { $Bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe" }
$Electron = Join-Path $Root "gui\node_modules\electron\dist\electron.exe"
$Status = Join-Path $Root "logs\gui-status.json"

function Log([string]$msg) {
  $line = "[$(Get-Date -Format 'HH:mm:ss')] $msg"
  Add-Content -Path $Log -Value $line -Encoding utf8
  Write-Host $line
}

Set-Location $Root
Set-Content -Path $Log -Value "" -Encoding utf8
Log "=== human GUI simulation start ==="

if (-not (Test-Path (Join-Path $Root "start-gui.bat"))) { throw "missing start-gui.bat" }
Log "[1/5] start-gui.bat exists OK"

if (-not (Test-Path (Join-Path $Root ".env"))) { throw "missing .env" }
Log "[2/5] .env exists OK"

if (-not (Test-Path $Electron)) {
  Log "[3/5] electron missing, running npm install in gui/ ..."
  Push-Location (Join-Path $Root "gui")
  npm install 2>&1 | Out-Null
  Pop-Location
}
if (-not (Test-Path $Electron)) { throw "electron not installed after npm install" }
Log "[3/5] electron OK"

Log "[4/5] double-click path: start-gui.bat (wait 90s) ..."
$ready = $false
if (Test-Path $Status) {
  try {
    $st0 = Get-Content $Status -Raw | ConvertFrom-Json
    if ($st0.daemonStatus -eq "ready" -and $st0.rendererBoot -eq "ok") {
      $ready = $true
      Log "[4/5] GUI already running and ready OK"
    }
  } catch {}
}
if (-not $ready) {
  Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $null = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "cd /d `"$Root`" && start-gui.bat" -WindowStyle Normal
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if (-not (Get-Process electron -ErrorAction SilentlyContinue)) { continue }
    if (Test-Path $Status) {
      try {
        $st = Get-Content $Status -Raw | ConvertFrom-Json
        if ($st.daemonStatus -eq "ready" -and $st.rendererBoot -eq "ok") {
          $ready = $true
          break
        }
      } catch {}
    }
  }
}

if (-not $ready) {
  Log "FAIL: GUI did not reach daemon ready within 90s"
  if (Test-Path $Status) { Log (Get-Content $Status -Raw) }
  exit 1
}
Log "[4/5] GUI daemon ready OK"

Log "[5/5] layout verify ..."
& powershell -ExecutionPolicy Bypass -File (Join-Path $Root "scripts\verify-gui-layout.ps1")
if ($LASTEXITCODE -ne 0) { exit 1 }
Log "[5/5] layout OK"

Log "=== human GUI simulation PASSED ==="
exit 0
