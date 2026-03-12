## Banyu Langit Daily Sync
## 1-click: Deno fetch dari IDX lalu import ke Banyu Langit
## Jalankan: .\daily-sync.ps1
## Atau: .\daily-sync.ps1 -date 20260311

param(
    [string]$date = ""
)

$ErrorActionPreference = "Continue"
$idxDir = "C:\Project\banyu-langit\IDX-API-main"

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  BANYU LANGIT - Daily Sync" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Determine date
if ($date -eq "") {
    $today = Get-Date
    if ($today.DayOfWeek -eq "Saturday") { $today = $today.AddDays(-1) }
    if ($today.DayOfWeek -eq "Sunday") { $today = $today.AddDays(-2) }
    $date = $today.ToString("yyyyMMdd")
    $dateISO = $today.ToString("yyyy-MM-dd")
} else {
    $dateISO = $date.Substring(0,4) + "-" + $date.Substring(4,2) + "-" + $date.Substring(6,2)
}

Write-Host "Target date: $date ($dateISO)" -ForegroundColor Yellow
Write-Host ""

# STEP 1: Deno sync
Write-Host "[Step 1/3] Deno sync from IDX API..." -ForegroundColor Cyan

$syncLines = @(
    "import * as sync from '@app/Backend/Sync/index.ts'"
    ""
    "console.log('Syncing stock summary $date...')"
    "await sync.syncStockSummary('$date')"
    "console.log('Syncing index summary $date...')"
    "await sync.syncIndexSummary('$date')"
    "console.log('Done!')"
)

$syncFile = Join-Path $idxDir "daily-auto.ts"
$syncLines -join "`n" | Out-File -FilePath $syncFile -Encoding utf8

Push-Location $idxDir
try {
    deno run --allow-all daily-auto.ts
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK - Deno sync complete" -ForegroundColor Green
    } else {
        Write-Host "  FAIL - Deno sync failed (exit $LASTEXITCODE)" -ForegroundColor Red
    }
} catch {
    Write-Host "  FAIL - Deno error: $_" -ForegroundColor Red
}
Pop-Location

Write-Host ""

# STEP 2: Import to Banyu Langit
Write-Host "[Step 2/3] Import to Banyu Langit..." -ForegroundColor Cyan

try {
    $body = '{"date":"' + $dateISO + '"}'
    $stockResult = Invoke-RestMethod -Uri "http://localhost:3003/api/idx/sync/stock-summary" -Method POST -ContentType "application/json" -Body $body
    Write-Host "  Stock: $($stockResult.rows) rows" -ForegroundColor Green

    $indexResult = Invoke-RestMethod -Uri "http://localhost:3003/api/idx/sync/index-summary" -Method POST -ContentType "application/json" -Body $body
    Write-Host "  Index: $($indexResult.rows) rows" -ForegroundColor Green
} catch {
    Write-Host "  FAIL - Import error: $_" -ForegroundColor Red
    Write-Host "  Is Docker running? Check localhost:3003" -ForegroundColor Yellow
}

Write-Host ""

# STEP 3: Status check
Write-Host "[Step 3/3] Status..." -ForegroundColor Cyan

try {
    $status = Invoke-RestMethod -Uri "http://localhost:3003/api/idx/sync/status" -Method GET
    Write-Host "  Stock Latest : $($status.latest.stock)"
    Write-Host "  Index Latest : $($status.latest.index)"
    Write-Host "  Tickers      : $($status.counts.tickers)"
    Write-Host "  Stock Days   : $($status.counts.stock_dates)"
    Write-Host "  Index Days   : $($status.counts.index_dates)"
} catch {
    Write-Host "  Could not fetch status" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Sync complete ===" -ForegroundColor Green
Write-Host ""
