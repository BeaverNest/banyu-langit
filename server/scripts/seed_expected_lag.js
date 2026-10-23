#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// Seed expected_lag_sessions per seri (kanban t_e821ac7e, keputusan eko t_b234606a).
//
// Kebiasaan lag SUMBER per seri, dalam satuan SESI IDX. Dipakai
// server/utils/series-freshness.js: alarm menyala HANYA bila
// lag_sessions > expected_lag_sessions. Jadi angka di sini bukan "ambang global" —
// dua seri di rail yang sama boleh punya angka berbeda pada hari yang sama.
//
// ATURAN (mengikat, kontrak §3 + koreksi §9): penentunya SUMBER, bukan kategori.
//   source = 'investing/calendar' -> 'na' (KALENDER RILIS, bukan bursa: seri MACRO_* terbit
//                                   bulanan/kuartalan, jadi "lag dalam sesi IDX" tidak bermakna.
//                                   Diberi angka = angka palsu yang menyalakan alarm tiap rilis)
//   source diawali 'investing/'  -> DIDEKLARASIKAN angka (kalendernya ikut sesi IDX)
//   source selain itu            -> NULL + lag_basis='na' (yahoo, fred/<kode>,
//                                   external, tradingeconomics/snapshot, bi.go.id/srbi)
// Kategori hanya menentukan tempat tampil: ID10Y (rates, investing/29256) = 0 dan
// RUBBER_RSS3 (commodity_unverified, investing/1013411) = 2.
//
// Nilai & dasarnya (semua diukur 19 Okt 2026, 70 sesi IDX terakhir; probe read-only):
//   0  BRENT, COPPER, CORN, NATGAS, SILVER, SOYMEAL, WTI, XAUUSD, ID10Y
//        -> 0 hilang/70 sesi: bar sesi berjalan selalu ada (ID10Y 15/15 Jumat).
//   0  NICKEL, ALUMINIUM
//        -> sesi berjalan ada; 1 hilang/70 = libur bank UK 31 Agu 2026 (venue tutup,
//           IDX buka). Diterima: 2-3 alarm palsu/tahun ditukar dengan temuan yang
//           terlewat (TIN) — kontrak §7.2.
//   0  TIN
//        -> interior bersih KECUALI satu sesi (2026-10-01); rapat 10-02 s/d 10-14,
//           lalu berhenti di 10-15. Karena ekspektasinya 0, lag 2 WAJIB jadi 'excess'.
//   1  COAL, STEEL_HRC
//        -> hilang 1/70 dengan interior 0: penerbitan bar sesi-H+1 struktural.
//   1  RUBBER
//        -> tail normal 1 sesi; lubang tak beraturan (maks 6 sesi) tetap harus menyala.
//   2  CPO
//        -> 0/15 Jumat di jendela 70 sesi (kalender BMD tidak menerbitkan bar Jumat);
//           15 Jumat seumur seri, terakhir 2026-01-02 (rapat s/d 2025-01-17, lalu
//           2025-12-26 & 2026-01-02 terisolasi setelah jeda 11 bulan), dan 36 Jumat IDX
//           sesudahnya tanpa bar. Dasar 2 = nol bar Jumat + 1 sesi penerbitan.
//   0  11 TENOR SUN (ID1M/3M/6M/1Y/3Y/5Y/10Y/15Y/20Y/25Y/30Y)
//        -> diukur 20 Okt 2026 atas 70 sesi IDX terakhir: NOL sesi hilang untuk KESEBELAS
//           tenor (bar sesi berjalan selalu ada). Sebelumnya hanya ID10Y yang dideklarasikan,
//           sehingga sepuluh tenor lain berstatus 'na' ("umur tidak diukur") dan monitor lintas
//           aset (kanban t_19f4f0d4) melaporkannya sebagai drift deklarasi. Angka 0 di sini
//           berarti klaim terukur, bukan default: kalau salah satu tenor berhenti terbit,
//           lag 1 langsung menjadi 'excess'.
//   2  RUBBER_RSS3
//        -> tanda Jumat-hilang yang sama: 9 Jumat seumur seri (bukan 15), terakhir
//           2024-12-20, 82 Jumat IDX sesudahnya tanpa bar.
//   NULL + 'na'  COKING_COAL, KRAFT_PULP (tradingeconomics/snapshot, seri snapshot),
//                semua seri yahoo (global_index/macro/currency), fred/<kode>, external
//        -> kalendernya bukan sesi IDX; lag sesi IDX tidak bermakna (SPX/US10Y selalu
//           "1 sesi tertinggal" pada Senin karena penutupan Jumat). Diberi angka = angka palsu.
//
// BATAS KEJUJURAN (wajib ikut terbaca, jangan ditelan):
//   • Nilai COAL / STEEL_HRC / RUBBER berasal dari SATU pengamatan jam-tarik
//     (19 Okt 2026 20:25 WIB) yang diperkuat struktur interior 70 sesi — BUKAN dari
//     distribusi pengamatan. Saat kartu telemetri pull selesai, angka ini harus diganti
//     angka TERUKUR dan selisih lama-vs-baru dilaporkan, bukan didiamkan.
//   • Deklarasi bisa basi (kontrak §7.1): kalau vendor memperbaiki lubang Jumat FCPO,
//     CPO=2 menjadi titik buta permanen 1 sesi. Pemicu review: bila `lag` sebuah seri
//     SELALU lebih rendah dari ekspektasinya selama ±20 sesi berturut-turut, angka itu
//     kandidat turun. Karena itu lag_sessions + expected_lag_sessions wajib ikut di
//     payload untuk SEMUA seri, bukan hanya yang alarm.
//   • Skrip ini TIDAK menghitung ulang nilai dari data (itu akan jadi ratchet: expectation
//     yang menyesuaikan diri sendiri mematikan alarm tepat saat seri berhenti). Nilainya
//     keputusan eksplisit; perubahan nilai = perubahan berkas ini di review.
//
// Sifat: idempotent. Baris yang sudah punya lag_basis (sudah diputuskan, termasuk yang
// 'na' dengan expected NULL) dilewati; jalan kedua = 0 baris berubah. Perbandingan
// dilakukan per-nilai, bukan lewat jumlah `changes` SQLite (SQLite menghitung UPDATE
// yang nilainya identik sebagai 1 perubahan -> akan terbaca "berubah" palsu).
//
// Pakai (di dalam container; DB tidak ada di host):
//   docker exec -w /app banyu-langit node server/scripts/seed_expected_lag.js
//   docker exec -w /app banyu-langit node server/scripts/seed_expected_lag.js --force
// `--force` = tulis ulang nilai yang sudah ada (untuk menimpa deklarasi lama).
// Exit 0 = selesai (termasuk bila 0 baris berubah), 1 = ada kode investing tanpa deklarasi.
// ═══════════════════════════════════════════════════════════════════════════

