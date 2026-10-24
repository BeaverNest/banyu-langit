'use strict';
// GET /api/idx/ihsg-page — payload menu IHSG (lihat server/utils/ihsg-page.js).
//
// Dipisah dari /api/idx/cross-asset dengan sengaja: halaman ini butuh 220 sesi breadth
// (untuk MA200) sedangkan cross-asset cukup 40. Menempelkannya ke payload Market Regime
// akan menambah ~1 detik ke halaman yang tidak memakainya.

const express = require('express');
const { db } = require('../db');
const { registerSqlAdjust } = require('../utils/price-adjust');
const { buildIhsg } = require('../utils/ihsg-page');

const router = express.Router();

// ca_adj() dipakai query breadth; pastikan terdaftar walau routes/idx.js belum dimuat.
function ensureSqlAdjust() {
  try {
    db.prepare("SELECT ca_adj(1, 'PROBE', '2000-01-01') AS v").get();
  } catch (e) {
    try { registerSqlAdjust(db); } catch (e2) { /* biarkan: build akan gagal jelas */ }
  }
}

let cache = { at: 0, body: null };
const TTL_MS = 60 * 1000;   // satu menit: halaman dibuka/ditutup user, bukan polling

router.get('/ihsg-page', (req, res) => {
  try {
    ensureSqlAdjust();
    if (cache.body && Date.now() - cache.at < TTL_MS) {
      return res.json(Object.assign({ cached: true }, cache.body));
    }
    const body = buildIhsg(db);
    if (body.available) { cache = { at: Date.now(), body }; }
    res.json(body);
  } catch (e) {
    res.status(500).json({ available: false, error: e.message });
  }
});

module.exports = router;
