# Status Proyek

Diperbarui di akhir setiap langkah (lihat CLAUDE.md). Entri terbaru di atas.

## Posisi sekarang

- **Fase:** pembangunan fase 1.
- **Selesai:** Prompt 0 (fondasi repo: npm workspaces shared/server/web, TypeScript 6.0, ESLint 10, Vitest 5, Fastify 5 `/healthz`, Vite 8 + React 19 + Tailwind 4, komponen UI bergaya shadcn di atas `radix-ui`).
- **Selesai:** Prompt 1 (config zod, skema Drizzle 14 tabel + migrasi `server/drizzle/0000_init.sql`, AES-256-GCM, argon2id, CLI `db:migrate` & `user:create`, test DB).
  - Database `wainbox_dev` dan `wainbox_test` dibuat lewat aaPanel. Akses dari laptop lewat tunnel `ssh -N -L 3307:127.0.0.1:3306 <host>`; kredensial hanya di `.env` lokal.
  - Kolom JSON memakai tipe kustom `jsonText` karena MariaDB menyimpan JSON sebagai LONGTEXT dan kolom json bawaan Drizzle tidak mem-parse.
  - Admin dev lokal: `DEV_ADMIN_EMAIL`/`DEV_ADMIN_PASSWORD` di `.env` lokal.
- **Selesai:** Prompt 2 (sesi cookie `wai_sess` + tabel sessions, login/logout/me/ganti password, rate limit login per IP & per email, cek Origin untuk request non-GET, kelola pengguna khusus admin dengan proteksi admin terakhir, audit log; web: login, layout rail, pengaturan Profil & Pengguna, tema gelap/terang). Diuji di browser lokal.
- **Selesai:** Prompt 3 (pipeline deploy laptop → server).
  - `scripts/deploy.sh`, `deploy/server/activate.sh`, serta `bin/` (cli, restart, watchdog, rollback). Semua jalur gagal diuji di sandbox server.
  - Deploy pertama sukses 1 Nov 2026: `https://wa.kppbwi.app/healthz` melaporkan SHA commit, dan perintah jalan aaPanel sudah `node --env-file=.env app/server/dist/index.js`. Rollback manual teruji.
  - Cron aaPanel "WA Inbox – Watchdog" (tiap 5 menit) dan "Backup DB wainbox" (harian 01:00, simpan 7) aktif, dan sudah sukses dijalankan sekali.
  - Build di server memakai cache npm milik `www` (cache global aaPanel dimiliki root) dan membuang devDependencies setelah build.
  - **Admin produksi belum dibuat:** pemilik menjalankan sendiri `ssh -t <host> bash /www/wwwroot/wa.kppbwi.app/bin/cli.sh user:create --admin` dan mengetik password di terminal.
- **Selesai:** Prompt 4 (Graph client dengan retry khusus GET, peta error Meta → bahasa Indonesia, modul koneksi: validasi App ID/Secret lewat app access token, validasi WABA + daftar nomor, simpan terenkripsi, cek koneksi + subscribe app ke WABA, register nomor dengan PIN, status error saat token ditolak; web: wizard Pengaturan → WhatsApp dan banner status koneksi).
- **Selesai:** Prompt 5.
  - Penerima webhook `/webhooks/meta`: verifikasi `hub.challenge`; raw body maks 3 MB; signature HMAC wajib, dan yang tidak valid ditolak 401 tanpa disimpan.
  - Worker in-process dengan `FOR UPDATE SKIP LOCKED`, lease, dan backoff.
  - Prosesor pesan masuk semua tipe, status monoton + pricing, reaksi, kutipan, status template, dan sinyal akun.
  - Unduh media ke `STORAGE_DIR`, dilayani dengan CSP sandbox.
  - Admin bisa melihat dan memproses ulang webhook yang gagal.
  - Uji lokal: `npm run simulate -- text "..."`.
- **Selesai:** Prompt 6.
  - Server: daftar percakapan (filter, pencarian nama/nomor/isi, nomor `08…` dicocokkan dengan `628…`, cursor); riwayat pesan per halaman; tandai dibaca + satu read receipt ke Meta; ubah nama kontak; ringkasan belum dibaca; SSE `/api/events` dengan heartbeat 20 detik dan cek ulang sesi.
  - Web: layout 2 panel (1 panel di HP), daftar virtual, linimasa virtual dengan muat pesan lama, gelembung per tipe pesan, format teks WhatsApp, status centang, sisa jendela 24 jam, info kontak, notifikasi browser + suara, jumlah belum dibaca di judul tab. Diuji di browser lokal dengan webhook simulasi.
  - **Belum diverifikasi:** SSE lewat Apache di produksi (butuh login admin produksi).
