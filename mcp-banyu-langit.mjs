#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.BANYU_LANGIT_URL || "http://localhost:3003";

async function api(path) {
  try {
    const res = await fetch(BASE + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) { return { error: e.message }; }
}

async function apiPost(path, body) {
  try {
    const res = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } catch (e) { return { error: e.message }; }
}

function ok(d) { return { content: [{ type: "text", text: JSON.stringify(d, null, 2) }] }; }
function err(m) { return { content: [{ type: "text", text: "Error: " + m }], isError: true }; }
function r(d) { return d.error ? err(d.error) : ok(d); }

const s = new McpServer({ name: "banyu-langit", version: "1.0.0" });

s.tool("search_stock", "Search IDX tickers by name or code.", { query: z.string(), limit: z.number().optional() },
  async ({ query, limit }) => r(await api("/api/idx/autocomplete?q=" + encodeURIComponent(query) + "&limit=" + (limit || 10))));

s.tool("get_quote", "Latest price, volume, foreign flow, mcap for one IDX stock.", { code: z.string() },
  async ({ code }) => r(await api("/api/idx/quote?code=" + encodeURIComponent(code.toUpperCase()))));

s.tool("stock_detail", "Full analysis: Wyckoff phase, MA stage, verdict, commentary. Heavy.", { code: z.string() },
  async ({ code }) => { const d = await api("/api/idx/stock-detail/" + encodeURIComponent(code.toUpperCase())); if (d.error) return err(d.error); if (d.data && d.data.length > 60) { d.data = d.data.slice(-60); d._note = "Trimmed to 60 days."; } return ok(d); });

s.tool("market_regime", "5-level top-down: Global>Commodity>IDX>Sector>Decision.", {},
  async () => r(await api("/api/idx/market-regime")));

s.tool("sector_overview", "Sector/industry breakdown: mcap, flow, valuation.", { sector: z.string().optional(), industry: z.string().optional() },
  async ({ sector, industry }) => { let q = ""; if (sector) q += "&sector=" + encodeURIComponent(sector); if (industry) q += "&industry=" + encodeURIComponent(industry); return r(await api("/api/idx/unified?" + q)); });

s.tool("top_movers", "Top stocks by foreign net, change, value, or mcap.", { sort: z.enum(["foreign_net", "change_pct", "value", "market_cap"]).optional(), direction: z.enum(["desc", "asc"]).optional(), limit: z.number().optional() },
  async ({ sort, direction, limit }) => r(await api("/api/idx/top?sort=" + (sort || "foreign_net") + "&dir=" + (direction || "desc") + "&limit=" + (limit || 20))));

s.tool("indices", "IDX indices latest or history.", { mode: z.enum(["latest", "history"]).optional(), code: z.string().optional(), days: z.number().optional() },
  async ({ mode, code, days }) => { if (mode === "history") return r(await api("/api/idx/indices/history?code=" + encodeURIComponent(code || "COMPOSITE") + "&days=" + (days || 500))); return r(await api("/api/idx/indices/latest")); });

s.tool("composite_score", "5-factor scoring. Returns top 100.", { date: z.string().optional() },
  async ({ date }) => r(await api("/api/idx/composite-score" + (date ? "?date=" + encodeURIComponent(date) : ""))));

s.tool("foreign_flow", "Foreign flow history, trimmed to 60 days.", { code: z.string() },
  async ({ code }) => { const d = await api("/api/idx/flow?code=" + encodeURIComponent(code.toUpperCase())); if (d.error) return err(d.error); if (d.data && d.data.length > 60) { d.data = d.data.slice(-60); } return ok(d); });

s.tool("macro_flow", "Market-wide foreign net, total value, breadth.", { days: z.number().optional() },
  async ({ days }) => r(await api("/api/idx/macro-flow?days=" + (days || 60))));

s.tool("price_history", "OHLCV + flow daily series.", { code: z.string(), days: z.number().optional() },
  async ({ code, days }) => { const d = await api("/api/idx/flow?code=" + encodeURIComponent(code.toUpperCase())); if (d.error) return err(d.error); if (d.data && d.data.length > (days || 120)) d.data = d.data.slice(-(days || 120)); return ok(d); });

s.tool("fundamental", "PER, PBV, ROE, DER, EPS, sector, industry.", { code: z.string() },
  async ({ code }) => r(await api("/api/idx/fundamental?code=" + encodeURIComponent(code.toUpperCase()))));

s.tool("run_screener", "AFL formula screener. Example: C > MA50 AND ROE > 15", { formula: z.string(), limit: z.number().optional() },
  async ({ formula, limit }) => r(await apiPost("/api/screener/formula", { formula, limit: limit || 50 })));

s.tool("market_overview", "Global indices, commodities, currencies.", { category: z.enum(["indices", "commodities", "currencies"]).optional() },
  async ({ category }) => r(await api("/api/market" + (category ? "?cat=" + category : ""))));

s.tool("market_digest", "Daily IDX summary: advancers/decliners, value, flow.", {},
  async () => r(await api("/api/idx/digest")));

await s.connect(new StdioServerTransport());