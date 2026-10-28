# Security policy — secrets

## Aturan

- **Rahasia tidak pernah masuk git.** Nilai hidup di `.env` di host (mode `600`), tidak di repo.
- `.env.example` adalah satu-satunya berkas env yang boleh di-commit, dan **hanya berisi nama variabel dengan nilai kosong**.
- `.gitignore` memblokir `.env`, `.env.*`, `env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `.npmrc`, `.pypirc`, `.netrc`, `.aws/`, `.ssh/`, `id_rsa*`, `id_ed25519*`.
- `.githooks/pre-commit` menolak commit yang membawa berkas berbentuk rahasia **atau** baris baru yang memuat pola kunci (GitHub PAT, `ghp_`, `sk-…`, AWS `AKIA…`, private key block, Slack, Google, Stripe, assignment `*_KEY=`).
- `.github/workflows/secret-guard.yml` adalah penjaga sisi server: hook lokal bisa dilewati dengan `--no-verify`, CI tidak.

Tiga lapis, sengaja tumpang tindih:

| lapis | menahan siapa | bisa dilewati? |
|---|---|---|
| `.gitignore` | commit tidak sengaja | `git add -f` |
| `.githooks/pre-commit` | commit tidak sengaja + `git add -f` | `git commit --no-verify`, clone yang belum install hook |
| CI `secret-guard` | semua push/PR ke remote | butuh admin repo untuk bypass required check |

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

## Kalau sebuah rahasia sudah ter-commit

Menghapus berkas di commit berikutnya **tidak** menariknya dari publik. Diukur 2026-10-28 pada repo ini dan pada repo probe berisi kunci palsu:

- `raw.githubusercontent.com/<owner>/<repo>/<sha>/.env` tetap **200** selama commit itu ada.
- `github.com/<owner>/<repo>/commit/<sha>.patch` juga tetap **200** (nilai kunci ikut tercetak di diff).
- `api.github.com/repos/<owner>/<repo>/commits/<sha>` juga **200**.
- Cermin pihak ketiga ikut menyajikan blob yang sama: `cdn.jsdelivr.net/gh/<owner>/<repo>@<sha>/.env` → 200, `ghproxy.net/...` → 200.

Urutan yang benar, dan apa yang benar-benar menutup lubang (semua terukur):

1. **Rotasi/revoke kunci di penyedianya.** Ini satu-satunya langkah yang menutup lubang; history bersih tidak menolong siapa pun yang sudah menyalin nilainya.
2. Pasang nilai baru di `.env` host, restart service.
3. **Jadikan repo private** kalau tujuannya menghentikan penyebaran. Terukur: setelah private, `raw`/`patch`/`api` untuk commit lama → **404** dan halaman repo → **404**. Tapi ada jeda propagasi — satu probe masih menyajikan isi 200 selama **±4 menit** setelah flip (`x-cache: HIT`, `cache-control: max-age=300`). Jangan simpulkan "masih bocor" dari satu curl yang langsung dijalankan sesudah flip.
4. **`git filter-repo` + force-push TIDAK mem-404-kan SHA lama.** Terukur pada repo probe publik: setelah rewrite dan force-push sukses (HEAD remote == HEAD hasil rewrite), `raw/<old-sha>/.env` masih **200** dan `.patch`-nya masih **200** dengan nilai di dalamnya. Rewrite mencegah kebocoran **berikutnya** dari clone basi, bukan menutup URL yang sudah terlanjur ada.
5. Kalau repo harus tetap publik dan URL lama harus mati: **tiket ke GitHub Support** dengan nama repo + daftar SHA. Itu jalur resminya, bukan force-push.

Kesimpulan praktis: rotasi dulu, lalu private (atau Support), baru rewrite untuk kebersihan.

## Register rotasi

Tanggal = tanggal kunci lama dinyatakan tidak berlaku. **Nilai tidak pernah dicatat di sini.**

| Kunci | Terekspos | Media | Status | Tanggal rotasi |
|---|---|---|---|---|
| `ALPHA_VANTAGE_KEY` | 2026-03-24 (commit `064b41d`), masih 200 via raw untuk `064b41d`/`7dfb06e`/`eda9cf3` | repo publik `banyu-langit` (berkas `.env`) | **terverifikasi masih AKTIF** pada 2026-10-28 (memanggil `GLOBAL_QUOTE` → 200, `Global Quote` berisi harga IBM) — menunggu rotasi di dashboard Alpha Vantage | — (belum) |

Catatan cakupan: nilai lama **tidak** ditemukan di host ini (0 dari 927.950 berkas yang dipindai di profil agen, `ops/`, `market-rails`, `IDX-API`, `toku-kanban-web`, `banyu-langit-bt`, `.config`). Artinya kunci itu tidak dipakai jalur produksi mana pun sekarang; yang bocor adalah kuota gratis milik pemilik akun, bukan akses ke data kita.

Variabel lain di blob yang sama: `PORT`, `API_KEY` (kosong), `LOG_LEVEL`, `DB_PATH`, `TAGS_PATH` (keduanya path relatif). Tidak ada nilai rahasia lain di berkas itu, dan tidak ada pola kunci provider lain di seluruh riwayat repo (169 MB patch dipindai: 0 hit untuk PAT/OpenAI/AWS/Google/Slack/Stripe/private-key).

Catatan tentang secret scanning GitHub: pada repo ini `secret_scanning` dan `secret_scanning_push_protection` **enabled** tetapi menghasilkan **0 alert** untuk kebocoran ini. Kunci Alpha Vantage 16 karakter tidak dikenali polanya, jadi push protection GitHub tidak akan menangkapnya. Itu sebabnya tiga lapis di atas bukan opsional.
