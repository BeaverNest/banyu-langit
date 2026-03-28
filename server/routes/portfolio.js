const express = require('express');
const { db, latestIdxDate } = require('../db');

const router = express.Router();

// ═══ Auto-create tables ═══
db.exec(`
  CREATE TABLE IF NOT EXISTS portfolio_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    capital REAL DEFAULT 100000000,
    win_rate REAL DEFAULT 50,
    risk_per_trade REAL DEFAULT 2,
    kelly_fraction REAL DEFAULT 50,
    updated_at TEXT DEFAULT (datetime('now'))
  );
  INSERT OR IGNORE INTO portfolio_settings(id) VALUES(1);

  CREATE TABLE IF NOT EXISTS portfolio_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT DEFAULT '',
    trade_type TEXT DEFAULT 'buy',
    status TEXT DEFAULT 'open',
    entry_date TEXT NOT NULL,
    entry_price REAL NOT NULL,
    lots INTEGER NOT NULL DEFAULT 1,
    stop_loss REAL DEFAULT 0,
    target_price REAL DEFAULT 0,
    exit_date TEXT DEFAULT NULL,
    exit_price REAL DEFAULT NULL,
    exit_lots INTEGER DEFAULT NULL,
    fees REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pt_code ON portfolio_trades(code);
  CREATE INDEX IF NOT EXISTS idx_pt_status ON portfolio_trades(status);
`);

// ═══ Settings ═══
router.get('/settings', (req, res) => {
  const s = db.prepare('SELECT * FROM portfolio_settings WHERE id=1').get();
  res.json(s || { capital: 100000000, win_rate: 50, risk_per_trade: 2, kelly_fraction: 50 });
});

router.put('/settings', (req, res) => {
  const { capital, win_rate, risk_per_trade, kelly_fraction } = req.body;
  db.prepare("UPDATE portfolio_settings SET capital=?, win_rate=?, risk_per_trade=?, kelly_fraction=?, updated_at=datetime('now') WHERE id=1")
    .run(capital || 100000000, win_rate || 50, risk_per_trade || 2, kelly_fraction || 50);
  res.json({ success: true });
});

// ═══ Trades CRUD ═══
router.get('/trades', (req, res) => {
  const status = req.query.status || 'all';
  let trades;
  if (status === 'all') trades = db.prepare('SELECT * FROM portfolio_trades ORDER BY entry_date DESC, created_at DESC').all();
  else trades = db.prepare('SELECT * FROM portfolio_trades WHERE status=? ORDER BY entry_date DESC, created_at DESC').all(status);

  // Attach current price for open trades
  const td = latestIdxDate();
  if (td) {
    const priceMap = {};
    db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=?').all(td).forEach(r => { priceMap[r.code] = r.close; });
    trades.forEach(t => { t.current_price = priceMap[t.code] || null; });
  }

  res.json(trades);
});

