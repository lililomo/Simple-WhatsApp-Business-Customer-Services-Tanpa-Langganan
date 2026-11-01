# WA Inbox — KPP Pratama Banyuwangi

Aplikasi web internal untuk membaca dan membalas chat WhatsApp Business (Cloud API, langsung ke Meta), plus REST API untuk integrasi sistem lain.

Baca sebelum bekerja:

- [docs/STATUS.md](docs/STATUS.md): posisi pekerjaan terakhir, keputusan, kendala. **Mulai dari sini.**
- [docs/PRD.md](docs/PRD.md): kebutuhan produk.
- [docs/SPEC.md](docs/SPEC.md): desain teknis, sumber kebenaran.
- [docs/PROMPTS.md](docs/PROMPTS.md): urutan pembangunan, beserta tempat dan model untuk tiap langkah.
- [docs/CLOUD.md](docs/CLOUD.md): cara bekerja di sesi cloud Claude Code.

## Aturan kerja

- **Repo GitHub ini sumber kebenaran.** Semua desain dan keputusan harus ada di repo (docs/), bukan di memori sesi atau catatan lokal, agar sesi lain, akun lain, atau mesin lain bisa melanjutkan.
- Di akhir setiap langkah, perbarui `docs/STATUS.md`: apa yang selesai, keputusan, langkah berikutnya.
- Teks UI dan pesan error untuk pengguna dalam bahasa Indonesia. Kode, nama variabel, dan commit message dalam bahasa Inggris.
- Stack dan struktur repo mengikuti SPEC §2–§3. Jika ada keputusan yang mengubah desain, perbarui SPEC di commit yang sama.
- **Repo ini publik.** Jangan pernah meng-commit:
  - nilai rahasia: isi `.env`, token Meta, App Secret, password, API key;
  - detail infrastruktur: alamat/port SSH, port panel, IP, daftar site lain di server.
  Detail infrastruktur disimpan di `DEPLOYMENT.local.md` (di-ignore git).
- Pengiriman pesan ke Meta tidak boleh di-retry otomatis (risiko terkirim ganda).
- Setiap langkah: test, lint, dan typecheck hijau sebelum commit.

## Alur kode dan deploy

- Branch `main` = produksi. Kerjakan di branch, gabungkan ke `main` lewat PR (atau push langsung untuk perubahan kecil yang sudah dites).
- Server menarik `main` secara otomatis (cron aaPanel "WA Inbox – Auto deploy", tiap 2 menit): pull → build → migrate → restart → healthcheck, rollback jika gagal. Rincian di SPEC §12.
- **Folder produksi di server hanya menerima pull. Jangan mengedit file di sana.** Untuk bekerja di server, pakai clone dev, lalu push ke GitHub.
- Kontrak `package.json` root untuk auto-deploy: script `build` dan `db:migrate` (yang membaca `.env` sendiri), plus endpoint `GET /healthz`.

## Server produksi

- aaPanel 8 dengan web server Apache. Semua sumber daya server (site, SSL, database, cron, backup, restart Node project) dikelola **lewat aaPanel**, baik UI maupun modul Python-nya via `btpython` (contoh: `deploy/aapanel/restart.sh`). Jangan membuat vhost, cron, atau database di luar aaPanel.
- Node project aaPanel `wa_kppbwi_app`, folder `/www/wwwroot/wa.kppbwi.app`, port 3210, user `www`. Database `wainbox` (MariaDB 10.11).
- Akses SSH dan detail server lainnya ada di `DEPLOYMENT.local.md`, di laptop admin dan di server. Sesi cloud tidak punya akses ke server, jadi tugas yang menyentuh server dikerjakan dari laptop atau clone dev di server (lihat kolom "Tempat" di PROMPTS.md).
- Disk server terbatas: jangan menimbun build, log, atau backup.
