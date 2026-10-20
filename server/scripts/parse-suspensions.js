#!/usr/bin/env node
'use strict';
// parse-suspensions.js — turunkan status suspensi dari pengumuman BEI.
//
// Sumber: company_announcements (judul resmi BEI). Tidak ada tarikan baru: datanya
// sudah masuk lewat sync pengumuman harian. Skrip ini hanya MENDERIVASI.
//
// Aturan (mengikat):
//   RESUME  : judul diawali "Pembukaan Penghentian Sementara" atau "Pencabutan Penghentian Sementara"
//   SUSPEND : judul diawali "Penghentian Sementara"
//   selain itu (Realisasi/Rencana Pemulihan, laporan perkembangan) BUKAN event suspensi -> dilewati
// Status sekarang = event terakhir per emiten (ann_date, lalu ann_id sebagai tie-break).
//
// Jalankan: node server/scripts/parse-suspensions.js
const path = require('path');
const D = require('better-sqlite3');
const db = new D(process.env.DB_PATH || '/app/data/trading.db');

const rows = db.prepare(`
  SELECT ann_id, ann_date, company_code, title
    FROM company_announcements
   WHERE (upper(title) LIKE '%PENGHENTIAN SEMENTARA%' OR upper(title) LIKE '%PENCABUTAN%')
     AND company_code IS NOT NULL AND trim(company_code) <> ''
   ORDER BY ann_date, ann_id`).all();

const ev = [];
let skipped = 0;
for (const r of rows) {
  const t = String(r.title || '').trim().toUpperCase();
  let type = null;
  if (t.startsWith('PEMBUKAAN PENGHENTIAN SEMENTARA')) type = 'resume';
  else if (t.startsWith('PENCABUTAN PENGHENTIAN SEMENTARA')) type = 'resume';
  else if (t.startsWith('PENGENTIAN SEMENTARA') || t.startsWith('PENGHENTIAN SEMENTARA')) type = 'suspend';
  if (!type) { skipped++; continue; }
  const code = String(r.company_code).trim().toUpperCase();
  // company_code di pengumuman kadang berisi nilai non-ticker (mis. TESTSBKD, TKS-KORSFU).
  // Status suspensi hanya bermakna untuk kode 4 huruf yang benar-benar emiten.
  if (!/^[A-Z]{4}$/.test(code)) { skipped++; continue; }
  ev.push({ code, date: String(r.ann_date).slice(0, 10), type, title: r.title, ann_id: r.ann_id });
}

// status terakhir per emiten
const last = new Map();
for (const e of ev) last.set(e.code, e);       // urut naik -> yang terakhir menang
const active = [...last.values()].filter(e => e.type === 'suspend');

db.transaction(() => {
  db.prepare('DELETE FROM company_suspends').run();
  const ins = db.prepare('INSERT OR IGNORE INTO company_suspends(code, title, suspend_date, type) VALUES (?,?,?,?)');
  for (const e of ev) ins.run(e.code, e.title.slice(0, 300), e.date, e.type);
})();

console.log('pengumuman dipindai :', rows.length);
console.log('event suspensi/resume:', ev.length, '| dilewati (bukan event):', skipped);
console.log('  suspend:', ev.filter(e => e.type === 'suspend').length, '| resume:', ev.filter(e => e.type === 'resume').length);
console.log('emiten tersentuh     :', new Set(ev.map(e => e.code)).size);
console.log('MASIH TERSUSPEND    :', active.length);
console.log('  ' + active.slice(-12).map(e => e.code + ' (' + e.date + ')').join(', '));
db.close();