const Database = require('/app/node_modules/better-sqlite3');
const DB_PATH = process.env.BL_DB || '/app/data/trading.db';
const FORCE = process.argv.slice(2).includes('--force');

// Deklarasi eksplisit per kode (bukan default per kategori). Angka = sesi IDX.
const DECLARED = {
  BRENT: 0, COPPER: 0, CORN: 0, NATGAS: 0, SILVER: 0, SOYMEAL: 0, WTI: 0, XAUUSD: 0, ID10Y: 0,
  NICKEL: 0, ALUMINIUM: 0,
  TIN: 0,
  COAL: 1, STEEL_HRC: 1,
  RUBBER: 1,
  CPO: 2, RUBBER_RSS3: 2,
  // 11 tenor SUN — diukur 0 sesi hilang / 70 sesi (lihat catatan di kepala berkas).
  ID1M: 0, ID3M: 0, ID6M: 0, ID1Y: 0, ID3Y: 0, ID5Y: 0,
  ID15Y: 0, ID20Y: 0, ID25Y: 0, ID30Y: 0,
  // 19 seri valuta (investing/1..2214) — diukur 0 sesi hilang / 81 sesi IDX
  // (jendela 1 Jul – 23 Okt 2026, probe read-only 23 Okt 2026). Pindah dari Yahoo
  // karena Yahoo menyisipkan bar Sabtu/Minggu untuk FX; investing tidak.
  USDIDR: 0, USDCNY: 0, EURUSD: 0, GBPUSD: 0, USDJPY: 0, USDCHF: 0, AUDUSD: 0,
  NZDUSD: 0, EURJPY: 0, GBPJPY: 0, USDSGD: 0, USDTHB: 0, USDHKD: 0, USDINR: 0,
  USDKRW: 0, EURIDR: 0, USDPHP: 0, USDVND: 0, SGDIDR: 0,
};

