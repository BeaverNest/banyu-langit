// Yahoo Finance quote fetcher with cache

const yqCache = {};

async function yq(symbol) {
  if (!symbol) return null;
  const now = Date.now();
  if (yqCache[symbol] && now - yqCache[symbol].ts < 30000) return yqCache[symbol].data;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
    const j = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    if (!m) return null;
    const data = {
      price: m.regularMarketPrice || 0,
      change: m.regularMarketPrice && m.chartPreviousClose
        ? Math.round((m.regularMarketPrice - m.chartPreviousClose) / m.chartPreviousClose * 10000) / 100
        : 0,
      name: m.shortName || m.symbol || symbol,
      currency: m.currency || '',
      exchange: m.exchangeName || ''
    };
    yqCache[symbol] = { data, ts: now };
    return data;
  } catch { return null; }
}

module.exports = { yq };
