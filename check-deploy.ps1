# Banyu Langit - Verify Custom Sync Deployment
# Run: .\check-deploy.ps1

$root = "C:\Project\banyu-langit"

Write-Host ""
Write-Host "=== Checking Custom Sync Files ===" -ForegroundColor Cyan
Write-Host ""

# 1. Check deno-server.ts
$f1 = "$root\IDX-API-main\deno-server.ts"
if (Test-Path $f1) {
    $content = Get-Content $f1 -Raw
    if ($content -match "sync/custom") {
        Write-Host "[OK] deno-server.ts - Custom sync handler found" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] deno-server.ts - OLD version (no /sync/custom)" -ForegroundColor Red
    }
    Write-Host "     Size: $((Get-Item $f1).Length) bytes | Modified: $((Get-Item $f1).LastWriteTime)" -ForegroundColor Gray
} else {
    Write-Host "[FAIL] deno-server.ts - NOT FOUND" -ForegroundColor Red
}

# 2. Check deno-proxy.js
$f2 = "$root\server\utils\deno-proxy.js"
if (Test-Path $f2) {
    $content = Get-Content $f2 -Raw
    if ($content -match "sync/custom") {
        Write-Host "[OK] deno-proxy.js - Custom sync proxy found" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] deno-proxy.js - OLD version" -ForegroundColor Red
    }
    Write-Host "     Size: $((Get-Item $f2).Length) bytes | Modified: $((Get-Item $f2).LastWriteTime)" -ForegroundColor Gray
} else {
    Write-Host "[FAIL] deno-proxy.js - NOT FOUND" -ForegroundColor Red
}

# 3. Check settings.js
$f3 = "$root\public\js\settings.js"
if (Test-Path $f3) {
    $content = Get-Content $f3 -Raw
    if ($content -match "csStartCustomSync") {
        Write-Host "[OK] settings.js - Custom Sync UI found" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] settings.js - OLD version" -ForegroundColor Red
    }
    Write-Host "     Size: $((Get-Item $f3).Length) bytes | Modified: $((Get-Item $f3).LastWriteTime)" -ForegroundColor Gray
} else {
    Write-Host "[FAIL] settings.js - NOT FOUND" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Checking Services ===" -ForegroundColor Cyan
Write-Host ""

# 4. Check Deno server
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3456/health" -TimeoutSec 3
    Write-Host "[OK] Deno server - Online (uptime: $($r.uptime)s)" -ForegroundColor Green
    if ($r.running) {
        Write-Host "     Currently running: $($r.running)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[FAIL] Deno server - Offline (run: .\start-deno.ps1)" -ForegroundColor Red
}

# 5. Check Docker/Node
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3003/api/health" -TimeoutSec 3
    Write-Host "[OK] Docker (Node) - Online (v$($r.version))" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Docker (Node) - Offline (run: docker compose up -d)" -ForegroundColor Red
}

# 6. Test connection
try {
    $r = Invoke-RestMethod -Uri "http://localhost:3003/api/idx/sync/deno-health" -TimeoutSec 3
    if ($r.reachable) {
        Write-Host "[OK] Deno-Docker - Connected" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] Deno-Docker - Not reachable from Docker" -ForegroundColor Red
    }
} catch {
    Write-Host "[FAIL] Deno-Docker - Cannot test" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Quick DB Stats ===" -ForegroundColor Cyan
Write-Host ""

try {
    $r = Invoke-RestMethod -Uri "http://localhost:3003/api/idx/stats" -TimeoutSec 5
    Write-Host "   Tickers: $($r.tickers) | Days: $($r.dates) | Records: $($r.total)" -ForegroundColor White
    Write-Host "   Range: $($r.oldest) to $($r.latest)" -ForegroundColor Gray
} catch {
    Write-Host "   (cannot fetch - Docker offline?)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Ready! Open localhost:3003 -> Settings -> Sync Center" -ForegroundColor Yellow
Write-Host ""