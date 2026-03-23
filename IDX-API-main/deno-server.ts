/**
 * Banyu Langit — Deno Sync Server V2
 * 
 * Micro HTTP server yang jalan di Windows host.
 * Menerima sync commands dari Docker (Node.js) via HTTP.
 * 
 * V2: + Custom Sync (user picks modules + date range from UI)
 * 
 * Start:  deno run --allow-all deno-server.ts
 * Port:   3456
 * 
 * Flow:
 *   Browser → Docker:3003 → HTTP → Deno:3456 → idx.co.id → database.sqlite
 *   Docker:3003 then reads database.sqlite via volume mount → bridge → trading.db
 */

import * as sync from "@app/Backend/Sync/index.ts";

const PORT = 3456;
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Track running jobs
let currentJob: { type: string; started: number; progress: string[] } | null = null;
const jobHistory: Array<{ type: string; started: number; finished: number; ok: boolean; summary: string }> = [];

function log(msg: string) {
  const ts = new Date().toLocaleTimeString("id-ID");
  console.log(`[${ts}] ${msg}`);
  if (currentJob) currentJob.progress.push(`[${ts}] ${msg}`);
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

// ═══════════════════════════════════════════
// Helper: date/month range generators
// ═══════════════════════════════════════════

function generateWeekdayDates(fromISO: string, toISO: string): string[] {
  const dates: string[] = [];
  const cur = new Date(fromISO + "T00:00:00");
  const end = new Date(toISO + "T00:00:00");
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      dates.push(`${y}${m}${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function generateMonths(fromISO: string, toISO: string): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  const startD = new Date(fromISO + "T00:00:00");
  const endD = new Date(toISO + "T00:00:00");
  const cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  const endMonth = new Date(endD.getFullYear(), endD.getMonth(), 1);
  while (cur <= endMonth) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function todayYMD(): string {
  const today = new Date();
  const day = today.getDay();
  if (day === 0) today.setDate(today.getDate() - 2);
  if (day === 6) today.setDate(today.getDate() - 1);
  return `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════
// Sync Handlers
// ═══════════════════════════════════════════

async function syncDaily(dateStr: string): Promise<{ ok: boolean; summary: string }> {
  try {
    log(`Stock summary ${dateStr}...`);
    await sync.syncStockSummary(dateStr);
    log(`Index summary ${dateStr}...`);
    await sync.syncIndexSummary(dateStr);
    log(`Daily sync done: ${dateStr}`);
    return { ok: true, summary: `daily ${dateStr} OK` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR daily: ${msg}`);
    return { ok: false, summary: msg };
  }
}

async function syncFull(from: string, to: string): Promise<{ ok: boolean; summary: string }> {
  try {
    const dates = generateWeekdayDates(
      from.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"),
      to.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")
    );

    log(`Full sync: ${dates.length} trading days (${from} → ${to})`);

    for (const d of dates) {
      log(`Stock+Index ${d}...`);
      await sync.syncStockSummary(d);
      await sync.syncIndexSummary(d);
    }

    const year = parseInt(to.substring(0, 4));
    const month = parseInt(to.substring(4, 6));

    log("Screener...");
    await sync.syncStockScreener();
    log(`Financial ratios ${year}-${month}...`);
    await sync.syncFinancialRatio(year, month);
    log(`Dividends ${year}-${month}...`);
    await sync.syncCompanyDividend(year, month);
    log(`Stock splits ${year}-${month}...`);
    await sync.syncStockSplit(year, month);
    log("Company profiles...");
    await sync.syncCompanyProfile();

    log("Full sync done!");
    return { ok: true, summary: `full sync ${dates.length} days + monthly data OK` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`ERROR full: ${msg}`);
    return { ok: false, summary: msg };
  }
}

async function syncCron(): Promise<{ ok: boolean; summary: string }> {
  const dateStr = todayYMD();
  const year = parseInt(dateStr.substring(0, 4));
  const month = parseInt(dateStr.substring(4, 6));

  let ok = 0, fail = 0;

  async function run(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      ok++;
      log(`✓ ${name}`);
    } catch (e) {
      fail++;
      const msg = e instanceof Error ? e.message : String(e);
      log(`✗ ${name}: ${msg}`);
    }
  }

  log(`Cron sync starting — date=${dateStr} year=${year} month=${month}`);

  await run("syncStockSummary", () => sync.syncStockSummary(dateStr));
  await run("syncIndexSummary", () => sync.syncIndexSummary(dateStr));
  await run("syncTradeSummary", () => sync.syncTradeSummary());
  await run("syncIndexList", () => sync.syncIndexList());
  await run("syncFinancialRatio", () => sync.syncFinancialRatio(year, month));
  await run("syncCompanyDividend", () => sync.syncCompanyDividend(year, month));
  await run("syncStockSplit", () => sync.syncStockSplit(year, month));
  await run("syncForeignTrading", () => sync.syncForeignTrading(year, month));
  await run("syncDomesticTrading", () => sync.syncDomesticTrading(year, month));
  await run("syncIndustryTrading", () => sync.syncIndustryTrading(year, month));
  await run("syncSectoralMovement", () => sync.syncSectoralMovement(year, month));
  await run("syncDailyIndex", () => sync.syncDailyIndex(year, month));
  await run("syncTopGainer", () => sync.syncTopGainer(year, month));
  await run("syncTopLoser", () => sync.syncTopLoser(year, month));
  await run("syncActiveVolume", () => sync.syncActiveVolume(year, month));
  await run("syncActiveValue", () => sync.syncActiveValue(year, month));
  await run("syncActiveFrequency", () => sync.syncActiveFrequency(year, month));
  await run("syncStockScreener", () => sync.syncStockScreener());
  await run("syncSecurityStock", () => sync.syncSecurityStock());
  await run("syncCompanySuspend", () => sync.syncCompanySuspend());
  await run("syncCompanyRelisting", () => sync.syncCompanyRelisting());
  await run("syncBrokerParticipant", () => sync.syncBrokerParticipant());
  await run("syncDealerParticipant", () => sync.syncDealerParticipant());
  await run("syncProfileParticipant", () => sync.syncProfileParticipant());
  await run("syncCompanyProfile", () => sync.syncCompanyProfile());

  const summary = `Cron done: ${ok} ok, ${fail} fail`;
  log(summary);
  return { ok: fail === 0, summary };
}

// ═══════════════════════════════════════════════════════
// CUSTOM SYNC — user picks modules + date range from UI
// ═══════════════════════════════════════════════════════

async function syncCustom(
  modules: string[],
  fromISO: string,
  toISO: string
): Promise<{ ok: boolean; summary: string }> {
  const dates = generateWeekdayDates(fromISO, toISO);
  const months = generateMonths(fromISO, toISO);
  let totalOk = 0, totalFail = 0;

  log(`Custom sync: ${modules.join(", ")}`);
  log(`Date range: ${fromISO} → ${toISO} (${dates.length} trading days, ${months.length} months)`);

  // ── Per-date modules ──
  const perDate: Record<string, (d: string) => Promise<unknown>> = {
    stock_summary: (d) => sync.syncStockSummary(d),
    index_summary: (d) => sync.syncIndexSummary(d),
    broker_summary: (d) => sync.syncBrokerSummary(d),
    announcements: (d) => sync.syncCompanyAnnouncement(d),
    market_calendar: (d) => sync.syncMarketCalendar(d),
  };

  // ── Per-month modules ──
  const perMonth: Record<string, (y: number, m: number) => Promise<unknown>> = {
    financial_ratio: (y, m) => sync.syncFinancialRatio(y, m),
    dividends: (y, m) => sync.syncCompanyDividend(y, m),
    stock_split: (y, m) => sync.syncStockSplit(y, m),
    foreign_trading: (y, m) => sync.syncForeignTrading(y, m),
    domestic_trading: (y, m) => sync.syncDomesticTrading(y, m),
    industry_trading: (y, m) => sync.syncIndustryTrading(y, m),
    sectoral: (y, m) => sync.syncSectoralMovement(y, m),
    daily_index: (y, m) => sync.syncDailyIndex(y, m),
    top_movers: async (y, m) => {
      await sync.syncTopGainer(y, m);
      await sync.syncTopLoser(y, m);
    },
    active_stocks: async (y, m) => {
      await sync.syncActiveVolume(y, m);
      await sync.syncActiveValue(y, m);
      await sync.syncActiveFrequency(y, m);
    },
  };

  // ── No-date modules ──
  const noDate: Record<string, () => Promise<unknown>> = {
    screener: () => sync.syncStockScreener(),
    company_profile: () => sync.syncCompanyProfile(),
    suspends: () => sync.syncCompanySuspend(),
    index_list: () => sync.syncIndexList(),
    index_chart: async () => {
      const indices = ["COMPOSITE", "LQ45", "IDX30", "IDXHIDIV20", "IDXBUMN20",
        "IDXFINANCE", "IDXENERGY", "IDXBASIC", "IDXINDUST", "IDXNONCYC", "IDXCYCLIC"];
      for (const idx of indices) {
        try { await sync.syncIndexChart(idx); } catch { /* skip */ }
        await delay(500);
      }
    },
  };

  for (const mod of modules) {
    // ── Per-date: loop each trading day ──
    if (perDate[mod]) {
      log(`⏳ ${mod}: syncing ${dates.length} dates...`);
      let done = 0, errors = 0;
      for (const d of dates) {
        try {
          await perDate[mod](d);
          done++;
          if (done % 10 === 0 || done === dates.length) {
            log(`  ${mod}: ${done}/${dates.length} dates`);
          }
          totalOk++;
        } catch (e) {
          errors++;
          totalFail++;
          const msg = e instanceof Error ? e.message : String(e);
          if (errors <= 3) log(`  ✗ ${mod} ${d}: ${msg}`);
        }
        await delay(1500); // rate limit
      }
      log(`✓ ${mod}: ${done} dates synced${errors ? `, ${errors} errors` : ""}`);
      continue;
    }

    // ── Per-month: loop each month ──
    if (perMonth[mod]) {
      log(`⏳ ${mod}: syncing ${months.length} months...`);
      let done = 0, errors = 0;
      for (const { year, month } of months) {
        try {
          await perMonth[mod](year, month);
          done++;
          log(`  ${mod}: ${year}-${String(month).padStart(2, "0")} ✓`);
          totalOk++;
        } catch (e) {
          errors++;
          totalFail++;
          const msg = e instanceof Error ? e.message : String(e);
          log(`  ✗ ${mod} ${year}-${String(month).padStart(2, "0")}: ${msg}`);
        }
        await delay(2000); // rate limit
      }
      log(`✓ ${mod}: ${done} months synced${errors ? `, ${errors} errors` : ""}`);
      continue;
    }

    // ── No-date: run once ──
    if (noDate[mod]) {
      log(`⏳ ${mod}...`);
      try {
        await noDate[mod]();
        log(`✓ ${mod} done`);
        totalOk++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`✗ ${mod}: ${msg}`);
        totalFail++;
      }
      await delay(1000);
      continue;
    }

    log(`⚠ Unknown module: ${mod}, skipped`);
  }

  const summary = `Custom sync done: ${modules.length} modules, ${totalOk} ok, ${totalFail} fail`;
  log(`✓ ${summary}`);
  return { ok: totalFail === 0, summary };
}

// ═══════════════════════════════════════════
// HTTP Server
// ═══════════════════════════════════════════

function startJob(type: string): void {
  currentJob = { type, started: Date.now(), progress: [] };
}

function finishJob(type: string, result: { ok: boolean; summary: string }): void {
  jobHistory.push({
    type,
    started: currentJob?.started ?? Date.now(),
    finished: Date.now(),
    ok: result.ok,
    summary: result.summary,
  });
  currentJob = null;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Health check
  if (path === "/" || path === "/health") {
    return jsonResp({
      ok: true,
      service: "banyu-langit-deno-sync",
      running: currentJob ? currentJob.type : null,
      uptime: Math.round(performance.now() / 1000),
      history: jobHistory.slice(-10),
    });
  }

  // Status (progress of current job)
  if (path === "/status") {
    if (!currentJob) {
      return jsonResp({ running: false, last: jobHistory[jobHistory.length - 1] || null });
    }
    return jsonResp({
      running: true,
      type: currentJob.type,
      started: currentJob.started,
      elapsed: Math.round((Date.now() - currentJob.started) / 1000),
      progress: currentJob.progress,
    });
  }

  // ═══ Sync endpoints ═══

  if (req.method !== "POST") {
    return jsonResp({ error: "POST only" }, 405);
  }

  // Reject if already running
  if (currentJob) {
    return jsonResp(
      {
        error: "busy",
        message: `Already running: ${currentJob.type}`,
        elapsed: Math.round((Date.now() - currentJob.started) / 1000),
      },
      409
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine for some endpoints
  }

  // ── Daily sync ──
  if (path === "/sync/daily") {
    let dateStr = (body.date as string) || "";
    if (!dateStr) dateStr = todayYMD();

    startJob("daily");
    log(`=== Daily sync started: ${dateStr} ===`);

    syncDaily(dateStr).then((result) => {
      log(`=== Daily sync finished ===`);
      finishJob("daily", result);
    });

    return jsonResp({ ok: true, message: `Daily sync started: ${dateStr}`, poll: "/status" });
  }

  // ── Full sync ──
  if (path === "/sync/full") {
    const today = todayYMD();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 5);
    const defaultFrom = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, "0")}${String(fromDate.getDate()).padStart(2, "0")}`;

    const to = (body.to as string) || today;
    const from = (body.from as string) || defaultFrom;

    startJob("full");
    log(`=== Full sync started: ${from} → ${to} ===`);

    syncFull(from, to).then((result) => {
      log(`=== Full sync finished ===`);
      finishJob("full", result);
    });

    return jsonResp({ ok: true, message: `Full sync started: ${from} → ${to}`, poll: "/status" });
  }

  // ── Cron sync (all tables) ──
  if (path === "/sync/cron") {
    startJob("cron");
    log(`=== Cron sync started ===`);

    syncCron().then((result) => {
      log(`=== Cron sync finished ===`);
      finishJob("cron", result);
    });

    return jsonResp({ ok: true, message: "Cron sync started (all tables)", poll: "/status" });
  }

  // ── Custom sync (user picks modules + date range) ──
  if (path === "/sync/custom") {
    const modules = body.modules as string[] | undefined;
    const from = body.from as string | undefined;
    const to = body.to as string | undefined;

    if (!modules || !Array.isArray(modules) || !modules.length) {
      return jsonResp({ ok: false, error: "No modules selected" }, 400);
    }
    if (!from || !to) {
      return jsonResp({ ok: false, error: "Date range required (from, to as YYYY-MM-DD)" }, 400);
    }

    startJob("custom");
    log(`=== Custom sync started: ${modules.length} modules, ${from} → ${to} ===`);

    syncCustom(modules, from, to).then((result) => {
      log(`=== Custom sync finished ===`);
      finishJob("custom", result);
    });

    return jsonResp({
      ok: true,
      message: `Custom sync started: ${modules.length} modules, ${from} → ${to}`,
      modules,
      from,
      to,
      poll: "/status",
    });
  }

  return jsonResp({ error: "unknown endpoint" }, 404);
}

log(`🌊 Banyu Langit Deno Sync Server V2 starting on port ${PORT}...`);
Deno.serve({ port: PORT }, handler);
