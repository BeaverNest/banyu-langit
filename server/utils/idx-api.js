/**
 * IDX API Client for Banyu Langit
 * Reverse-engineered from NeaByteLab/IDX-API
 *
 * Base: https://www.idx.co.id/primary/
 * Session: fetch idx.co.id/id first → extract cookies → use for all requests
 * Retry: exponential backoff, max 5 attempts
 */

const BROWSER_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Referer': 'https://www.idx.co.id/',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
};

let sessionCookie = '';
let sessionExpiry = 0;
const SESSION_TTL = 25 * 60 * 1000; // 25 minutes

// ═══ Session Management ═══

async function ensureSession() {
  if (sessionCookie && Date.now() < sessionExpiry) return;

  // Step 1: fetch main page to get cookies
  const res1 = await fetch('https://www.idx.co.id/id', {
    headers: BROWSER_HEADERS,
    redirect: 'follow'
  });
  const setCookies = res1.headers.getSetCookie ? res1.headers.getSetCookie() : [];
  sessionCookie = setCookies.join('; ');
  await res1.text(); // consume body

  // Step 2: validate session
  await wait(1000);
  const res2 = await fetchUrl('https://www.idx.co.id/primary/home/GetIndexList');
  await res2.text(); // consume body

  sessionExpiry = Date.now() + SESSION_TTL;
  console.log('[IDX-API] Session initialized');
}

// ═══ Fetcher with Retry ═══

async function fetchUrl(url, maxAttempts = 5) {
  const headers = {
    ...BROWSER_HEADERS,
    'X-Requested-With': 'XMLHttpRequest',
    ...(sessionCookie ? { Cookie: sessionCookie } : {})
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok && res.status >= 500) {
        throw new Error(`Server ${res.status}: ${res.statusText}`);
      }
      return res;
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 15000);
      console.warn(`[IDX-API] Retry ${attempt}/${maxAttempts} for ${url.split('?')[0]} in ${delay/1000}s — ${err.message}`);
      await wait(delay);
    }
  }
}

