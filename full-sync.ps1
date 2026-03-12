## Banyu Langit Full Sync
## Sync semua data: stock, index, screener, dividends, profiles
## Jalankan: .\full-sync.ps1
## Backfill: .\full-sync.ps1 -from 20260301 -to 20260312

param(
    [string]$from = "",
    [string]$to = ""
)

$ErrorActionPreference = "Continue"
$idxDir = "C:\Project\banyu-langit\IDX-API-main"

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  BANYU LANGIT - Full Sync" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Determine date range
if ($from -eq "" -or $to -eq "") {
    $today = Get-Date
    if ($today.DayOfWeek -eq "Saturday") { $today = $today.AddDays(-1) }
    if ($today.DayOfWeek -eq "Sunday") { $today = $today.AddDays(-2) }
    $to = $today.ToString("yyyyMMdd")
    $from = $today.AddDays(-5).ToString("yyyyMMdd")
}

$fromISO = $from.Substring(0,4) + "-" + $from.Substring(4,2) + "-" + $from.Substring(6,2)
$toISO = $to.Substring(0,4) + "-" + $to.Substring(4,2) + "-" + $to.Substring(6,2)

Write-Host "Range: $from -> $to" -ForegroundColor Yellow
Write-Host ""

# STEP 1: Deno sync
Write-Host "[Step 1/2] Deno sync from IDX API..." -ForegroundColor Cyan

# Generate weekday date list
$dateList = @()
$current = [DateTime]::ParseExact($from, "yyyyMMdd", $null)
$endDate = [DateTime]::ParseExact($to, "yyyyMMdd", $null)
while ($current -le $endDate) {
    if ($current.DayOfWeek -ne "Saturday" -and $current.DayOfWeek -ne "Sunday") {
        $dateList += $current.ToString("yyyyMMdd")
    }
    $current = $current.AddDays(1)
}

Write-Host "  Trading dates: $($dateList.Count)" -ForegroundColor Yellow

# Build sync script
$lines = @()
$lines += "import * as sync from '@app/Backend/Sync/index.ts'"
$lines += ""
$lines += "console.log('=== Full Sync ===')"

foreach ($d in $dateList) {
    $lines += "console.log('Stock+Index $d...')"
    $lines += "await sync.syncStockSummary('$d')"
    $lines += "await sync.syncIndexSummary('$d')"
}

$year = $to.Substring(0,4)
$month = [int]$to.Substring(4,2)
$lines += ""
$lines += "console.log('Screener...')"
$lines += "await sync.syncStockScreener()"
$lines += "console.log('Financial ratios...')"
$lines += "await sync.syncFinancialRatio($year, $month)"
$lines += "console.log('Dividends...')"
$lines += "await sync.syncCompanyDividend($year, $month)"
$lines += "console.log('Stock splits...')"
$lines += "await sync.syncStockSplit($year, $month)"
$lines += "console.log('Company profiles...')"
$lines += "await sync.syncCompanyProfile()"
$lines += ""
$lines += "console.log('=== Deno Done ===')"

$syncFile = Join-Path $idxDir "full-auto.ts"
$lines -join "`n" | Out-File -FilePath $syncFile -Encoding utf8

Push-Location $idxDir
try {
    deno run --allow-all full-auto.ts
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK - Deno sync complete" -ForegroundColor Green
    } else {
        Write-Host "  FAIL - Deno sync failed" -ForegroundColor Red
    }
} catch {
    Write-Host "  FAIL - Deno error: $_" -ForegroundColor Red
}
Pop-Location

Write-Host ""

# STEP 2: Import all to Banyu Langit
Write-Host "[Step 2/2] Import all to Banyu Langit..." -ForegroundColor Cyan

try {
    $result = Invoke-RestMethod -Uri "http://localhost:3003/api/idx/sync/import-all" -Method POST -ContentType "application/json" -Body "{}"

    Write-Host "  Total: $($result.total_rows) rows imported" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Stock      : $($result.detail.stock.rows)"
    Write-Host "  Index      : $($result.detail.index.rows)"
    Write-Host "  Screener   : $($result.detail.screener.rows)"
    Write-Host "  Fundamental: $($result.detail.fundamental.rows)"
    Write-Host "  Dividends  : $($result.detail.dividends.rows)"
    Write-Host "  Splits     : $($result.detail.splits.rows)"
    Write-Host "  Profiles   : $($result.detail.profiles.rows)"
    Write-Host "  Details    : $($result.detail.details.rows)"
} catch {
    Write-Host "  FAIL - Import error: $_" -ForegroundColor Red
    Write-Host "  Is Docker running? Check localhost:3003" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Full sync complete ===" -ForegroundColor Green
Write-Host ""
