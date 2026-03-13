/**
 * Banyu Langit — Deno Sync Server
 * 
 * Micro HTTP server yang jalan di Windows host.
 * Menerima sync commands dari Docker (Node.js) via HTTP.
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
const CORS = {
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

// ═══ Sync Handlers ═══

async function syncDaily(dateStr: string): Promise<{ ok: boolean; summary: string }> {
  try {
    log(`Stock summary ${dateStr}...`);
    await sync.syncStockSummary(dateStr);
    log(`Index summary ${dateStr}...`);
    await sync.syncIndexSummary(dateStr);
    log(`Daily sync done: ${dateStr}`);
    return { ok: true, summary: `daily ${dateStr} OK` };
  } catch (e) {
    log(`ERROR daily: ${e.message}`);
    return { ok: false, summary: e.message };
  }
}

async function syncFull(from: string, to: string): Promise<{ ok: boolean; summary: string }> {
  try {
    // Generate weekday list
    const dates: string[] = [];
    const start = new Date(from.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"));
    const end = new Date(to.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"));
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) {
        dates.push(
          `${cur.getFullYear()}${String(cur.getMonth() + 1).padStart(2, "0")}${String(cur.getDate()).padStart(2, "0")}`
        );
      }
      cur.setDate(cur.getDate() + 1);
    }

    log(`Full sync: ${dates.length} trading days (${from} → ${to})`);

    // Stock + Index per day
    for (const d of dates) {
      log(`Stock+Index ${d}...`);
      await sync.syncStockSummary(d);
      await sync.syncIndexSummary(d);
    }

    // Monthly data
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
    log(`ERROR full: ${e.message}`);
    return { ok: false, summary: e.message };
  }
}

async function syncCron(): Promise<{ ok: boolean; summary: string }> {
  const today = new Date();
  const day = today.getDay();
  if (day === 0) today.setDate(today.getDate() - 2);
  if (day === 6) today.setDate(today.getDate() - 1);
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const year = today.getFullYear();
  const month = today.getMonth() + 1;

  let ok = 0, fail = 0;

  async function run(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      ok++;
      log(`✓ ${name}`);
    } catch (e) {
      fail++;
      log(`✗ ${name}: ${e.message}`);
    }
  }

  log(`Cron sync starting — date=${dateStr} year=${year} month=${month}`);

  // === Daily data (date-dependent) ===
  await run("syncStockSummary", () => sync.syncStockSummary(dateStr));
  await run("syncIndexSummary", () => sync.syncIndexSummary(dateStr));
  await run("syncTradingDaily", () => sync.syncTradingDaily());
  await run("syncTradeSummary", () => sync.syncTradeSummary());
  await run("syncIndexList", () => sync.syncIndexList());

  // === Monthly data (year+month dependent) ===
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
  await run("syncBrokerSummary", () => sync.syncBrokerSummary(year, month));
  await run("syncAdditionalListing", () => sync.syncAdditionalListing(year, month));
  await run("syncNewListing", () => sync.syncNewListing(year, month));
  await run("syncRightOffering", () => sync.syncRightOffering(year, month));
  await run("syncIndexChart", () => sync.syncIndexChart(year, month));
  await run("syncFinancialReport", () => sync.syncFinancialReport(year, month));
  await run("syncIssuedHistory", () => sync.syncIssuedHistory(year, month));

  // === Snapshot data (no date params) ===
  await run("syncStockScreener", () => sync.syncStockScreener());
  await run("syncSecurityStock", () => sync.syncSecurityStock());
  await run("syncMarketCalendar", () => sync.syncMarketCalendar());
  await run("syncCompanyAnnouncement", () => sync.syncCompanyAnnouncement());
  await run("syncCompanySuspend", () => sync.syncCompanySuspend());
  await run("syncCompanyDelisting", () => sync.syncCompanyDelisting());
  await run("syncCompanyRelisting", () => sync.syncCompanyRelisting());
  await run("syncBrokerParticipant", () => sync.syncBrokerParticipant());
  await run("syncDealerParticipant", () => sync.syncDealerParticipant());
  await run("syncProfileParticipant", () => sync.syncProfileParticipant());
  await run("syncProfileAnnouncement", () => sync.syncProfileAnnouncement());

  // === Heavy: historical + company detail (last) ===
  await run("syncTradingSS", () => sync.syncTradingSS());
  await run("syncCompanyProfile", () => sync.syncCompanyProfile());

  const summary = `Cron done: ${ok} ok, ${fail} fail`;
  log(summary);
  return { ok: fail === 0, summary };
}

// ═══ HTTP Server ═══

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
      { error: "busy", message: `Already running: ${currentJob.type}`, elapsed: Math.round((Date.now() - currentJob.started) / 1000) },
      409
    );
  }

  let body: Record<string, string> = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }

  // Daily sync
  if (path === "/sync/daily") {
    let dateStr = body.date || "";
    if (!dateStr) {
      const today = new Date();
      const day = today.getDay();
      if (day === 0) today.setDate(today.getDate() - 2);
      if (day === 6) today.setDate(today.getDate() - 1);
      dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    }

    currentJob = { type: "daily", started: Date.now(), progress: [] };
    log(`=== Daily sync started: ${dateStr} ===`);

    // Run async (don't await — return immediately)
    syncDaily(dateStr).then((result) => {
      jobHistory.push({ type: "daily", started: currentJob!.started, finished: Date.now(), ok: result.ok, summary: result.summary });
      log(`=== Daily sync finished ===`);
      currentJob = null;
    });

    return jsonResp({ ok: true, message: `Daily sync started: ${dateStr}`, poll: "/status" });
  }

  // Full sync
  if (path === "/sync/full") {
    const today = new Date();
    const day = today.getDay();
    if (day === 0) today.setDate(today.getDate() - 2);
    if (day === 6) today.setDate(today.getDate() - 1);

    const to = body.to || `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 5);
    const from = body.from || `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, "0")}${String(fromDate.getDate()).padStart(2, "0")}`;

    currentJob = { type: "full", started: Date.now(), progress: [] };
    log(`=== Full sync started: ${from} → ${to} ===`);

    syncFull(from, to).then((result) => {
      jobHistory.push({ type: "full", started: currentJob!.started, finished: Date.now(), ok: result.ok, summary: result.summary });
      log(`=== Full sync finished ===`);
      currentJob = null;
    });

    return jsonResp({ ok: true, message: `Full sync started: ${from} → ${to}`, poll: "/status" });
  }

  // Cron sync (all tables)
  if (path === "/sync/cron") {
    currentJob = { type: "cron", started: Date.now(), progress: [] };
    log(`=== Cron sync started ===`);

    syncCron().then((result) => {
      jobHistory.push({ type: "cron", started: currentJob!.started, finished: Date.now(), ok: result.ok, summary: result.summary });
      log(`=== Cron sync finished ===`);
      currentJob = null;
    });

    return jsonResp({ ok: true, message: "Cron sync started (all tables)", poll: "/status" });
  }

  return jsonResp({ error: "unknown endpoint" }, 404);
}

log(`🌊 Banyu Langit Deno Sync Server starting on port ${PORT}...`);
Deno.serve({ port: PORT }, handler);
