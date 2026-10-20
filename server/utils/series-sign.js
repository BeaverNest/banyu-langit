'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Deklarasi seri yang nilainya SAH ≤ 0 (kanban t_0e4e2cba; review sena R2).
//
// Kenapa berkas terpisah: gerbang tulis custom_ohlc dulu memutuskan "boleh negatif?"
// dari `category` yang dikirim PEMANGGIL. Itu salah dua arah:
//   • fred_push_bl.py mengirim category='macro' untuk DXY, VIX, US10Y, USDCNY — tick 0
//     atau negatif di seri itu adalah cetakan rusak, bukan observasi;
//   • category='macro' juga dipakai untuk belasan seri lain yang tidak ada urusannya
//     dengan nilai bertanda.
// Jadi klasifikasi di sini kunci ke KODE SERI, satu deklarasi per seri, dan tidak
// pernah dibaca dari payload.
//
// Kenapa bukan dari `value_kind` (custom_tickers) atau nama kode: `value_kind` menjawab
// "bagaimana perubahan dihitung", bukan "apakah tanda bermakna". MACRO_TRADE_BAL dan
// MACRO_FX_RESERVES sama-sama 'level', tapi neraca dagang bisa defisit (-1,61 USD bn
// tersimpan 20 Okt 2026) sedangkan cadangan devisa tidak bisa negatif. Menebak dari
// awalan/akhiran nama kode = menulis angka salah dengan tampang benar.
//
// ATURAN (mengikat): daftar ini keputusan manusia yang terbaca di review. Seri yang
// tidak terdaftar DITOLAK untuk nilai ≤ 0 — dan penolakan itu kini DILAPORKAN di respons
// (bukan dibuang diam-diam seperti bug aslinya: 204 baris hilang, API tetap ok:true).
// Menambah seri = satu baris di sini, alasan ditulis, bukan pelonggaran global.
// ═══════════════════════════════════════════════════════════════════════════

// code -> alasan singkat kenapa ≤ 0 adalah observasi, bukan cetakan rusak
const SIGNED_SERIES = Object.freeze({
  // ── Inflasi: deflasi = nilai negatif sah ──
  MACRO_CPI_MOM:      'inflasi bulanan bisa deflasi (-0,76% tersimpan)',
  MACRO_CPI_YOY:      'inflasi tahunan bisa deflasi',
  MACRO_CORE_CPI_YOY: 'inflasi inti bisa deflasi',

  // ── Pertumbuhan: kontraksi = negatif ──
  MACRO_GDP_QOQ:         'PDB kuartalan bisa kontraksi (-0,98% tersimpan)',
  MACRO_GDP_YOY:         'PDB tahunan bisa kontraksi (resesi)',
  MACRO_LOANS_YOY:       'kredit perbankan bisa kontraksi (credit crunch)',
  MACRO_M2_YOY:          'uang beredar bisa kontraksi',
  MACRO_RETAIL_YOY:      'penjualan ritel bisa kontraksi',
  MACRO_CAR_YOY:         'penjualan mobil bisa kontraksi (-26,1% tersimpan)',
  MACRO_MOTORBIKE_YOY:   'penjualan motor bisa kontraksi (-17,1% tersimpan)',

  // ── Perdagangan & arus luar negeri: defisit = negatif ──
  MACRO_TRADE_BAL:    'neraca dagang bisa defisit (-1,61 USD bn tersimpan)',
  MACRO_EXPORT_YOY:   'ekspor bisa kontraksi',
  MACRO_IMPORT_YOY:   'impor bisa kontraksi',
  MACRO_CA_GDP:       'transaksi berjalan bisa defisit (-3,3% PDB tersimpan)',
  MACRO_FDI_YOY:      'FDI bisa kontraksi/divestasi',

  // ── Imbal hasil: kurva terbalik & real yield negatif adalah keadaan nyata ──
  SLOPE10Y2Y: 'T10Y2Y negatif saat kurva terbalik (2022-2024 pernah < 0)',
  REAL10Y:    'DFII10 (TIPS) pernah negatif 2020-2021',
});

/** true = seri ini boleh menyimpan close ≤ 0. */
function allowsNonPositive(code) {
  return Object.prototype.hasOwnProperty.call(SIGNED_SERIES, String(code || '').toUpperCase().trim());
}

/** Angka tegas atau null. Menolak null/''/boolean/NaN — `Number(null)===0` dan
 *  `Number('')===0` adalah pintu masuk baris close-NULL yang lolos gerbang
 *  (review sena R4), jadi konversi implisit tidak dipakai di sini. */
function strictNum(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

module.exports = { SIGNED_SERIES, allowsNonPositive, strictNum };