const isInvesting = s => String(s || '').startsWith('investing/');
// Kalender rilis (MACRO_*): sumbernya investing/calendar, tapi yang diterbitkan adalah jadwal
// rilis data bulanan — bukan bar bursa. Lag sesi IDX tidak bermakna untuk seri ini.
const isReleaseCalendar = s => String(s || '') === 'investing/calendar';

function main() {
  const db = new Database(DB_PATH);
  const rows = db.prepare('SELECT code, name, category, source, expected_lag_sessions, lag_basis FROM custom_tickers ORDER BY code').all();

  const upd = db.prepare("UPDATE custom_tickers SET expected_lag_sessions=?, lag_basis=?, lag_declared_at=? WHERE code=?");
  const at = new Date().toISOString();

  let written = 0, skipped = 0, unchanged = 0;
  const unmapped = [];
  const lines = [];

  db.transaction(() => {
    for (const t of rows) {
      const investing = isInvesting(t.source) && !isReleaseCalendar(t.source);
      let desired = null, basis = 'na';

      if (investing) {
        if (!Object.prototype.hasOwnProperty.call(DECLARED, t.code)) {
          // Jangan mengarang: 0 pun sebuah klaim ("kita sudah ukur, sumber selalu terbit").
          unmapped.push(`${t.code} (${t.source})`);
          continue;
        }
        desired = DECLARED[t.code];
        basis = 'declared';
      }

      const cur = t.expected_lag_sessions == null ? null : Number(t.expected_lag_sessions);
      const curBasis = t.lag_basis || null;
      // "sudah diputuskan" = lag_basis terisi. Baris 'na' sengaja expected-nya NULL, jadi
      // memakai `expected_lag_sessions IS NULL` sebagai penanda "belum diisi" akan
      // menulis ulang baris 'na' selamanya.
      const decided = curBasis !== null;
      if (decided && !FORCE) { skipped++; lines.push(`  lewati   ${t.code.padEnd(14)} ${String(cur).padStart(4)} ${curBasis}`); continue; }
      if (decided && cur === desired && curBasis === basis) { unchanged++; lines.push(`  sama     ${t.code.padEnd(14)} ${String(cur).padStart(4)} ${curBasis} (--force, nilai sudah cocok)`); continue; }

      upd.run(desired, basis, at, t.code);
      written++;
      lines.push(`  ${decided ? 'timpa   ' : 'tulis   '} ${t.code.padEnd(14)} ${String(cur).padStart(4)} ${curBasis || '-'} -> ${String(desired).padStart(4)} ${basis}`);
    }
  })();

  console.log(lines.join('\n'));
  console.log(`\ncustom_tickers: ${rows.length} baris | ditulis ${written} | dilewati (sudah dideklarasikan) ${skipped} | sudah cocok ${unchanged}`);
  if (unmapped.length) {
    console.log('\nPERINGATAN: seri ber-sumber investing TANPA deklarasi (tidak diberi angka palsu):');
    unmapped.forEach(u => console.log('  - ' + u));
    console.log('  Tambahkan ke DECLARED di berkas ini dengan dasar pengukuran, jangan default 0.');
  }
  // Ringkasan keadaan sesudah: dibaca ulang dari DB, bukan dari niat skrip.
  const after = db.prepare("SELECT lag_basis, expected_lag_sessions e, COUNT(*) n FROM custom_tickers GROUP BY lag_basis, expected_lag_sessions ORDER BY lag_basis, e").all();
  console.log('keadaan sesudah (lag_basis, expected, jumlah): ' + after.map(r => `(${r.lag_basis || 'NULL'}, ${r.e == null ? 'NULL' : r.e}, ${r.n})`).join(' '));
  db.close();
  process.exitCode = unmapped.length ? 1 : 0;
}

main();