- **Selesai:** Prompt 7.
  - Kirim teks, balasan berkutip, dan lampiran: unggah ke Meta dengan validasi jenis/ukuran sesuai batas Meta, simpan salinan lokal.
  - Pengiriman: alur `pending → accepted/failed`, idempoten per `clientRef`; pesan bebas ditolak di luar jendela 24 jam tanpa memanggil Meta; penolakan Meta disimpan sebagai pesan gagal + alasan, dan bisa dicoba ulang; token ditolak → status koneksi error + event real-time.
  - Web: kotak balas (Enter kirim, Shift+Enter baris baru, lampiran, bar kutipan, kunci saat jendela tertutup), pesan optimistis, peringatan NIK/NPWP, tombol "Coba lagi".
  - Reaksi keluar dan emoji picker (prioritas S) belum dibuat.
- **Selesai:** Prompt 8.
  - Sinkron template dari Meta: paging, upsert, tandai `DELETED`; lewat tombol dan CLI `templates:sync`, plus cron aaPanel tiap 30 menit.
  - Kirim template: variabel header/isi/tombol URL dinamis, header media; parameter posisi `{{1}}` maupun bernama `{{nama}}`. Teks hasil isian disimpan.
  - Mulai chat baru ke nomor `08…`/`+62…` dengan template.
  - Web: pemilih template (cari, penanda biaya Marketing, isian variabel, preview) dan dialog "Chat baru".
- **Langkah berikutnya:** Prompt 9 di [PROMPTS.md](PROMPTS.md).
- Catatan teknis: TypeScript dikunci `~6.0` karena typescript-eslint belum mendukung TS 7. Komponen UI ditulis manual (bukan lewat CLI shadcn) di `web/src/components/ui/`.
- **Produksi:** https://wa.kppbwi.app menjalankan placeholder (`placeholder/server.js` di server, di luar repo).

## Infrastruktur yang sudah siap

| Item | Status |
|---|---|
| Domain `wa.kppbwi.app` + SSL Let's Encrypt (aaPanel, perpanjangan otomatis) | Aktif, Force HTTPS |
| Node project aaPanel `wa_kppbwi_app` (port 3210, user www, auto-start) | Aktif (placeholder) |
| Database MariaDB `wainbox` (dibuat lewat aaPanel) | Kosong, kredensial di `.env` server |
| `deploy/server/bin/restart.sh` (restart Node project lewat aaPanel) | Teruji |
| Pipeline deploy laptop → server | **Belum**, dibuat di Prompt 3 |
| Database dev `wainbox_dev` | **Belum**, dibuat di Prompt 1 |
| Meta App + system user token | **Belum**, ikuti SPEC §14 (Prompt 11) |

## Log keputusan

### 2026-11-01 — skema cloud dibatalkan

- **Kembali ke skema awal:** semua pembangunan dari laptop (Claude Code di folder proyek), deploy langsung ke server lewat SSH (`scripts/deploy.sh`, Prompt 3).
- Yang dihapus: auto-deploy berbasis cron + git pull di server, clone dev di server, deploy key GitHub, dokumen CLOUD.md, Prompt R, rencana CI/branch protection, dan hook sesi cloud.
- Repo GitHub tetap ada, tetapi hanya sebagai cadangan dan riwayat.
- Pelajaran dari review sesi cloud tetap dipakai:
  - skrip deploy wajib mengecek setiap langkah secara eksplisit (`set -e` diabaikan di fungsi yang dipanggil dari `if`);
  - `/healthz` mengembalikan versi yang dicocokkan saat deploy;
  - deskriptor kunci flock ditutup saat restart;
  - output build tidak masuk log utama;
  - migrasi additive;
  - webhook dibatasi 3 MB, dan signature tidak valid ditolak tanpa menyimpan payload (SPEC §6.2).
- Klaim harga di PRD §7 sudah sesuai halaman Pricing resmi Meta (perubahan 1 Okt 2026). Sumber dicantumkan.

### 2026-11-01 — perencanaan awal

- Aplikasi internal saja (direct developer di Meta): koneksi manual WABA ID + system user token, tanpa Embedded Signup, Tech Provider, maupun App Review.
- Fase 1 = inbox chat + API v1 + webhook keluar. Fitur tim dan balasan otomatis luar jam layanan masuk fase 2. Kirimdev tetap berjalan paralel sampai fitur balasan otomatis itu ada.
- Stack: Node 24 + TypeScript + Fastify + React/Vite + MariaDB 10.11 (Drizzle). Real-time memakai SSE, karena vhost Apache buatan aaPanel tidak mendukung WebSocket tanpa edit manual.
- Repo publik: detail infrastruktur disimpan di `DEPLOYMENT.local.md` (tidak di-commit).

## Kendala terbuka

- Disk server tinggal sekitar 11 GB. Batasi release, log, backup, dan retensi media.
- Perlu dicek: apakah Meta App lama milik kantor bisa dipakai ulang (catatan di `DEPLOYMENT.local.md`).
