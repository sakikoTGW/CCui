# Verify compact-window layout from gui-latest.log (no blank session-rail gutter)
$ErrorActionPreference = "Stop"
$Root = "e:\CCui"
$Log = Join-Path $Root "logs\gui-latest.log"
$Status = Join-Path $Root "logs\gui-status.json"

function Fail([string]$msg) {
  Write-Host "FAIL: $msg" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $Log)) { Fail "missing $Log — start GUI first" }

$lines = Get-Content $Log -Tail 80
$checks = @()
foreach ($line in $lines) {
  if ($line -notmatch 'layout-check') { continue }
  if ($line -notmatch '\{.*\}') { continue }
  $json = $Matches[0] | ConvertFrom-Json
  if ($json.vpCompact -ne $true) { continue }
  $checks += $json
}

if ($checks.Count -eq 0) { Fail "no vp-compact layout-check entries in log" }

$last = $checks[-1]
Write-Host "compact check: viewport=$($last.viewport) mainCol=$($last.mainColWidth) sessionRail=$($last.sessionRailWidth) content=$($last.contentWidth) ok=$($last.layoutOk)"

if ($last.layoutOk -ne $true) {
  if ($last.compactLayoutOk -ne $true) { Fail "compact gutter: session rail still reserving width" }
  if ($last.contentWidthOk -ne $true) { Fail "content not full width (content=$($last.contentWidth) mainCol=$($last.mainColWidth))" }
  Fail "layout check failed"
}

$mainPx = 0
if ($last.mainColWidth -match '^([\d.]+)px$') { $mainPx = [double]$Matches[1] }
$usable = [double]$last.usableWidth
if ($usable -gt 0 -and $mainPx -lt ($usable * 0.92)) {
  Fail "mainCol $mainPx < 92% of usable $usable"
}

Write-Host "PASS: compact layout verified" -ForegroundColor Green
exit 0
