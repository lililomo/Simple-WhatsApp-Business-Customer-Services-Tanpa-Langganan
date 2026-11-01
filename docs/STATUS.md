# Status Proyek

Diperbarui di akhir setiap langkah (lihat CLAUDE.md). Entri terbaru di atas.

## Posisi sekarang

- **Fase:** fase 1 selesai dan **live** sejak 1 Nov 2026 (laporan di [GO-LIVE.md](GO-LIVE.md)). Kirimdev masih berjalan paralel.
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
  - SSE lewat Apache di produksi terverifikasi di Prompt 11 (SPEC §8).
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
- **Selesai:** Prompt 9.
  - API key `wai_…`: hash SHA-256, scope, cabut.
  - REST `/api/v1`: kirim teks/template/media, status pesan, percakapan, pesan, kontak, template, unggah/unduh media. Rate limit per key; `Idempotency-Key` dengan placeholder anti-ganda.
  - Swagger UI di `/api/docs` khusus admin.
  - Webhook keluar: `message.received`/`message.sent`/`message.status` ditandatangani HMAC, retry 1 mnt–24 jam, nonaktif otomatis setelah 50 gagal, kirim ulang/uji/ganti secret.
  - UI Pengaturan → API & Webhook; panduan integrasi di [API.md](API.md).
- **Selesai:** Prompt 10.
  - Pemeriksaan hak akses dipindah ke `preValidation`, agar request tanpa login/hak selalu dibalas 401/403 sebelum validasi body. Ditambah test matriks otorisasi untuk semua rute admin dan sesi.
  - Halaman publik `/privacy` (draf; bagian [PERLU DISETUJUI] wajib diisi kantor).
  - CLI `housekeeping` + cron aaPanel "WA Inbox – Housekeeping" (harian 02:30).
  - Code review seluruh kode menemukan 7 masalah, semuanya diperbaiki:
    - timeout unduh media 5 menit;
    - tidak ada file yatim saat unggah ke Meta gagal;
    - notifikasi Android tidak lagi error;
    - variabel tombol URL dikunci per indeks tombol;
    - penghitung percobaan dibersihkan berkala;
    - pencarian isi pesan memakai indeks FULLTEXT (migrasi `0001`);
    - API v1 tidak membuat kontak kosong saat ditolak `window_closed`.
  - Disk server 1 Nov 2026: sisa 11 GB (88% terpakai). Aplikasi memakai sekitar 300 MB (3 release ≈ 211 MB, cache npm 82 MB).
- **Selesai:** Prompt 11 (go-live, 1 Nov 2026). Detail di [GO-LIVE.md](GO-LIVE.md).
  - Meta App baru dengan use case WhatsApp, system user Admin + token tanpa kedaluwarsa, webhook terverifikasi, app dipublikasikan.
  - Uji nyata berhasil: pesan masuk, balasan, status centang, gambar, dokumen dua arah, voice note, reaksi, sinkron template. Kirim template belum diuji (berbayar).
  - SSE produksi terverifikasi (SPEC §8).
  - Perbaikan dari uji:
    - "Cek koneksi" tidak lagi memperingatkan `code_verification_status` EXPIRED pada nomor yang CONNECTED;
    - linimasa menggulir ke pesan terbaru saat tab terlihat lagi, menampilkan tombol "Pesan baru", dan mengulang fetch yang tertimpa event real-time.
- **Cron aaPanel aktif:** WA Inbox – Watchdog (5 menit), Backup DB wainbox (01:00, simpan 7), WA Inbox – Sinkron template (30 menit), WA Inbox – Housekeeping (02:30).
- **Langkah berikutnya:**
  1. Kantor melengkapi bagian [PERLU DISETUJUI] di halaman `/privacy`.
  2. Fase 2 (prompt pembuka di PROMPTS.md "Setelah fase 1"). Kirimdev dilepas setelah balasan otomatis luar jam layanan tersedia, dan hanya dengan persetujuan pemilik.
- Catatan teknis: TypeScript dikunci `~6.0` karena typescript-eslint belum mendukung TS 7. Komponen UI ditulis manual (bukan lewat CLI shadcn) di `web/src/components/ui/`.
- **Produksi:** https://wa.kppbwi.app menjalankan aplikasi dari release terbaru (`scripts/deploy.sh`).

## Infrastruktur yang sudah siap

| Item | Status |
|---|---|
| Domain `wa.kppbwi.app` + SSL Let's Encrypt (aaPanel, perpanjangan otomatis) | Aktif, Force HTTPS |
| Node project aaPanel `wa_kppbwi_app` (port 3210, user www, auto-start) | Aktif (aplikasi) |
| Database MariaDB `wainbox` (dibuat lewat aaPanel) | Aktif, kredensial di `.env` server |
| `deploy/server/bin/restart.sh` (restart Node project lewat aaPanel) | Teruji |
| Pipeline deploy laptop → server | Aktif (Prompt 3) |
| Database dev `wainbox_dev` + test `wainbox_test` | Aktif (Prompt 1) |
| Meta App + system user token | Aktif sejak 1 Nov 2026 (detail di `DEPLOYMENT.local.md`) |

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
- Halaman `/privacy` masih draf; bagian [PERLU DISETUJUI] menunggu kantor.
- Business verification di Meta masih "In progress".
