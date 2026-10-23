# Saham AS di Banyu Langit — audit & proposal

Tanggal: 23 Okt 2026 · Penulis: Eko · Status: usulan, belum dikerjakan

---

## 1. Audit — apa yang sudah ada

| Komponen | Status | Bukti |
|---|---|---|
| Tabel harga | **Ada** | `us_daily`: 3.109.155 baris, 1.423 kode, 2016-10-24 → 2026-10-22, harga disesuaikan (`yahoo/yfinance:adj`) |
| Metadata | **Ada** | `us_symbols_meta`: 1.334 kode (1.135 equity, 198 ETF), 1.133 punya sektor/industri |
| Signal store | **Ada** | `signals_daily` market `US`: 665.166 baris, 1.408 kode, 500 sesi |
| Route baca | **Ada** | `GET /api/idx/us-daily` (`server/routes/us-daily.js`, 251 baris) |
| Panel UI | **Ada** | Analysis → sub-tab **US Stocks** (`#ana-usdaily` → `#ud-content`) |
| Freshness | **Ada** | `/api/v1/idx/freshness` menyebut `us_daily` |
| Sync harian | **Ada** | cron `eko-us-equities-daily` 06:00 WIB + rebuild signals |
| Backtest | **Ada (kasar)** | `market-rails/backtest.js`, biaya per sisi, eksekusi close t+1 |

## 2. Audit — celah yang menghalangi "saham US masuk"

### Kritis

1. **Universe terkunci di 60 kode.** `MAX_CODES_ALL = 60`, `MAX_CODES = 40`. Panel memuat
   `?codes=all` = **60 dari 1.423** (4,2%). Sisanya tidak bisa dilihat sama sekali.
2. **Tidak ada pencarian, urutan, atau filter di server.** Route hanya menerima `codes` dan
   `days`. Tidak ada `q`, `sort`, `offset/limit`, `sector`. Semua penyaringan harus dilakukan
   dengan mengirim daftar kode manual.
3. **Sektor/industri tidak dipakai route.** `us_symbols_meta` sudah terisi, tapi route tidak
   pernah join ke tabel itu (0 kemunculan). Akibatnya panel tidak bisa difilter per sektor.
4. **Tabrakan identitas: 22 ticker ada di IDX dan US sekaligus** — `AGRO, ARKO, BIRD, BMBL,
   CBRE, COCO, COIN, CPRI, FAST, HALO, INDO, LION`, dan 10 lainnya. Selama API memakai `code`
   tanpa penanda pasar, suatu saat akan menampilkan saham yang salah.

### Penting

5. **Kinerja default lambat: 2,85 detik.** Pemilihan 20 kode default memindai turnover 20 sesi
   untuk seluruh tabel. `codes=all` (60 kode) 0,58 detik — masih wajar, tapi tidak akan bertahan
   bila batas dinaikkan ke 1.423 tanpa indeks dan paginasi.
6. **Tidak ada skor/peringkat untuk US.** `daily_scores` hanya IDX. Panel US hanya menampilkan
   harga + return + persentil, tanpa skor yang sebanding dengan saham IDX.
7. **Belum ada fundamental & PIT.** `us_symbols_meta` hanya snapshot; `quarterly_financials`
   IDX masih 0 baris dan `fs_date` kosong. Backtest fundamental akan look-ahead.

### Catatan sumber

8. Harga US berasal dari **Yahoo**, sementara aturan owner menyebut investing untuk non-IDX.
   Investasi 1.423 ticker di investing tidak realistis (perlu pin `pair_id` per ticker), jadi
   ini butuh keputusan eksplisit: Yahoo sebagai rel massal, atau universe diperkecil.

---

## 3. Proposal — 4 fase, backend dulu

### Fase 1 — Buka universe (paling menentukan)

- Endpoint baru `GET /api/us/screen` dengan parameter: `q`, `sector`, `industry`,
  `min_mcap`, `max_mcap`, `sort` (last, ret_1d/5d/20d, ytd, pctile52w, mcap), `order`,
  `limit` (default 50, max 200), `offset`.
- Sumber data: join `us_daily` (harga) + `us_symbols_meta` (nama/sektor/mcap) + `signals_daily`
  (indikator) untuk bar terakhir.
- Naikkan batas `codes` eksplisit 40 → 200 (untuk chart multi-seri), `all` 60 → tidak dipakai lagi.
- **Target: < 300 ms untuk satu halaman 50 baris.**
- Kriteria terima: 1.423 kode bisa dijangkau lewat paginasi; tidak ada batas 60.

### Fase 2 — Identitas pasar

- Semua endpoint baru ber-prefix pasar: `/api/us/...` untuk AS, `/api/idx/...` tetap IDX.
- Kolom `market` wajib di setiap respons yang menggabungkan dua pasar.
- Aturan: **tidak ada lagi endpoint yang menerima `code` tanpa pasar.**
- Kriteria terima: 22 ticker kembar diuji eksplisit — `AGRO` IDX dan `AGRO` US mengembalikan
  data berbeda dan benar.

### Fase 3 — Skor & peringkat US

- `us_scores` harian dengan formula **sama** seperti `daily_scores` IDX (momentum, trend,
  likuiditas, volatilitas), supaya angka kedua pasar bisa dibandingkan.
- Simpan komponen per skor, bukan hanya total — supaya bisa diaudit.
- Kriteria terima: 1.400+ kode punya skor harian; komponen bisa dijumlah ulang menjadi total.

### Fase 4 — Kualitas data & freshness

- Alarm basi: `us_daily` lag > 3 sesi → peringatan (sekarang hanya dilaporkan, tidak dialarmkan).
- Retry metadata 79 ticker yang gagal (rate limit 429).
- Dokumentasi sumber: `yahoo/yfinance:adj` sebagai rel resmi AS, atau pindah sebagian ke investing.

---

## 4. Yang TIDAK diusulkan sekarang

- **UI baru.** Owner meminta backend dimatangkan dulu. Panel yang ada tetap jalan; setelah
  Fase 1–3 selesai, UI cukup mengganti sumber datanya.
- **Fundamental & PIT.** Butuh sumber tanggal terbit; tanpa itu, semua backtest fundamental
  akan look-ahead. Ini proyek terpisah.
- **Meniru AmiBroker.** Tidak perlu; cukup ekspor CSV bila ingin backtest di sana.

## 5. Risiko yang harus diterima bila dilanjutkan

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Survivorship | Backtest US/IDX terlalu optimistis | Catat kode yang hilang; uji ulang dengan daftar historis |
| Sumber Yahoo | Melanggar aturan "investing untuk non-IDX" | Keputusan owner; dokumentasikan sebagai pengecualian |
| 22 ticker kembar | Salah tampil / salah backtest | Fase 2 wajib sebelum Fase 3 |
| 1.423 kode tanpa paginasi | Route timeout | Fase 1 dengan indeks + limit |

## 6. Estimasi

| Fase | Pekerjaan | Perkiraan |
|---|---|---|
| 1 | Endpoint screen + indeks + paginasi | 1 hari |
| 2 | Pemisahan prefix pasar + uji 22 ticker kembar | 0,5 hari |
| 3 | `us_scores` + job harian | 1 hari |
| 4 | Alarm + retry metadata | 0,5 hari |

Total ±3 hari kerja, backend saja, tanpa menyentuh UI.
