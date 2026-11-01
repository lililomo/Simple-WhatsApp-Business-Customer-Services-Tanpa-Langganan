# Status Proyek

Diperbarui di akhir setiap langkah (lihat CLAUDE.md). Entri terbaru di atas.

## Posisi sekarang

- **Fase:** perencanaan selesai (draf v1). Kode aplikasi belum dibuat.
- **Langkah berikutnya:** Prompt R (review & redesign dokumen dengan Fable di cloud, opsional), lalu Prompt 0 di [PROMPTS.md](PROMPTS.md).
- **Produksi:** https://wa.kppbwi.app menjalankan placeholder (`deploy/placeholder/server.js`) dan sudah ikut auto-deploy dari `main`.

## Infrastruktur yang sudah siap

| Item | Status |
|---|---|
| Domain `wa.kppbwi.app` + SSL Let's Encrypt (aaPanel, perpanjangan otomatis) | Aktif, Force HTTPS |
| Node project aaPanel `wa_kppbwi_app` (port 3210, user www, auto-start) | Aktif (placeholder) |
| Database MariaDB `wainbox` (dibuat lewat aaPanel) | Kosong, kredensial di `.env` server |
| Folder produksi = clone repo ini (`main`), deploy key read-only | Aktif |
| Cron aaPanel "WA Inbox – Auto deploy" (tiap 2 menit) | Aktif, log di `/www/wwwlogs/wa_kppbwi_app-deploy.log` |
| Clone dev di server (deploy key read-write) | Siap |
| Cloud environment Claude Code | **Belum**, ikuti [CLOUD.md](CLOUD.md) |
| Meta App + system user token | **Belum**, ikuti SPEC §14 (Prompt 11) |

## Log keputusan

### 2026-11-01 — tindak lanjut review sesi cloud

Sesi cloud meninjau repo dan menemukan 7 hal. Penanganannya:

| # | Temuan | Status |
|---|---|---|
| 1 | `auto-deploy.sh` bisa mencatat OK padahal build gagal (`set -e` tidak berlaku di fungsi yang dipanggil dari `if`), dan healthcheck tidak mencocokkan SHA | **Diperbaiki**: setiap langkah dicek eksplisit; `/healthz.version` wajib sama dengan SHA target. Diuji di sandbox server |
| 2 | Commit rusak di-deploy ulang tiap 2 menit setelah rollback; output npm menumpuk di log | **Diperbaiki**: SHA gagal dicatat di `.deploy-state/failed-sha` dan dilewati sampai ada commit baru; output build ditimpa per deploy. Perubahan yang hanya menyentuh dokumen tidak lagi me-restart aplikasi |
| 3 | Tidak ada CI, padahal merge ke `main` langsung tayang | **Masuk Prompt 0**: GitHub Actions + branch protection |
| 4 | Docker daemon tidak berjalan di VM cloud; versi Node 24 berbeda minor | **Dicatat di CLOUD.md / Prompt 0**: hook menyalakan dockerd sendiri; beda minor Node 24 tidak masalah |
| 5 | `developers.facebook.com` diblokir jaringan VM | **Dicatat di CLOUD.md**: network Custom + domain itu, atau pakai WebFetch |
| 6 | Klaim harga (1.000 service gratis, utility dalam jendela berbayar) diragukan | **Tetap**: sudah sesuai halaman Pricing resmi Meta (perubahan 1 Okt 2026). Sumber dan tanggal ditambahkan di PRD §7 |
| 7 | Endpoint webhook publik bisa dipakai memenuhi disk | **Diperbaiki di SPEC §6.2**: batas body 3 MB, signature tidak valid → 401 tanpa menyimpan payload, rate limit per IP |

### 2026-11-01

- Aplikasi internal saja (direct developer di Meta): koneksi manual WABA ID + system user token, tanpa Embedded Signup, Tech Provider, maupun App Review.
- Fase 1 = inbox chat + API v1 + webhook keluar. Fitur tim dan balasan otomatis luar jam layanan masuk fase 2. Kirimdev tetap berjalan paralel sampai fitur balasan otomatis itu ada.
- Stack: Node 24 + TypeScript + Fastify + React/Vite + MariaDB 10.11 (Drizzle). Real-time memakai SSE, karena vhost Apache buatan aaPanel tidak mendukung WebSocket tanpa edit manual.
- Repo GitHub publik `lililomo/Simple-WhatsApp-Business-Customer-Services-Tanpa-Langganan` jadi sumber kebenaran. Produksi menarik `main` lewat cron aaPanel. Detail infrastruktur disimpan di `DEPLOYMENT.local.md` (tidak di-commit).
- Pembagian kerja: rencana/redesign dengan Fable di cloud; eksekusi dengan Opus (effort xhigh/max). Tugas yang menyentuh server dikerjakan dari laptop atau clone dev di server.

## Kendala terbuka

- Disk server tinggal sekitar 11 GB. Batasi release, log, backup, dan retensi media.
- Belum ada CI dan branch protection di `main` (dikerjakan di Prompt 0). Sampai itu ada, merge ke `main` hanya setelah test dijalankan.
- Perlu dicek: apakah Meta App lama milik kantor bisa dipakai ulang (catatan di `DEPLOYMENT.local.md`).
