/**
 * Deno Sync Proxy for Banyu Langit
 * 
 * Node.js routes that:
 * 1. Forward sync commands to Deno server (localhost:3456)
 * 2. Poll Deno status until done
 * 3. Auto-run bridge import after Deno finishes
 * 4. Custom sync: user picks modules + date range
 * 
 * Add to idx.js:  require('../utils/deno-proxy')(router, db, idxBridge, logSync);
 */

const DENO_URL = process.env.DENO_SYNC_URL || 'http://host.docker.internal:3456';

function setupDenoProxy(router, db, idxBridge, logSync) {

  // ═══ 1-Click Daily Sync ═══
  // Browser → Node → Deno(fetch idx.co.id) → bridge import → done
  router.post('/sync/1click-daily', async (req, res) => {
    const { date } = req.body || {};
    try {
      // Step 1: Tell Deno to sync
      const denoRes = await fetch(`${DENO_URL}/sync/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: date || '' })
      });
      const denoData = await denoRes.json();
      if (!denoData.ok) {
        return res.json({ ok: false, step: 'deno', error: denoData.error || denoData.message });
      }

      // Step 2: Poll until done (max 120s)
      const pollResult = await pollDeno(120);

      // Step 3: Bridge import
      const bridgeResult = runBridgeImport(db, idxBridge, logSync);

      res.json({
        ok: true,
        deno: pollResult,
        bridge: bridgeResult
      });
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running? Start: deno run --allow-all deno-server.ts' });
    }
  });

  // ═══ 1-Click Full Sync ═══
  router.post('/sync/1click-full', async (req, res) => {
    const { from, to } = req.body || {};
    try {
      const denoRes = await fetch(`${DENO_URL}/sync/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from || '', to: to || '' })
      });
      const denoData = await denoRes.json();
      if (!denoData.ok) {
        return res.json({ ok: false, step: 'deno', error: denoData.error || denoData.message });
      }

      // Poll (full sync takes longer, max 300s)
      const pollResult = await pollDeno(300);

      // Bridge import
      const bridgeResult = runBridgeImport(db, idxBridge, logSync);

      res.json({
        ok: true,
        deno: pollResult,
        bridge: bridgeResult
      });
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running?' });
    }
  });

  // ═══ 1-Click Cron Sync (all 39 tables) ═══
  router.post('/sync/1click-cron', async (req, res) => {
    const { from, to } = req.body || {};
    try {
      const denoRes = await fetch(`${DENO_URL}/sync/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from || '', to: to || '' })
      });
      const denoData = await denoRes.json();
      if (!denoData.ok) {
        return res.json({ ok: false, step: 'deno', error: denoData.error || denoData.message });
      }

      // Poll (cron can be very long, max 600s)
      const pollResult = await pollDeno(600);

      // Bridge import
      const bridgeResult = runBridgeImport(db, idxBridge, logSync);

      res.json({
        ok: true,
        deno: pollResult,
        bridge: bridgeResult
      });
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running?' });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ═══ CUSTOM SYNC — user picks modules + date range ═══
  // ═══════════════════════════════════════════════════════════════
  router.post('/sync/custom', async (req, res) => {
    const { modules, from, to } = req.body || {};
    if (!modules || !Array.isArray(modules) || !modules.length) {
      return res.json({ ok: false, error: 'No modules selected' });
    }
    if (!from || !to) {
      return res.json({ ok: false, error: 'Date range required (from, to)' });
    }

    try {
      // Forward to Deno custom sync endpoint
      const denoRes = await fetch(`${DENO_URL}/sync/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules, from, to })
      });
      const denoData = await denoRes.json();
      if (!denoData.ok && denoData.error === 'busy') {
        return res.json({ ok: false, error: 'busy', message: denoData.message || 'Deno is busy with another sync' });
      }
      if (!denoData.ok) {
        return res.json({ ok: false, step: 'deno', error: denoData.error || denoData.message });
      }

      // Return immediately — frontend will poll /sync/deno-status
      res.json({ ok: true, message: 'Custom sync started', modules, from, to });
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running? Start: start-deno.ps1' });
    }
  });

  // ═══ Custom sync: blocking version (waits for completion + bridge) ═══
  router.post('/sync/custom-blocking', async (req, res) => {
    const { modules, from, to } = req.body || {};
    if (!modules || !Array.isArray(modules) || !modules.length) {
      return res.json({ ok: false, error: 'No modules selected' });
    }

    try {
      const denoRes = await fetch(`${DENO_URL}/sync/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules, from: from || '', to: to || '' })
      });
      const denoData = await denoRes.json();
      if (!denoData.ok) {
        return res.json({ ok: false, step: 'deno', error: denoData.error || denoData.message });
      }

      // Poll until done (custom can be very long for big ranges)
      const pollResult = await pollDeno(1800); // 30 min max

      // Auto bridge import — only import modules that were synced
      const bridgeResult = runSelectiveBridgeImport(db, idxBridge, logSync, modules);

      res.json({
        ok: true,
        deno: pollResult,
        bridge: bridgeResult
      });
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running?' });
    }
  });

  // ═══ Async versions (non-blocking, use with SSE/polling) ═══
  router.post('/sync/start-daily', async (req, res) => {
    try {
      const denoRes = await fetch(`${DENO_URL}/sync/daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
      });
      res.json(await denoRes.json());
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running?' });
    }
  });

  router.post('/sync/start-full', async (req, res) => {
    try {
      const denoRes = await fetch(`${DENO_URL}/sync/full`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
      });
      res.json(await denoRes.json());
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running?' });
    }
  });

  router.post('/sync/start-cron', async (req, res) => {
    try {
      const denoRes = await fetch(`${DENO_URL}/sync/cron`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body || {})
      });
      res.json(await denoRes.json());
    } catch (e) {
      res.json({ ok: false, error: e.message, hint: 'Is Deno server running?' });
    }
  });

  // ═══ Deno status check ═══
  router.get('/sync/deno-status', async (req, res) => {
    try {
      const denoRes = await fetch(`${DENO_URL}/status`);
      res.json(await denoRes.json());
    } catch (e) {
      res.json({ ok: false, running: false, error: 'Deno server not reachable', hint: 'Start: deno run --allow-all deno-server.ts' });
    }
  });

  // ═══ Deno health check ═══
  router.get('/sync/deno-health', async (req, res) => {
    try {
      const denoRes = await fetch(`${DENO_URL}/health`);
      res.json({ ...(await denoRes.json()), reachable: true });
    } catch (e) {
      res.json({ reachable: false, error: e.message });
    }
  });
}