async function fetchJSON(url) {
  await ensureSession();
  const res = await fetchUrl(url);
  return res.json();
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ═══ Date helpers ═══

function fmtDate(d) {
  // Date → 'YYYYMMDD'
  if (typeof d === 'string') return d.replace(/-/g, '');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

function fmtDateISO(d) {
  // Date or 'YYYYMMDD' → 'YYYY-MM-DD'
  const s = typeof d === 'string' ? d : fmtDate(d);
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
}

function parseIDXDate(dateStr) {
  // IDX returns ISO dates like "2024-02-20T00:00:00" or "/Date(1708387200000)/"
  if (!dateStr) return '';
  if (dateStr.startsWith('/Date(')) {
    const ms = parseInt(dateStr.match(/\d+/)?.[0] || '0');
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  // "2024-02-20T00:00:00" → "2024-02-20"
  return dateStr.slice(0, 10);
}

// ═══ API Methods ═══

/**
 * Stock Summary — OHLCV + foreign flow for ALL stocks on a given date
 * Maps to: idx_daily table
 * URL: /primary/TradingSummary/GetStockSummary?date=YYYYMMDD
 */
async function getStockSummary(date) {
  const d = fmtDate(date);
  const json = await fetchJSON(
    `https://www.idx.co.id/primary/TradingSummary/GetStockSummary?date=${d}`
  );
  if (!json || !Array.isArray(json.data)) return [];

  return json.data.map(item => ({
    trade_date: parseIDXDate(item.Date) || fmtDateISO(d),
    code: (item.StockCode || '').trim().toUpperCase(),
    name: (item.StockName || '').trim(),
    prev_close: item.Previous || 0,
    open_price: item.OpenPrice || 0,
    high: item.High || 0,
    low: item.Low || 0,
    close: item.Close || 0,
    change: item.Change || 0,
    volume: item.Volume || 0,
    value: item.Value || 0,
    frequency: item.Frequency || 0,
    bid: item.Bid || 0,
    bid_vol: item.BidVolume || 0,
    offer: item.Offer || 0,
    offer_vol: item.OfferVolume || 0,
    listed_shares: item.ListedShares || 0,
    tradeable_shares: item.TradebleShares || 0,
    foreign_buy: item.ForeignBuy || 0,
    foreign_sell: item.ForeignSell || 0
  })).filter(r => r.code);
}

/**
 * Index Summary — all 45 BEI indices for a given date
 * Maps to: idx_indices table
 * URL: /primary/TradingSummary/GetIndexSummary?lang=id&date=YYYYMMDD&start=0&length=9999
 */
async function getIndexSummary(date) {
  const d = fmtDate(date);
  const json = await fetchJSON(
    `https://www.idx.co.id/primary/TradingSummary/GetIndexSummary?lang=id&date=${d}&start=0&length=9999`
  );
  if (!json || !Array.isArray(json.data)) return [];

  return json.data.map(item => ({
    trade_date: parseIDXDate(item.Date) || fmtDateISO(d),
    index_code: (item.IndexCode || '').trim(),
    previous: item.Previous || 0,
    highest: item.Highest || 0,
    lowest: item.Lowest || 0,
    close: item.Close || 0,
    change_val: item.Change || 0,
    volume: item.Volume || 0,
    value: item.Value || 0,
    frequency: item.Frequency || 0,
    market_cap: item.MarketCapital || 0
  })).filter(r => r.index_code);
}

/**
 * Financial Ratios — PER, PBV, ROE, DER for all stocks
 * Maps to: idx_fundamental table
 * URL: /primary/DigitalStatistic/GetApiDataPaginated?urlName=LINK_FINANCIAL_DATA_RATIO&periodYear=YYYY&periodMonth=MM&...
 */
async function getFinancialRatios(year, month) {
  const json = await fetchJSON(
    `https://www.idx.co.id/primary/DigitalStatistic/GetApiDataPaginated?urlName=LINK_FINANCIAL_DATA_RATIO&periodYear=${year}&periodMonth=${month}&periodType=monthly&isPrint=False&cumulative=false`
  );
  if (!json || !Array.isArray(json.data)) return [];

  const snapshotMonth = `${year}-${String(month).padStart(2, '0')}`;
  return json.data.map(item => ({
    snapshot_month: snapshotMonth,
    code: (item.code || '').trim().toUpperCase(),
    name: item.stockName || '',
    sector: item.sector || '',
    subsector: item.subSector || '',
    industry: item.industry || '',
    subindustry: item.subIndustry || '',
    per: item.per || 0,
    pbv: item.priceBV || 0,
    roe: item.roe || 0,
    roa: item.roa || 0,
    der: item.deRatio || 0,
    npm: item.npm || 0,
    mkt_cap: 0,
    total_rev: item.sales || 0
  })).filter(r => r.code);
}

/**
 * Stock Splits
 * Maps to: corporate_actions table
 * URL: /primary/DigitalStatistic/GetApiDataPaginated?urlName=LINK_STOCK_SPLIT&...
 */
async function getStockSplits(year, month) {
  const json = await fetchJSON(
    `https://www.idx.co.id/primary/DigitalStatistic/GetApiDataPaginated?urlName=LINK_STOCK_SPLIT&periodYear=${year}&periodMonth=${month}&periodType=monthly&isPrint=False&cumulative=false&pageSize=100&pageNumber=1`
  );
  if (!json || !Array.isArray(json.data)) return [];

  return json.data.map(item => {
    // Parse ratio like "1:5" → numeric 5
    let ratio = 1;
    const ratioStr = item.Ratio || '';
    const parts = ratioStr.split(':');
    if (parts.length === 2) {
      const old = parseInt(parts[0]) || 1;
      const newP = parseInt(parts[1]) || 1;
      ratio = newP / old;
    }

    return {
      code: (item.code || '').trim().toUpperCase(),
      ex_date: parseIDXDate(item.ListingDate) || '',
      action_type: (item.ssrs || 'split').toLowerCase().includes('reverse') ? 'reverse_split' : 'split',
      ratio: ratio,
      old_nominal: item.NominalValue || 0,
      new_nominal: item.NominalValueNew || 0,
      old_shares: 0,
      new_shares: item.ListedShares || 0,
      notes: `${item.ssrs || ''} ratio=${ratioStr}`
    };
  }).filter(r => r.code && r.ex_date);
}

/**
 * Dividend Announcements
 * URL: /primary/DigitalStatistic/GetApiDataPaginated?urlName=LINK_DIVIDEND&...
 */
async function getDividends(year, month) {
  const json = await fetchJSON(
    `https://www.idx.co.id/primary/DigitalStatistic/GetApiDataPaginated?urlName=LINK_DIVIDEND&periodYear=${year}&periodMonth=${month}&periodType=monthly&isPrint=False&cumulative=false&pageSize=100&pageNumber=1`
  );
  if (!json || !Array.isArray(json.data)) return [];

  return json.data.map(item => ({
    code: (item.code || '').trim().toUpperCase(),
    name: item.name || '',
    cash_dividend: item.cashDividend || 0,
    cum_dividend: item.cumDividend || '',
    ex_dividend: item.exDividend || '',
    record_date: item.recordDate || '',
    payment_date: item.paymentDate || ''
  })).filter(r => r.code);
}

/**
 * Index List — real-time prices for all indices
 * URL: /primary/home/GetIndexList
 */
async function getIndexList() {
  const json = await fetchJSON(
    'https://www.idx.co.id/primary/home/GetIndexList'
  );
  if (!Array.isArray(json)) return [];

  return json.map(item => ({
    code: item.IndexCode || '',
    close: item.Closing || '',
    change: item.Change || '',
    percent: item.Percent || '',
    current: item.Current || ''
  }));
}

/**
 * Company Profiles — basic metadata for all listed companies
 * URL: /primary/ListedCompany/GetCompanyProfiles?start=0&length=9999
 */
async function getCompanyProfiles() {
  const json = await fetchJSON(
    'https://www.idx.co.id/primary/ListedCompany/GetCompanyProfiles?start=0&length=9999'
  );
  if (!json || !json.data) return [];

  return json.data.map(item => ({
    code: (item.KodeEmiten || '').trim(),
    name: (item.NamaEmiten || '').trim(),
    listing_date: item.TanggalPencatatan || ''
  }));
}

/**
 * Company Profile Detail — full metadata for a single company
 * URL: /primary/ListedCompany/GetCompanyProfilesDetail?KodeEmiten=BBCA&language=id-id
 */
async function getCompanyProfileDetail(code) {
  const json = await fetchJSON(
    `https://www.idx.co.id/primary/ListedCompany/GetCompanyProfilesDetail?KodeEmiten=${code}&language=id-id`
  );
  if (!json || !json.Profiles || !json.Profiles.length) return null;

  const p = json.Profiles[0];
  return {
    code: p.KodeEmiten || code,
    name: p.NamaEmiten || '',
    sector: p.Sektor || '',
    sub_sector: p.SubSektor || '',
    industry: p.Industri || '',
    sub_industry: p.SubIndustri || '',
    board: p.PapanPencatatan || '',
    listing_date: p.TanggalPencatatan || '',
    address: p.Alamat || '',
    website: p.Website || '',
    email: p.Email || '',
    phone: p.Telepon || '',
    status: p.Status || '',
    shareholders: (json.PemegangSaham || []).map(s => ({
      name: s.Nama, count: s.Jumlah, pct: s.Persentase
    })),
    directors: (json.Direktur || []).map(d => ({
      name: d.Nama, position: d.Jabatan
    }))
  };
}

/**
 * Stock Screener — comprehensive analytics (PER/PBV/ROE + price changes)
 * Maps to: idx_fundamental table (enriched)
 * URL: /support/stock-screener/api/v1/stock-screener/get
 */
async function getStockScreener() {
  const json = await fetchJSON(
    'https://www.idx.co.id/support/stock-screener/api/v1/stock-screener/get?Sector=&SubSector='
  );
  if (!json || !Array.isArray(json.results)) return [];

  return json.results.map(item => ({
    code: (item.stockCode || '').trim().toUpperCase(),
    name: item.companyName || '',
    sector: item.sector || '',
    subsector: item.subSector || '',
    industry: item.industry || '',
    subindustry: item.subIndustry || '',
    per: item.per || 0,
    pbv: item.pbv || 0,
    roe: item.roe || 0,
    roa: item.roa || 0,
    der: item.der || 0,
    npm: item.npm || 0,
    mkt_cap: item.marketCapital || 0,
    total_rev: item.tRevenue || 0,
    chg_4w: item.week4PC || 0,
    chg_13w: item.week13PC || 0,
    chg_26w: item.week26PC || 0,
    chg_52w: item.week52PC || 0,
    mtd: item.mtdpc || 0,
    ytd: item.ytdpc || 0
  })).filter(r => r.code);
}

/**
 * Batch sync: fetch multiple dates in sequence with delay
 */
async function batchStockSummary(dates, delayMs = 2000) {
  const results = [];
  for (const d of dates) {
    try {
      const data = await getStockSummary(d);
      results.push({ date: d, rows: data.length, data });
      if (dates.indexOf(d) < dates.length - 1) await wait(delayMs);
    } catch (err) {
      results.push({ date: d, rows: 0, error: err.message });
    }
  }
  return results;
}

async function batchIndexSummary(dates, delayMs = 2000) {
  const results = [];
  for (const d of dates) {
    try {
      const data = await getIndexSummary(d);
      results.push({ date: d, rows: data.length, data });
      if (dates.indexOf(d) < dates.length - 1) await wait(delayMs);
    } catch (err) {
      results.push({ date: d, rows: 0, error: err.message });
    }
  }
  return results;
}

// ═══ Reset session (for manual refresh) ═══
function resetSession() {
  sessionCookie = '';
  sessionExpiry = 0;
}

module.exports = {
  ensureSession,
  resetSession,
  getStockSummary,
  getIndexSummary,
  getFinancialRatios,
  getStockSplits,
  getDividends,
  getIndexList,
  getCompanyProfiles,
  getCompanyProfileDetail,
  getStockScreener,
  batchStockSummary,
  batchIndexSummary,
  wait
};
