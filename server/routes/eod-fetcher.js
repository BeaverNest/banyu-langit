// ═══ EOD Data Fetcher — Yahoo Finance + CoinGecko ═══
// Yahoo: US stocks, ETFs, indices, commodities, forex (no key, full history)
// CoinGecko: crypto (no key, 365 days)
// Used by /api/idx/custom/fetch-eod endpoint

const https = require('https');

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.get({
      hostname: opts.hostname, path: opts.pathname + opts.search,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...headers }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from ' + opts.hostname)); }
      });
    });
    req.on('error', reject);
  });
}

// ═══ YAHOO FINANCE ═══
// Symbol mapping: internal code → Yahoo symbol
const YAHOO_SYMBOL_MAP = {
  // US Indices
  'SPX': '^GSPC', 'DJI': '^DJI', 'IXIC': '^IXIC', 'NDX': '^NDX',
  'RUT': '^RUT', 'VIX': '^VIX',
  // Asian Indices
  'NIKKEI': '^N225', 'HSI': '^HSI', 'STI': '^STI', 'KLCI': '^KLSE',
  'SET': '^SET.BK', 'KOSPI': '^KS11', 'ASX200': '^AXJO',
  // European
  'FTSE': '^FTSE', 'DAX': '^GDAXI', 'CAC40': '^FCHI',
  // ETFs
  'EIDO': 'EIDO', 'EEM': 'EEM', 'EWJ': 'EWJ', 'FXI': 'FXI',
  // Commodities
  'XAUUSD': 'GC=F', 'GOLD': 'GC=F', 'SILVER': 'SI=F',
  'WTI OIL': 'CL=F', 'WTI': 'CL=F', 'BRENT OIL': 'BZ=F', 'BRENT': 'BZ=F',
  'COPPER': 'HG=F', 'TEMBAGA': 'HG=F', 'PLATINUM': 'PL=F',
  'NATGAS': 'NG=F', 'PALLADIUM': 'PA=F',
  'CPO': 'CPO=F', 'NICKEL': 'NIY=F',
  'ALUMUNIUM': 'ALI=F', 'ALUMINIUM': 'ALI=F',
  'TIMAH': 'SNNY=F', 'TIN': 'SNNY=F',
  'PERAK': 'SI=F',
  // Forex
  'USDIDR': 'USDIDR=X', 'EURUSD': 'EURUSD=X', 'GBPUSD': 'GBPUSD=X',
  'USDJPY': 'USDJPY=X', 'AUDUSD': 'AUDUSD=X', 'USDCNY': 'USDCNY=X',
  'EURJPY': 'EURJPY=X', 'GBPJPY': 'GBPJPY=X',
  // Macro (dipakai blok Macro Signals: VIX, DXY, US10Y). BDI TIDAK tersedia di Yahoo
  // (^BDI/BDIY/BDI=F semuanya 404) — jangan dipetakan ke simbol palsu.
  'DXY': 'DX-Y.NYB', 'US10Y': '^TNX',
};

