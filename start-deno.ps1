## Banyu Langit - Start Deno Sync Server
## Jalankan SEKALI, biarkan running di background
## Lalu semua sync bisa dilakukan dari browser (1-click)
##
## Usage: .\start-deno.ps1

$idxDir = "C:\Project\banyu-langit\IDX-API-main"

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  BANYU LANGIT - Deno Sync Server" -ForegroundColor Cyan  
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Port: 3456" -ForegroundColor Yellow
Write-Host "  Stop: Ctrl+C" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Endpoints:" -ForegroundColor Gray
Write-Host "    POST /sync/daily  - Daily sync (stock + index)" -ForegroundColor Gray
Write-Host "    POST /sync/full   - Full sync (5 days + monthly)" -ForegroundColor Gray
Write-Host "    POST /sync/cron   - All 39 tables" -ForegroundColor Gray
Write-Host "    GET  /status      - Check progress" -ForegroundColor Gray
Write-Host "    GET  /health      - Health check" -ForegroundColor Gray
Write-Host ""
Write-Host "  After starting, use browser:" -ForegroundColor Green
Write-Host "    Settings - IDX API - 1-Click Sync" -ForegroundColor Green
Write-Host ""

Push-Location $idxDir
deno run --allow-all deno-server.ts
Pop-Location
