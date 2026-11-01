# Bekerja di Sesi Cloud Claude Code

Sebagian besar pembangunan (menulis kode dan test) bisa dikerjakan di sesi cloud Claude Code (claude.ai/code). Hasilnya di-push ke GitHub, lalu server produksi menariknya otomatis.

## Yang perlu diketahui

- Sesi cloud memakai **kuota paket Claude yang sama** dengan Claude Code di laptop atau server. Tidak ada saldo terpisah. Keuntungannya:
  - tetap berjalan walau laptop mati;
  - bisa beberapa sesi sekaligus;
  - bisa dipantau dari HP;
  - otomatis membuat PR.
- Sesi cloud **tidak punya akses ke server produksi** (jaringan dibatasi, dan kunci SSH tidak boleh ditaruh di cloud). Langkah yang menyentuh aaPanel, database produksi, atau uji Meta asli dikerjakan dari laptop atau clone dev di server. Lihat kolom "Tempat" di [PROMPTS.md](PROMPTS.md).
- Semua konteks proyek ada di repo (CLAUDE.md + docs/). Sesi baru, akun Claude lain, atau mesin lain cukup clone repo lalu baca `docs/STATUS.md`.

## Persiapan satu kali

1. **Pasang Claude GitHub App** di repo ini: https://github.com/apps/claude → Configure → pilih repo `Simple-WhatsApp-Business-Customer-Services-Tanpa-Langganan`. App ini diperlukan agar sesi cloud bisa push branch dan membuat PR, dan agar fitur Auto-fix aktif. Alternatifnya, jalankan `/web-setup` dari Claude Code di laptop yang sudah login `gh`.
2. **Buat cloud environment** di claude.ai/code (pengaturan environment), misalnya bernama `WA Inbox`:
   - Network access: **Trusted** (default). Sudah mencakup npm registry, nodejs.org, Docker Hub, dan mirror Ubuntu, tapi **tidak** mencakup `developers.facebook.com`. Untuk Prompt R dan langkah lain yang perlu membaca dokumentasi Meta, pilih **Custom**, sertakan daftar default, lalu tambahkan `developers.facebook.com`. Tool WebFetch/WebSearch mungkin tetap bisa dipakai tanpa ini.
   - Setup script:

     ```bash
     #!/bin/bash
     set -euo pipefail
     # Node 24 (VM bawaan hanya menyediakan Node 20–22)
     if [ ! -x /opt/node24/bin/node ]; then
       curl -fsSL https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-x64.tar.xz -o /tmp/node24.tar.xz
       mkdir -p /opt/node24
       tar -xJf /tmp/node24.tar.xz -C /opt/node24 --strip-components=1
     fi
     # Image MariaDB yang sama dengan produksi, untuk test integrasi
     docker pull mariadb:10.11
     ```

     Hasil setup script di-cache, jadi sesi berikutnya cepat. Proses yang berjalan tidak ikut ter-cache, termasuk Docker daemon dan database. Dari review 1 Nov 2026, daemon Docker memang tidak otomatis berjalan di VM. Karena itu Prompt 0 menambahkan hook `SessionStart` di `.claude/settings.json` yang, hanya saat `CLAUDE_CODE_REMOTE=true`:
     - menaruh `/opt/node24/bin` di depan PATH;
     - menyalakan `dockerd` bila belum berjalan dan menarik `mariadb:10.11` bila belum ada;
     - menjalankan container database dan menunggu sampai siap;
     - mengisi `DATABASE_URL_TEST`.

     Jika image VM sudah punya `/opt/node24` dengan versi minor berbeda (mis. v24.22.x), skrip tidak memasang ulang. Itu tidak masalah: yang penting major 24, sama dengan produksi (v24.14.0).
3. **Tes sekali:** buka sesi baru di repo ini dan minta `node -v && docker ps`. Hasil yang diharapkan: `v24.x` (setelah Prompt 0) dan Docker berjalan.

## Model dan effort

Di sesi cloud, model dan effort dipilih dengan argumen: `/model <nama>` dan `/effort <low|medium|high|xhigh|max>`.

| Pekerjaan | Model | Effort |
|---|---|---|
| Merencanakan, meninjau, mendesain ulang dokumen (Prompt R, perubahan desain) | Fable 5.1 (jika tersedia di paket Anda) | high |
| Eksekusi prompt biasa | Opus 5.5 | xhigh |
| Prompt paling rumit (webhook, pengiriman, API v1) | Opus 5.5 | max |

Saran model per prompt ada di tabel [PROMPTS.md](PROMPTS.md). Nama alias model bisa berbeda per akun, jadi jalankan `/model` tanpa argumen untuk melihat daftar yang tersedia.

## Alur satu langkah

1. Buka claude.ai/code → pilih repo ini dan environment `WA Inbox`. Dari laptop bisa juga: `claude --cloud "<prompt>"`.
2. Atur model/effort, lalu tempel prompt dari PROMPTS.md.
3. Claude bekerja di branch `claude/…`, menjalankan test, push, dan membuat PR. Nyalakan **Auto-fix** di PR jika ingin Claude menangani CI gagal atau komentar review.
4. Tinjau diff → merge PR ke `main`.
5. Dalam ±2 menit server menarik `main`, build, migrate, restart, dan healthcheck. Hasilnya bisa dicek di log deploy server, dan nanti di `https://wa.kppbwi.app/healthz` (memuat SHA commit).
6. Jika ingin melanjutkan sesi cloud di laptop: `claude --teleport`.

## Pindah ke akun atau mesin lain

- **Akun Claude lain:** butuh akses ke repo GitHub (collaborator), Claude GitHub App terpasang di repo, dan cloud environment dengan setup script yang sama.
- **Laptop atau server tanpa cloud:** clone repo, jalankan `claude` di folder itu. CLAUDE.md dan docs/ otomatis menjadi konteks.
- **Detail infrastruktur server** (akses SSH dan sebagainya) tidak ada di repo publik. Detail itu ada di `DEPLOYMENT.local.md` di laptop admin dan di server.
