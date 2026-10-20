#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Seed metadata satuan per seri: `unit` + `value_kind` (kanban t_19f4f0d4).
//
// Kenapa perlu: monitor lintas aset menampilkan SATU tabel untuk semua seri, jadi ia harus tahu
// apakah sebuah perubahan masuk akal dinyatakan dalam persen. Persen-dari-persen pada suku bunga
// atau inflasi adalah angka tanpa arti: US10Y 5,10% -> 5,60% = +50 bp, bukan "+9,80%". Panel lama
// menghitung semuanya sebagai persen, sehingga seri bulanan pun terbaca "5D: -48,91%" (lima bar
// rilis dipakai sebagai lima hari).
//
// Kontraknya (kolom di custom_tickers, dimigrasi oleh server/db.js):
//   value_kind = 'price' -> perubahan relatif (%); level > 0; perkalian bermakna
//                'rate'  -> perubahan ADDITIF dalam percentage point (pp)
//                'level' -> perubahan additif dalam `unit` (mis. cadangan devisa USD bn)
//                NULL    -> belum dideklarasikan; UI menulis selisih absolut + penanda "satuan?"
//                           dan seri itu masuk daftar coverage. TIDAK ditebak dari nama kode.
//   unit       = satuan LEVEL seri. NULL = belum dideklarasikan (alasan sama).
//
// ATURAN (mengikat): nilai di sini KEPUTUSAN MANUSIA yang terbaca di review — bukan hasil
// turunan otomatis. Menebak satuan dari nama kode adalah cara paling mudah menulis angka salah
// dengan tampang benar. Karena itu seri yang tidak ada di peta akan DILAPORKAN, bukan diberi
// default.
//
// Satuan yang sengaja DIBIARKAN NULL (tidak saya klaim, sumbernya belum diverifikasi):
//   STEEL_HRC, RUBBER, RUBBER_RSS3, KRAFT_PULP, COKING_COAL
//   -> kontrak harga (USD/t? USD/st? JPY/kg? MYR/t?) berbeda per bursa dan berkas ini tidak
//      punya bukti kontraknya. Seri tetap tampil; coverage mendaftarnya sebagai "satuan?".
//      Isi setelah kontraknya dipastikan dari sumber (satu berkas ini = satu keputusan).
//
// Sifat: idempotent, `--force` untuk menimpa deklarasi lama. Exit 0 = selesai,
// 1 = ada seri tanpa deklarasi (supaya tidak lolos diam-diam di CI/manual run).
//
// Pakai (di dalam container; DB tidak ada di host):
//   docker exec -w /app banyu-langit node server/scripts/seed_series_meta.js
//   docker exec -w /app banyu-langit node server/scripts/seed_series_meta.js --force
// ═══════════════════════════════════════════════════════════════════════════

const Database = require('/app/node_modules/better-sqlite3');
const DB_PATH = process.env.BL_DB || '/app/data/trading.db';
const FORCE = process.argv.slice(2).includes('--force');

// [unit, value_kind] — dikelompokkan per kategori supaya mudah diaudit.
const DECLARED = {
  // ── Indeks global (harga indeks; % bermakna) ──
  ASX200: ['index', 'price'], CSI300: ['index', 'price'], DAX: ['index', 'price'],
  DJI: ['index', 'price'], FTSE: ['index', 'price'], HSI: ['index', 'price'],
  IXIC: ['index', 'price'], KLCI: ['index', 'price'], KOSPI: ['index', 'price'],
  NIKKEI: ['index', 'price'], SPX: ['index', 'price'], STI: ['index', 'price'],

  // ── Valuta ──
  USDIDR: ['IDR/USD', 'price'],
  USDCNY: ['CNY/USD', 'price'],

  // ── Komoditas (kontrak yang jelas saja; sisanya NULL + dilaporkan) ──
  XAUUSD: ['USD/oz', 'price'],
  SILVER: ['USD/oz', 'price'],
  WTI: ['USD/bbl', 'price'],
  BRENT: ['USD/bbl', 'price'],
  NATGAS: ['USD/MMBtu', 'price'],
  COPPER: ['USD/lb', 'price'],
  CORN: ['USc/bu', 'price'],
  SOYMEAL: ['USD/t', 'price'],
  ALUMINIUM: ['USD/t', 'price'],
  NICKEL: ['USD/t', 'price'],
  TIN: ['USD/t', 'price'],
  COAL: ['USD/t', 'price'],
  CPO: ['MYR/t', 'price'],
  STEEL_HRC: [null, 'price'],
  RUBBER: [null, 'price'],
  RUBBER_RSS3: [null, 'price'],
  KRAFT_PULP: [null, 'price'],
  COKING_COAL: [null, 'price'],

  // ── Rates: SEMUA 'rate' (pp). Δ dalam pp, bukan % dari level. ──
  ID1M: ['%', 'rate'], ID3M: ['%', 'rate'], ID6M: ['%', 'rate'], ID1Y: ['%', 'rate'],
  ID3Y: ['%', 'rate'], ID5Y: ['%', 'rate'], ID10Y: ['%', 'rate'], ID15Y: ['%', 'rate'],
  ID20Y: ['%', 'rate'], ID25Y: ['%', 'rate'], ID30Y: ['%', 'rate'],
  BI_RATE: ['%', 'rate'],
  SRBI_JISDOR: ['IDR/USD', 'price'],   // kuotasi rupiah per USD: level, bukan suku bunga

  // ── Makro: turunan tingkat (rate) vs besaran (level) ──
  DXY: ['index', 'price'],
  VIX: ['index', 'price'],
  US10Y: ['%', 'rate'],
  REAL10Y: ['%', 'rate'],
  SLOPE10Y2Y: ['pp', 'rate'],
  HYOAS: ['%', 'rate'],
  MACRO_BI_RATE: ['%', 'rate'],
  MACRO_BI_DEPO: ['%', 'rate'],
  MACRO_BI_LENDING: ['%', 'rate'],
  MACRO_CPI_YOY: ['%', 'rate'],
  MACRO_CPI_MOM: ['%', 'rate'],
  MACRO_CORE_CPI_YOY: ['%', 'rate'],
  MACRO_GDP_YOY: ['%', 'rate'],
  MACRO_GDP_QOQ: ['%', 'rate'],
  MACRO_CA_GDP: ['%', 'rate'],
  MACRO_LOANS_YOY: ['%', 'rate'],
  MACRO_M2_YOY: ['%', 'rate'],
  MACRO_EXPORT_YOY: ['%', 'rate'],
  MACRO_IMPORT_YOY: ['%', 'rate'],
  MACRO_RETAIL_YOY: ['%', 'rate'],
  MACRO_CAR_YOY: ['%', 'rate'],
  MACRO_MOTORBIKE_YOY: ['%', 'rate'],
  MACRO_FDI_YOY: ['%', 'rate'],
  MACRO_CONSUMER_CONF: ['index', 'level'],
  MACRO_PMI: ['index', 'level'],
  MACRO_FX_RESERVES: ['USD bn', 'level'],
  MACRO_TRADE_BAL: ['USD bn', 'level'],
  SRBI_TOTAL: ['Rp tn', 'level'],
  SRBI_BANK: ['Rp tn', 'level'],
  SRBI_NONBANK: ['Rp tn', 'level'],
  SRBI_NONRES: ['Rp tn', 'level'],
  SRBI_RESIDENT: ['Rp tn', 'level'],
  SRBI_OTHERS: ['Rp tn', 'level'],
};

