# Security policy — secrets

## Aturan

- **Rahasia tidak pernah masuk git.** Nilai hidup di `.env` di host (mode `600`), tidak di repo.
- `.env.example` adalah satu-satunya berkas env yang boleh di-commit, dan **hanya berisi nama variabel dengan nilai kosong**.
- `.gitignore` memblokir `.env`, `.env.*`, `env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.pypirc`, `.netrc`, `.aws/`, `.ssh/`, `id_rsa*`, `id_ed25519*`.
- `.githooks/pre-commit` menolak commit yang membawa berkas berbentuk rahasia **atau** baris baru yang memuat pola kunci (GitHub PAT, `ghp_`, `sk-…`, AWS `AKIA…`, private key block, Slack, Google, Stripe, assignment `*_KEY=`).

Aktifkan hook **sekali per clone**:

```sh
.githooks/install.sh          # -> git config core.hooksPath .githooks
```

Verifikasi hook hidup:

```sh
printf 'PORT=3000\n' > .env
git add -f .env && git commit -m probe    # harus DITOLAK, keluar rc=1
git restore --staged .env
```

`git commit --no-verify` melewati hook. Itu jalan keluar yang disengaja untuk false positive, bukan kebiasaan.

## Kalau sebuah rahasia sudah ter-commit

Menghapus berkas di commit berikutnya **tidak** menariknya dari publik: URL `raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>` tetap 200 selama commit itu ada. Urutan yang benar:

1. **Rotasi kunci di penyedianya** — ini satu-satunya langkah yang benar-benar menutup lubang.
2. Pasang nilai baru di `.env` host, restart service.
3. Baru bersihkan history (`git filter-repo`) dan force-push.
4. Kalau permintaan raw untuk SHA lama masih 200 setelah force-push, itu cache GitHub: buka tiket ke GitHub Support dengan nama repo + SHA; force-push sendiri tidak dijamin mem-404-kan.

## Register rotasi

Tanggal = tanggal kunci lama dinyatakan tidak berlaku. **Nilai tidak pernah dicatat di sini.**

| Kunci | Terekspos | Media | Status | Tanggal rotasi |
|---|---|---|---|---|
| `ALPHA_VANTAGE_KEY` | 2026-03-24 (commit `064b41d`), masih 200 via raw untuk `064b41d`/`7dfb06e`/`eda9cf3` | repo publik `banyu-langit` (berkas `.env`) | **terverifikasi masih AKTIF** pada 2026-10-28 — menunggu rotasi di dashboard Alpha Vantage | — (belum) |

Catatan cakupan: nilai lama **tidak** ditemukan di host ini (0 dari 927.950 berkas yang dipindai di profil agen, `ops/`, `market-rails`, `IDX-API`, `toku-kanban-web`, `banyu-langit-bt`, `.config`). Artinya kunci itu tidak dipakai jalur produksi mana pun sekarang; yang bocor adalah kuota gratis milik pemilik akun, bukan akses ke data kita.