// ═══ Helper: Poll Deno until job completes ═══
async function pollDeno(maxSeconds = 120) {
  const start = Date.now();
  const maxMs = maxSeconds * 1000;
  let lastProgress = 0;

  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 2000)); // poll every 2s

    try {
      const res = await fetch(`${DENO_URL}/status`);
      const data = await res.json();

      if (!data.running) {
        // Job finished
        return { ok: true, elapsed: Math.round((Date.now() - start) / 1000), last: data.last };
      }

      // Still running
      lastProgress = data.progress?.length || 0;
    } catch {
      // Deno might be busy, keep polling
    }
  }

  return { ok: false, error: 'timeout', elapsed: maxSeconds };
}

// ═══ Helper: Run all bridge imports ═══
function runBridgeImport(db, idxBridge, logSync) {
  const results = {};
  try {
    results.stock = idxBridge.importStockSummary(db, {});
    results.index = idxBridge.importIndexSummary(db, {});
    results.fundamental = idxBridge.importFinancialRatios(db);
    results.screener = idxBridge.importStockScreener(db);
    results.dividends = idxBridge.importDividends(db);
    results.splits = idxBridge.importStockSplits(db);
    results.profiles = idxBridge.importCompanyProfiles(db);
    results.details = idxBridge.importCompanyDetails(db);

    // New tables (if bridge functions exist)
    if (typeof idxBridge.importBrokerSummary === 'function') results.broker = idxBridge.importBrokerSummary(db);
    if (typeof idxBridge.importMarketCalendar === 'function') results.calendar = idxBridge.importMarketCalendar(db);
    if (typeof idxBridge.importCompanyAnnouncement === 'function') results.announcement = idxBridge.importCompanyAnnouncement(db);
    if (typeof idxBridge.importForeignTrading === 'function') results.foreign = idxBridge.importForeignTrading(db);
    if (typeof idxBridge.importDomesticTrading === 'function') results.domestic = idxBridge.importDomesticTrading(db);
    if (typeof idxBridge.importIndustryTrading === 'function') results.industry = idxBridge.importIndustryTrading(db);
    if (typeof idxBridge.importSectoralMovement === 'function') results.sectoral = idxBridge.importSectoralMovement(db);
    if (typeof idxBridge.importDailyIndex === 'function') results.daily_index = idxBridge.importDailyIndex(db);
    if (typeof idxBridge.importTopMovers === 'function') results.top_movers = idxBridge.importTopMovers(db);
    if (typeof idxBridge.importActiveStocks === 'function') results.active = idxBridge.importActiveStocks(db);
    if (typeof idxBridge.importCompanySuspend === 'function') results.suspend = idxBridge.importCompanySuspend(db);
    if (typeof idxBridge.importRightOfferings === 'function') results.rights = idxBridge.importRightOfferings(db);
    if (typeof idxBridge.importParticipantBrokers === 'function') results.participants = idxBridge.importParticipantBrokers(db);
    // Batch 2 — full 39 table coverage
    if (typeof idxBridge.importTradingSS === 'function') results.trading_ss = idxBridge.importTradingSS(db);
    if (typeof idxBridge.importTradingDaily === 'function') results.trading_daily = idxBridge.importTradingDaily(db);
    if (typeof idxBridge.importIndexChart === 'function') results.index_chart = idxBridge.importIndexChart(db);
    if (typeof idxBridge.importIndexList === 'function') results.index_list = idxBridge.importIndexList(db);
    if (typeof idxBridge.importFinancialReports === 'function') results.fin_reports = idxBridge.importFinancialReports(db);
    if (typeof idxBridge.importIssuedHistory === 'function') results.issued = idxBridge.importIssuedHistory(db);
    if (typeof idxBridge.importAdditionalListings === 'function') results.add_listing = idxBridge.importAdditionalListings(db);
    if (typeof idxBridge.importNewListings === 'function') results.new_listing = idxBridge.importNewListings(db);
    if (typeof idxBridge.importSecurityStocks === 'function') results.security = idxBridge.importSecurityStocks(db);
    if (typeof idxBridge.importCompanyDelistings === 'function') results.delisting = idxBridge.importCompanyDelistings(db);
    if (typeof idxBridge.importCompanyRelistings === 'function') results.relisting = idxBridge.importCompanyRelistings(db);
    if (typeof idxBridge.importProfileAnnouncements === 'function') results.prof_ann = idxBridge.importProfileAnnouncements(db);
    if (typeof idxBridge.importParticipantDealers === 'function') results.dealers = idxBridge.importParticipantDealers(db);
    if (typeof idxBridge.importParticipantProfiles === 'function') results.prof_part = idxBridge.importParticipantProfiles(db);
    if (typeof idxBridge.importTradeSummary === 'function') results.trade_sum = idxBridge.importTradeSummary(db);
    if (typeof idxBridge.importFinancialRatiosFull === 'function') results.fin_ratios = idxBridge.importFinancialRatiosFull(db);

    const totalRows = Object.values(results).reduce((s, r) => s + (r?.rows || 0), 0);
    if (logSync) {
      logSync('1click_bridge', '', totalRows, 'ok', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.rows || 0]))));
    }

    return { ok: true, total_rows: totalRows, detail: results };
  } catch (e) {
    if (logSync) logSync('1click_bridge', '', 0, 'error', e.message);
    return { ok: false, error: e.message, partial: results };
  }
}

