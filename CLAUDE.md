# WA Inbox — KPP Pratama Banyuwangi

Aplikasi web internal untuk membaca dan membalas chat WhatsApp Business (Cloud API, langsung ke Meta), plus REST API untuk integrasi sistem lain.

Baca sebelum bekerja:

- [docs/STATUS.md](docs/STATUS.md): posisi pekerjaan terakhir, keputusan, kendala. **Mulai dari sini.**
- [docs/PRD.md](docs/PRD.md): kebutuhan produk.
- [docs/SPEC.md](docs/SPEC.md): desain teknis, sumber kebenaran.
- [docs/PROMPTS.md](docs/PROMPTS.md): urutan pembangunan.
- `DEPLOYMENT.local.md` (tidak di-commit): akses SSH dan detail server.

## Aturan kerja

- Semua pembangunan dikerjakan dari laptop ini (Claude Code di folder proyek), lalu dideploy langsung ke server lewat SSH (SPEC §12). Tidak ada sesi cloud dan tidak ada auto-deploy.
- Di akhir setiap langkah, perbarui `docs/STATUS.md`: apa yang selesai, keputusan, langkah berikutnya.
- Teks UI dan pesan error untuk pengguna dalam bahasa Indonesia. Kode, nama variabel, dan commit message dalam bahasa Inggris.
- Stack dan struktur repo mengikuti SPEC §2–§3. Jika ada keputusan yang mengubah desain, perbarui SPEC di commit yang sama.
- Pengiriman pesan ke Meta tidak boleh di-retry otomatis (risiko terkirim ganda).
- Setiap langkah: test, lint, dan typecheck hijau sebelum commit dan deploy.

## Git dan GitHub

- Repo GitHub `lililomo/Simple-WhatsApp-Business-Customer-Services-Tanpa-Langganan` hanya **cadangan dan riwayat**. Push setelah commit; deploy tidak bergantung padanya.
- **Repo ini publik.** Jangan pernah meng-commit:
  - nilai rahasia: isi `.env`, token Meta, App Secret, password, API key;
  - detail infrastruktur: alamat/port SSH, port panel, IP, daftar site lain di server.
  Detail infrastruktur ada di `DEPLOYMENT.local.md` dan `deploy/deploy.local.env` (keduanya di-ignore git).

## Server produksi

- aaPanel 8 dengan web server Apache. Semua sumber daya server (site, SSL, database, cron, backup, restart Node project) dikelola **lewat aaPanel**, baik UI maupun modul Python-nya via `btpython` (contoh: `deploy/server/bin/restart.sh`). Jangan membuat vhost, cron, atau database di luar aaPanel.
- Node project aaPanel `wa_kppbwi_app`, folder `/www/wwwroot/wa.kppbwi.app`, port 3210, user `www`. Database `wainbox` (MariaDB 10.11).
- Deploy hanya lewat `scripts/deploy.sh` (dibuat di Prompt 3). Jangan mengedit file di folder produksi secara langsung.
- Disk server terbatas: jangan menimbun release, log, atau backup.
