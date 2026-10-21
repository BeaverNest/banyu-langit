# Kontrak Tampilan Banyu Langit

Aturan ini **hasil koreksi pemilik satu per satu** dan berlaku untuk setiap perubahan UI.
Kalau sebuah kartu tidak menyebut kontrak ini, anggap kontrak ini tetap mengikat.

## 1. Angka

- **Selalu 2 desimal** untuk nilai, persen, rasio, dan poin. Tidak ada 0, 1, 3, atau 4 desimal.
- Pemisah ribuan dipakai; pemisah desimal titik.
- Angka yang dihasilkan server (mis. teks sinyal "Neutral range 556.887465-680.640235") **wajib diformat di server** sebelum dikirim — jangan berharap frontend membereskan.
- Angka mentah dari DB tidak boleh muncul apa adanya di UI.

## 2. Tabel

- `table-layout: fixed` + `colgroup`. Lebar kolom eksplisit, bukan hasil autofit.
- Batas kolom (tepi kanan) harus **identik antar blok** yang setipe. Ukur, jangan kira-kira.
- Nama panjang dipotong dengan elipsis, nilai penuh di `title` (tooltip).
- Header seragam: `1D`, `5D`, `20D`, `YTD` — jangan campur "Δ1D (sesi)" dengan "1D".

## 3. Kerapian blok

- Satu blok per kelas aset / topik. Jangan gabung komoditas dengan kelas lain.
- Judul blok: `Nama · N seri · cadence` (contoh: "Indeks Global · 12 seri · harian"), diberi garis pemisah `border-bottom` + jarak 16px.
- Kolom `as-of` dan `sumber` **tidak ditampilkan** di tabel monitor.
- Kolom `%ile 1Y` dihapus; horizon berhenti di `YTD`.

## 4. Bahasa tampilan

- Tidak ada label yang tidak bisa dijelaskan ke pembaca awam ("umur tak terukur", "sesi rujukan").
- Ringkasan regime cukup satu baris; jangan menambah paragraf penjelasan.
- Tombol refresh di panel yang datanya hanya bisa diperbarui oleh pipeline **dihapus**, bukan dibiarkan mati.

## 5. Grafik

- Tema **terang**: latar putih, teks gelap. (UI aplikasi tetap gelap-biru; grafik dan PDF terang.)
- Footer wajib: `© BeaverNest`.
- Sparkline detail: lebar penuh (viewBox responsif), crosshair + tooltip `tanggal · nilai`, label min/max.
- Level harga ≥ 1000 tetap 2 desimal.

## 6. Batas kerja

- Perubahan UI **tidak boleh** mengubah route data atau rumus skor. Kalau perlu, buat kartu terpisah.
- Berkas yang dipakai bersama (mis. `server/routes/idx.js`) di-commit **per-hunk**; jangan menyapu perubahan penulis lain.
- Setiap kartu UI wajib menyebut: berkas yang disentuh, angka contoh sebelum/sesudah, dan cara memverifikasi (biasanya ukur lebar kolom / hitung angka >2 desimal di halaman).