// ═══ Helper: Run selective bridge imports (only for synced modules) ═══
function runSelectiveBridgeImport(db, idxBridge, logSync, modules) {
  const results = {};
  const moduleMap = {
    stock_summary: ['importStockSummary'],
    index_summary: ['importIndexSummary'],
    screener: ['importStockScreener'],
    financial_ratio: ['importFinancialRatios', 'importFinancialRatiosFull'],
    dividends: ['importDividends'],
    stock_split: ['importStockSplits'],
    company_profile: ['importCompanyProfiles', 'importCompanyDetails'],
    broker_summary: ['importBrokerSummary'],
    announcements: ['importCompanyAnnouncement'],
    foreign_trading: ['importForeignTrading'],
    domestic_trading: ['importDomesticTrading'],
    industry_trading: ['importIndustryTrading'],
    sectoral: ['importSectoralMovement'],
    daily_index: ['importDailyIndex'],
    top_movers: ['importTopMovers'],
    active_stocks: ['importActiveStocks'],
    suspends: ['importCompanySuspend'],
    market_calendar: ['importMarketCalendar'],
    index_list: ['importIndexList'],
    index_chart: ['importIndexChart'],
    all_tables: null // special: run all
  };

  try {
    // If 'all_tables' selected, run everything
    if (modules.includes('all_tables')) {
      return runBridgeImport(db, idxBridge, logSync);
    }

    for (const mod of modules) {
      const fns = moduleMap[mod];
      if (!fns) continue;
      for (const fn of fns) {
        if (typeof idxBridge[fn] === 'function') {
          try {
            const opts = (fn === 'importStockSummary' || fn === 'importIndexSummary') ? {} : undefined;
            results[fn] = opts !== undefined ? idxBridge[fn](db, opts) : idxBridge[fn](db);
          } catch (e) { results[fn] = { rows: 0, error: e.message }; }
        }
      }
    }

    const totalRows = Object.values(results).reduce((s, r) => s + (r?.rows || 0), 0);
    if (logSync) {
      logSync('custom_bridge', modules.join(','), totalRows, 'ok',
        JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.rows || 0]))));
    }
    return { ok: true, total_rows: totalRows, detail: results };
  } catch (e) {
    if (logSync) logSync('custom_bridge', '', 0, 'error', e.message);
    return { ok: false, error: e.message, partial: results };
  }
}

module.exports = setupDenoProxy;