router.post('/trades', (req, res) => {
  try {
    const { code, name, trade_type, entry_date, entry_price, lots, stop_loss, target_price, notes } = req.body;
    if (!code || !entry_price || !lots) return res.status(400).json({ error: 'code, entry_price, lots required' });

    const r = db.prepare(`INSERT INTO portfolio_trades(code, name, trade_type, entry_date, entry_price, lots, stop_loss, target_price, notes)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      code.toUpperCase(), name || '', trade_type || 'buy',
      entry_date || new Date().toISOString().split('T')[0],
      entry_price, lots, stop_loss || 0, target_price || 0, notes || ''
    );
    res.json({ success: true, id: r.lastInsertRowid });
  } catch (e) { res.json({ error: e.message }); }
});

router.put('/trades/:id', (req, res) => {
  try {
    const { entry_price, lots, stop_loss, target_price, notes, status, exit_date, exit_price, exit_lots } = req.body;
    const trade = db.prepare('SELECT * FROM portfolio_trades WHERE id=?').get(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    db.prepare(`UPDATE portfolio_trades SET
      entry_price=?, lots=?, stop_loss=?, target_price=?, notes=?, status=?,
      exit_date=?, exit_price=?, exit_lots=?
      WHERE id=?`).run(
      entry_price || trade.entry_price,
      lots || trade.lots,
      stop_loss !== undefined ? stop_loss : trade.stop_loss,
      target_price !== undefined ? target_price : trade.target_price,
      notes !== undefined ? notes : trade.notes,
      status || trade.status,
      exit_date || trade.exit_date,
      exit_price || trade.exit_price,
      exit_lots || trade.exit_lots,
      req.params.id
    );
    res.json({ success: true });
  } catch (e) { res.json({ error: e.message }); }
});

// Close trade
router.post('/trades/:id/close', (req, res) => {
  try {
    const { exit_price, exit_date, exit_lots } = req.body;
    const trade = db.prepare('SELECT * FROM portfolio_trades WHERE id=?').get(req.params.id);
    if (!trade) return res.status(404).json({ error: 'Trade not found' });
    if (!exit_price) return res.status(400).json({ error: 'exit_price required' });

    db.prepare("UPDATE portfolio_trades SET status='closed', exit_price=?, exit_date=?, exit_lots=? WHERE id=?")
      .run(exit_price, exit_date || new Date().toISOString().split('T')[0], exit_lots || trade.lots, req.params.id);
    res.json({ success: true });
  } catch (e) { res.json({ error: e.message }); }
});

router.delete('/trades/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM portfolio_trades WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch (e) { res.json({ error: e.message }); }
});

// ═══ Kelly Calculator ═══
router.get('/kelly', (req, res) => {
  const settings = db.prepare('SELECT * FROM portfolio_settings WHERE id=1').get();
  const code = (req.query.code || '').toUpperCase();

  // Get trade stats from history
  const closed = db.prepare("SELECT * FROM portfolio_trades WHERE status='closed'").all();
  let winRate = settings.win_rate / 100;
  let avgWin = 0, avgLoss = 0, totalWins = 0, totalLosses = 0;

  if (closed.length >= 5) {
    const wins = [], losses = [];
    closed.forEach(t => {
      const pnl = (t.exit_price - t.entry_price) * (t.exit_lots || t.lots) * 100;
      if (pnl > 0) wins.push(pnl); else if (pnl < 0) losses.push(Math.abs(pnl));
    });
    totalWins = wins.length;
    totalLosses = losses.length;
    if (wins.length + losses.length >= 5) {
      winRate = wins.length / (wins.length + losses.length);
      avgWin = wins.length ? wins.reduce((s, v) => s + v, 0) / wins.length : 0;
      avgLoss = losses.length ? losses.reduce((s, v) => s + v, 0) / losses.length : 1;
    }
  }

  const rr = avgLoss > 0 ? avgWin / avgLoss : 2; // default 2:1 if no data
  const kellyPct = Math.max(0, winRate - (1 - winRate) / rr);
  const adjKelly = kellyPct * (settings.kelly_fraction / 100); // fractional kelly

  // Get current price + ATR for the ticker
  let tickerData = null;
  if (code) {
    const td = latestIdxDate();
    if (td) {
      const quote = db.prepare('SELECT * FROM idx_daily WHERE code=? AND trade_date=?').get(code, td);
      if (quote) {
        // Calculate ATR(14)
        const hist = db.prepare('SELECT high, low, close FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT 15').all(code);
        let atr = 0;
        if (hist.length >= 2) {
          const trs = [];
          for (let i = 0; i < hist.length - 1; i++) {
            const tr = Math.max(hist[i].high - hist[i].low, Math.abs(hist[i].high - hist[i + 1].close), Math.abs(hist[i].low - hist[i + 1].close));
            trs.push(tr);
          }
          atr = Math.round(trs.reduce((s, v) => s + v, 0) / trs.length);
        }

        // MA levels
        const closes = db.prepare('SELECT close FROM idx_daily WHERE code=? ORDER BY trade_date DESC LIMIT 200').all(code).map(r => r.close);
        const ma20 = closes.length >= 20 ? Math.round(closes.slice(0, 20).reduce((s, v) => s + v, 0) / 20) : null;
        const ma50 = closes.length >= 50 ? Math.round(closes.slice(0, 50).reduce((s, v) => s + v, 0) / 50) : null;
        const ma200 = closes.length >= 200 ? Math.round(closes.slice(0, 200).reduce((s, v) => s + v, 0) / 200) : null;

        // Recent low as potential support
        const low20 = closes.length >= 20 ? Math.min(...closes.slice(0, 20)) : null;

        tickerData = {
          code: quote.code, name: quote.name, close: quote.close,
          high: quote.high, low: quote.low, volume: quote.volume,
          atr, ma20, ma50, ma200, low20
        };
      }
    }
  }

  res.json({
    settings: { capital: settings.capital, risk_per_trade: settings.risk_per_trade, kelly_fraction: settings.kelly_fraction },
    stats: { win_rate: Math.round(winRate * 1000) / 10, rr: Math.round(rr * 100) / 100, total_trades: closed.length, wins: totalWins, losses: totalLosses, source: closed.length >= 5 ? 'history' : 'manual' },
    kelly: { raw: Math.round(kellyPct * 1000) / 10, adjusted: Math.round(adjKelly * 1000) / 10 },
    ticker: tickerData
  });
});

// ═══ Dashboard Stats ═══
router.get('/stats', (req, res) => {
  const settings = db.prepare('SELECT * FROM portfolio_settings WHERE id=1').get();
  const openTrades = db.prepare("SELECT * FROM portfolio_trades WHERE status='open'").all();
  const closedTrades = db.prepare("SELECT * FROM portfolio_trades WHERE status='closed'").all();
  const td = latestIdxDate();

  // Current prices for open positions
  const priceMap = {};
  if (td) db.prepare('SELECT code, close FROM idx_daily WHERE trade_date=?').all(td).forEach(r => { priceMap[r.code] = r.close; });

  // Open P&L
  let unrealizedPnl = 0, totalInvested = 0;
  openTrades.forEach(t => {
    const cur = priceMap[t.code] || t.entry_price;
    t.current_price = cur;
    const pnl = (cur - t.entry_price) * t.lots * 100;
    unrealizedPnl += pnl;
    totalInvested += t.entry_price * t.lots * 100;
  });

  // Closed P&L
  let realizedPnl = 0, wins = 0, losses = 0;
  closedTrades.forEach(t => {
    const pnl = ((t.exit_price || t.entry_price) - t.entry_price) * (t.exit_lots || t.lots) * 100 - (t.fees || 0);
    realizedPnl += pnl;
    if (pnl > 0) wins++; else if (pnl < 0) losses++;
  });

  const winRate = (wins + losses) > 0 ? Math.round(wins / (wins + losses) * 1000) / 10 : settings.win_rate;

  res.json({
    capital: settings.capital,
    open_positions: openTrades.length,
    closed_trades: closedTrades.length,
    total_invested: totalInvested,
    unrealized_pnl: Math.round(unrealizedPnl),
    realized_pnl: Math.round(realizedPnl),
    win_rate: winRate,
    wins, losses,
    trade_date: td
  });
});

module.exports = router;
