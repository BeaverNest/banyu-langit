const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { dataDir } = require('../db');
const { yq } = require('../utils/yahoo');

const router = express.Router();
const watchlistFile = path.join(dataDir, 'watchlist.json');
const alertsFile = path.join(dataDir, 'alerts.json');
const notifsFile = path.join(dataDir, 'notifications.json');

function loadJSON(f) { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {} return []; }
function saveJSON(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// Watchlist
router.get('/watchlist', (req, res) => res.json(loadJSON(watchlistFile)));
router.post('/watchlist', (req, res) => {
  const { symbol, name } = req.body;
  if (!symbol) return res.status(400).json({ error: 'Symbol required' });
  const list = loadJSON(watchlistFile);
  if (list.find(w => w.symbol === symbol.toUpperCase())) return res.status(409).json({ error: 'Exists' });
  const item = { id: uuidv4(), symbol: symbol.toUpperCase(), name: name || symbol.toUpperCase(), addedAt: new Date().toISOString() };
  list.push(item);
  saveJSON(watchlistFile, list);
  res.status(201).json(item);
});
router.delete('/watchlist/:id', (req, res) => {
  saveJSON(watchlistFile, loadJSON(watchlistFile).filter(w => w.id !== req.params.id));
  res.json({ success: true });
});

// Alerts
router.get('/alerts', (req, res) => res.json(loadJSON(alertsFile)));
router.post('/alerts', (req, res) => {
  const { symbol, condition, price, note } = req.body;
  if (!symbol || !condition || !price) return res.status(400).json({ error: 'Missing' });
  const alert = { id: uuidv4(), symbol: symbol.toUpperCase(), condition, price: parseFloat(price), note: note || '', triggered: false, createdAt: new Date().toISOString() };
  const alerts = loadJSON(alertsFile);
  alerts.push(alert);
  saveJSON(alertsFile, alerts);
  res.status(201).json(alert);
});
router.delete('/alerts/:id', (req, res) => {
  saveJSON(alertsFile, loadJSON(alertsFile).filter(a => a.id !== req.params.id));
  res.json({ success: true });
});

// Check alerts
router.get('/alerts/check', async (req, res) => {
  const alerts = loadJSON(alertsFile);
  const active = alerts.filter(a => !a.triggered);
  const triggered = [];
  for (const a of active) {
    const q = await yq(a.symbol);
    if (!q?.price) continue;
    if ((a.condition === 'above' && q.price >= a.price) || (a.condition === 'below' && q.price <= a.price)) {
      a.triggered = true;
      a.triggeredAt = new Date().toISOString();
      a.triggeredPrice = q.price;
      triggered.push(a);
      const n = loadJSON(notifsFile);
      n.unshift({ id: uuidv4(), type: 'alert', symbol: a.symbol, message: `${a.symbol} hit ${q.price} (target: ${a.condition} ${a.price})`, note: a.note, read: false, createdAt: new Date().toISOString() });
      saveJSON(notifsFile, n);
    }
  }
  if (triggered.length) saveJSON(alertsFile, alerts);
  res.json(triggered);
});

// Notifications
router.get('/notifications', (req, res) => res.json(loadJSON(notifsFile)));
router.post('/notifications/read-all', (req, res) => {
  const n = loadJSON(notifsFile);
  n.forEach(x => x.read = true);
  saveJSON(notifsFile, n);
  res.json({ success: true });
});
router.delete('/notifications', (req, res) => { saveJSON(notifsFile, []); res.json({ success: true }); });

module.exports = router;
