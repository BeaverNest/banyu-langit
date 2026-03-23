# 🌊 Banyu Langit — Git & Update Procedures

## 1. Setup Awal (Sekali Aja)

### Install Git
Download dari https://git-scm.com/download/win → install default semua.

### Init Repository
```powershell
cd C:\Project\banyu-langit
git init
git add .
git commit -m "V2 initial - all features working"
```

### Buat .gitignore
Buat file `.gitignore` di folder banyu-langit:
```
node_modules/
data/*.db
data/*.json
uploads/
*.log
```
Lalu:
```powershell
git add .gitignore
git commit -m "add gitignore"
```

Selesai. Sekarang semua file ke-track.

---

## 2. Workflow Update dari Claude

### A. Update Per-File (fix kecil)
Claude kasih 1-2 file, misal `screener.js` dan `market.css`.

```powershell
# 1. Replace file yang dikasih Claude
#    (copy/paste ke folder yang sesuai)

# 2. Cek apa yang berubah
git diff

# 3. Commit
git add .
git commit -m "fix screener sort + market css"

# 4. Rebuild
docker compose up -d --build

# 5. Test di browser

# 6. Kalau CRASH → rollback instant:
git checkout .
docker compose up -d --build
```

### B. Update Full Archive (fitur besar)
Claude kasih `banyu-langit-v2.tar.gz`.

```powershell
# 1. Backup dulu (otomatis via git)
git add .
git commit -m "backup before big update"

# 2. Extract archive — JANGAN timpa docker-compose.yml
#    Extract semua KECUALI docker-compose.yml dan data/

# 3. Commit
git add .
git commit -m "big update: screener v2 + global search"

# 4. Rebuild
docker compose up -d --build

# 5. Test

# 6. Kalau CRASH:
git checkout .
docker compose up -d --build
```

### C. Rollback ke Versi Tertentu
```powershell
# Lihat history semua commit
git log --oneline

# Output contoh:
# a1b2c3d fix screener sort
# e4f5g6h add global search
# i7j8k9l V2 initial

# Balik ke commit tertentu:
git checkout e4f5g6h .
docker compose up -d --build
```

---

## 3. Perintah Git yang Perlu Diingat

| Perintah | Fungsi |
|----------|--------|
| `git status` | Lihat file apa yang berubah |
| `git diff` | Lihat detail perubahan |
| `git add .` | Stage semua perubahan |
| `git commit -m "pesan"` | Simpan snapshot |
| `git log --oneline` | Lihat history |
| `git checkout .` | Batalkan semua perubahan (balik ke commit terakhir) |
| `git checkout abc123 .` | Balik ke commit tertentu |
| `git stash` | Simpan perubahan sementara (belum commit) |
| `git stash pop` | Kembalikan perubahan yang di-stash |

---

## 4. Tips

### Commit Message Convention
Pakai format singkat yang jelas:
```
fix: screener filter bug
add: global search
update: idx daily digest layout
refactor: split insider.js
```

### Kapan Harus Commit
- ✅ Setelah replace file dari Claude, SEBELUM rebuild
- ✅ Setelah test berhasil (commit lagi kalau ada minor fix)
- ❌ Jangan commit saat app crash (rollback dulu)

### File yang TIDAK Boleh di-Replace Sembarangan
- `docker-compose.yml` — ada volume config spesifik ke V1
- `data/` folder — ini database, jangan di-overwrite
- `uploads/` folder — ini gambar diary

### Kalau Ragu
```powershell
# Cek status dulu
git status
git diff

# Kalau mau aman, stash dulu
git stash
# Test...
# Kalau ok:
git stash pop
git commit -m "update ok"
# Kalau gagal:
git stash drop
```

---

## 5. Workflow Lengkap (Step by Step)

```
Claude kasih update
    ↓
git status (cek bersih)
    ↓
Replace file(s)
    ↓
git diff (review perubahan)
    ↓
git add . && git commit -m "deskripsi"
    ↓
docker compose up -d --build
    ↓
Test di browser
    ↓
  OK? ──→ Done ✅
    ↓
  CRASH?
    ↓
git checkout .
    ↓
docker compose up -d --build
    ↓
Report bug ke Claude 🐛
```

---

*Last updated: 2026-03-06*