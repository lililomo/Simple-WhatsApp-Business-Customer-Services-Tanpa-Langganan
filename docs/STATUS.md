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

### 2026-11-01

- Aplikasi internal saja (direct developer di Meta): koneksi manual WABA ID + system user token, tanpa Embedded Signup, Tech Provider, maupun App Review.
- Fase 1 = inbox chat + API v1 + webhook keluar. Fitur tim dan balasan otomatis luar jam layanan masuk fase 2. Kirimdev tetap berjalan paralel sampai fitur balasan otomatis itu ada.
- Stack: Node 24 + TypeScript + Fastify + React/Vite + MariaDB 10.11 (Drizzle). Real-time memakai SSE, karena vhost Apache buatan aaPanel tidak mendukung WebSocket tanpa edit manual.
- Repo GitHub publik `lililomo/Simple-WhatsApp-Business-Customer-Services-Tanpa-Langganan` jadi sumber kebenaran. Produksi menarik `main` lewat cron aaPanel. Detail infrastruktur disimpan di `DEPLOYMENT.local.md` (tidak di-commit).
- Pembagian kerja: rencana/redesign dengan Fable di cloud; eksekusi dengan Opus (effort xhigh/max). Tugas yang menyentuh server dikerjakan dari laptop atau clone dev di server.

## Kendala terbuka

- Disk server tinggal sekitar 11 GB. Batasi release, log, backup, dan retensi media.
- Perlu dicek: apakah Meta App lama milik kantor bisa dipakai ulang (catatan di `DEPLOYMENT.local.md`).