function main() {
  const db = new Database(DB_PATH);
  // Kolom bisa belum ada bila skrip dijalankan sebelum server restart (migrasi ada di db.js).
  const cols = db.prepare('PRAGMA table_info(custom_tickers)').all().map(c => c.name);
  if (!cols.includes('unit')) db.exec('ALTER TABLE custom_tickers ADD COLUMN unit TEXT');
  if (!cols.includes('value_kind')) db.exec('ALTER TABLE custom_tickers ADD COLUMN value_kind TEXT');

  const rows = db.prepare('SELECT code, name, category, source, unit, value_kind FROM custom_tickers ORDER BY category, code').all();
  const upd = db.prepare('UPDATE custom_tickers SET unit=?, value_kind=? WHERE code=?');

  let written = 0, unchanged = 0, skipped = 0;
  const unmapped = [];
  const lines = [];

  db.transaction(() => {
    for (const t of rows) {
      if (!Object.prototype.hasOwnProperty.call(DECLARED, t.code)) {
        unmapped.push(`${t.code} [${t.category}] (${t.source})`);
        continue;
      }
      const [unit, kind] = DECLARED[t.code];
      const same = (t.unit || null) === (unit || null) && (t.value_kind || null) === (kind || null);
      if (same) { unchanged++; lines.push(`  sama     ${t.code.padEnd(22)} ${String(unit).padEnd(10)} ${kind}`); continue; }
      if ((t.unit || t.value_kind) && !FORCE) {
        skipped++;
        lines.push(`  lewati   ${t.code.padEnd(22)} ${String(t.unit).padEnd(10)} ${t.value_kind} (sudah terisi, pakai --force)`);
        continue;
      }
      upd.run(unit || null, kind || null, t.code);
      written++;
      lines.push(`  tulis    ${t.code.padEnd(22)} ${String(t.unit || '-').padEnd(10)} ${t.value_kind || '-'} -> ${unit || '-'} ${kind}`);
    }
  })();

  console.log(lines.join('\n'));
  console.log(`\ncustom_tickers: ${rows.length} baris | ditulis ${written} | sudah cocok ${unchanged} | dilewati ${skipped}`);
  if (unmapped.length) {
    console.log('\nPERINGATAN: seri TANPA deklarasi unit/value_kind (tidak diberi tebakan):');
    unmapped.forEach(u => console.log('  - ' + u));
    console.log('  Tambahkan ke DECLARED di berkas ini; seri tetap muncul di monitor dengan penanda "satuan?".');
  }
  const after = db.prepare("SELECT COALESCE(value_kind,'(null)') k, COUNT(*) n FROM custom_tickers GROUP BY k ORDER BY n DESC").all();
  console.log('keadaan sesudah (value_kind, jumlah): ' + after.map(r => `(${r.k}, ${r.n})`).join(' '));
  const unitsMissing = db.prepare('SELECT COUNT(*) n FROM custom_tickers WHERE unit IS NULL').get().n;
  console.log(`unit belum dideklarasikan: ${unitsMissing} seri`);
  db.close();
  // Exit 1 hanya bila ada seri yang SAMA SEKALI tidak ada di peta (drift deklarasi).
  process.exitCode = unmapped.length ? 1 : 0;
}

main();