async function fetchYahoo(code, range = '1y') {
  const symbol = YAHOO_SYMBOL_MAP[code.toUpperCase()] || code;
  // ranges: 1d,5d,1mo,3mo,6mo,1y,2y,5y,10y,ytd,max
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const data = await httpGet(url);

  if (data.chart?.error) {
    throw new Error('Yahoo: ' + (data.chart.error.description || data.chart.error.code || 'Error'));
  }
  const result = data?.chart?.result?.[0];
  if (!result?.timestamp?.length) throw new Error('No data from Yahoo for ' + symbol + ' (code: ' + code + ')');

  const ts = result.timestamp;
  const q = result.indicators?.quote?.[0];
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  if (!q) throw new Error('No quote data from Yahoo');

  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const date = new Date(ts[i] * 1000).toISOString().split('T')[0];
    const close = adj ? (adj[i] || q.close?.[i]) : q.close?.[i];
    if (!close && close !== 0) continue;
    rows.push({
      date,
      open: q.open?.[i] || close,
      high: q.high?.[i] || close,
      low: q.low?.[i] || close,
      close,
      volume: q.volume?.[i] || 0
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

// ═══ COINGECKO (crypto) ═══
// No API key, 10-30 req/min

async function fetchCoinGecko(coinId, days = 365) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=${days}`;
  const data = await httpGet(url, { 'Accept': 'application/json' });

  if (data.error) throw new Error('CoinGecko: ' + data.error);
  if (!data.prices?.length) throw new Error('No data from CoinGecko for ' + coinId);

  // OHLC for better candle data (max 180d free)
  let ohlcMap = {};
  try {
    const ohlcUrl = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/ohlc?vs_currency=usd&days=${Math.min(days, 180)}`;
    const ohlcData = await httpGet(ohlcUrl, { 'Accept': 'application/json' });
    if (Array.isArray(ohlcData)) {
      ohlcData.forEach(([ts, o, h, l, c]) => {
        ohlcMap[new Date(ts).toISOString().split('T')[0]] = { open: o, high: h, low: l, close: c };
      });
    }
  } catch (e) { /* fallback */ }

  const volMap = {};
  if (data.total_volumes) data.total_volumes.forEach(([ts, vol]) => { volMap[new Date(ts).toISOString().split('T')[0]] = vol; });

  const dailyMap = {};
  data.prices.forEach(([ts, price]) => {
    const d = new Date(ts).toISOString().split('T')[0];
    if (!dailyMap[d]) dailyMap[d] = [];
    dailyMap[d].push(price);
  });

  const rows = [];
  for (const [date, prices] of Object.entries(dailyMap)) {
    const ohlc = ohlcMap[date];
    rows.push({
      date,
      open: ohlc ? ohlc.open : prices[0],
      high: ohlc ? ohlc.high : Math.max(...prices),
      low: ohlc ? ohlc.low : Math.min(...prices),
      close: ohlc ? ohlc.close : prices[prices.length - 1],
      volume: volMap[date] || 0
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

const CRYPTO_ID_MAP = {
  'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'BNB': 'binancecoin',
  'XRP': 'ripple', 'ADA': 'cardano', 'DOGE': 'dogecoin', 'DOT': 'polkadot',
  'MATIC': 'matic-network', 'AVAX': 'avalanche-2', 'LINK': 'chainlink',
  'UNI': 'uniswap', 'ATOM': 'cosmos', 'LTC': 'litecoin', 'NEAR': 'near',
  'APT': 'aptos', 'SUI': 'sui', 'ARB': 'arbitrum', 'OP': 'optimism',
  'SEI': 'sei-network', 'TIA': 'celestia', 'JUP': 'jupiter-exchange-solana',
  'PEPE': 'pepe', 'WIF': 'dogwifcoin', 'BONK': 'bonk',
};

// ═══ SOURCE DETECTION ═══
function detectSource(code, category) {
  const upper = code.toUpperCase();
  if (category === 'crypto') return { source: 'coingecko', coinId: CRYPTO_ID_MAP[upper] || upper.toLowerCase() };
  if (CRYPTO_ID_MAP[upper]) return { source: 'coingecko', coinId: CRYPTO_ID_MAP[upper] };
  // Everything else → Yahoo Finance
  return { source: 'yahoo' };
}

// ═══ MAIN ═══
async function fetchEOD(code, category, apiKey, fullHistory = false) {
  const det = detectSource(code, category);
  let rows;

  switch (det.source) {
    case 'yahoo':
      rows = await fetchYahoo(code, fullHistory ? 'max' : '1y');
      break;
    case 'coingecko':
      rows = await fetchCoinGecko(det.coinId, fullHistory ? 365 : 90);
      break;
    default:
      throw new Error('Unknown source for ' + code);
  }

  return { rows, source: det.source, symbol: code };
}

module.exports = { fetchEOD, detectSource, CRYPTO_ID_MAP, YAHOO_SYMBOL_MAP };
