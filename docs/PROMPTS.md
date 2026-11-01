# Alur Prompt Pembangunan — WA Inbox

Urutan prompt untuk membangun aplikasi bersama Claude Code, di cloud, laptop, atau server.

## Cara memakai

- Jalankan **satu prompt per sesi**. Mulai sesi baru (atau `/clear`) sebelum prompt berikutnya. Konteks proyek dibaca otomatis dari `CLAUDE.md` dan docs/, jadi sesi baru tidak kehilangan arah.
- Salin blok prompt apa adanya. Bagian **Selesai jika** adalah syarat yang harus dibuktikan Claude sebelum menutup sesi.
- Setiap langkah diakhiri: test hijau → `docs/STATUS.md` diperbarui → commit → PR/merge ke `main`. Server men-deploy `main` otomatis.
- Jangan lanjut ke langkah berikutnya jika langkah sebelumnya belum ter-merge.
- **Tempat:**
  - **Cloud** = sesi cloud Claude Code (lihat [CLOUD.md](CLOUD.md)), bisa juga dijalankan di laptop.
  - **Server** = laptop dengan akses SSH, atau clone dev di server. Rinciannya di `DEPLOYMENT.local.md`. Langkah ini butuh aaPanel atau produksi, jadi tidak bisa di cloud.
- **Model:** saran awal. Pilih dengan `/model` dan `/effort`.

| # | Langkah | Tempat | Model (saran) |
|---|---|---|---|
| R | Review & redesign dokumen | Cloud | Fable 5.1 · high |
| 0 | Fondasi repo & hook cloud | Cloud | Opus 5.5 · xhigh |
| 1 | Server dasar & database | Cloud | Opus 5.5 · xhigh |
| 2 | Autentikasi & kerangka UI | Cloud | Opus 5.5 · xhigh |
| 3 | Aktifkan aplikasi di produksi | **Server** | Opus 5.5 · high |
| 4 | Koneksi WhatsApp | Cloud | Opus 5.5 · xhigh |
| 5 | Webhook masuk & worker | Cloud | Opus 5.5 · max |
| 6 | Inbox real-time | Cloud | Opus 5.5 · xhigh |
| 7 | Membalas | Cloud | Opus 5.5 · max |
| 8 | Template & chat baru | Cloud → Server (cron) | Opus 5.5 · xhigh |
| 9 | API v1 & webhook keluar | Cloud | Opus 5.5 · max |
| 10 | Pengamanan & operasi | Cloud → Server (cron) | Opus 5.5 · xhigh |
| 11 | Go-live dengan Meta | **Server** + browser | Opus 5.5 · high |

Langkah "Cek produksi" di beberapa prompt dilakukan oleh Anda atau sesi Server setelah PR ter-merge dan auto-deploy selesai.

---

## Prompt R — Review & redesign dokumen (opsional, sebelum Prompt 0)

```
Bertindaklah sebagai arsitek produk dan teknis. Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md,
docs/SPEC.md, docs/PROMPTS.md, dan docs/CLOUD.md.

Tinjau dan perbaiki rancangan ini sebelum pembangunan dimulai:
1. Cari celah: kebutuhan fase 1 yang kurang atau berlebih, risiko teknis, pertentangan antar dokumen,
   dan asumsi tentang WhatsApp Cloud API yang harus dicek ke dokumentasi resmi terbaru
   (developers.facebook.com): endpoint, field webhook, kode error, batas media, harga.
2. Perbaiki PRD/SPEC langsung di file yang ada. Pertahankan keputusan di "Log keputusan" STATUS.md
   kecuali ada alasan kuat; jika mengubah, catat alasannya di log.
3. Rapikan PROMPTS.md bila perlu: setiap prompt bisa dijalankan sesi baru tanpa konteks lain,
   punya kolom Tempat dan Model, dan syarat "Selesai jika" yang bisa dibuktikan.
4. Jangan menulis kode aplikasi. Repo ini publik: jangan memasukkan rahasia atau detail infrastruktur.
5. Ringkas perubahan di STATUS.md, commit, push, dan buat PR yang menjelaskan setiap perubahan + alasannya.

Selesai jika: PR terbuka, dokumen konsisten satu sama lain, dan setiap asumsi Meta yang dicek
diberi sumber.
```

## Prompt 0 — Fondasi repo & hook cloud

```
Baca CLAUDE.md, docs/STATUS.md, docs/SPEC.md §2–§4 dan §12, docs/CLOUD.md.

Siapkan fondasi repo sesuai SPEC §3:
- npm workspaces: server, web, shared. TypeScript strict + ESM, tsconfig dasar bersama, ESLint + Prettier,
  script root: dev, build, test, lint, typecheck. Commit package-lock.json.
- Kontrak auto-deploy (SPEC §12.3): script root `build` membangun shared, server (tsup → server/dist/index.js
  dan server/dist/cli.js), dan web (vite → web/dist).
- server: Fastify 5 minimal dengan GET /healthz → {ok, version, time}. version = git SHA saat build
  (sisipkan lewat define tsup).
- web: Vite + React 19 + Tailwind 4 + shadcn/ui (init), halaman kosong "WA Inbox".
  Proxy dev /api dan /webhooks ke http://127.0.0.1:3210.
- shared: paket berisi zod, ekspor contoh skema.
- .env.example sesuai SPEC §4 (tanpa nilai rahasia).
- Vitest di server dan web dengan satu test contoh.
- .claude/settings.json: hook SessionStart yang HANYA saat CLAUDE_CODE_REMOTE=true
  (1) menambahkan /opt/node24/bin ke PATH lewat CLAUDE_ENV_FILE,
  (2) menjalankan container mariadb:10.11 bernama wainbox-test (jika belum jalan),
  (3) mengekspor DATABASE_URL_TEST. Di laptop hook ini tidak melakukan apa-apa.

Jangan ubah deploy/aapanel/* dan deploy/placeholder/* kecuali memang perlu.
Selesai jika: npm ci, npm run build, test, lint, dan typecheck hijau; di sesi cloud `node -v` menunjukkan v24
dan container MariaDB berjalan. STATUS.md diperbarui, PR dibuat.
Cek produksi: setelah merge, log deploy server menunjukkan build sukses (placeholder masih yang berjalan).
```

## Prompt 1 — Server dasar & database

```
Baca CLAUDE.md, docs/STATUS.md, docs/SPEC.md §4, §5, §11, §13.

1. server/src/config.ts: validasi env dengan zod (gagal start jika env wajib kosong).
2. Skema Drizzle lengkap untuk SEMUA tabel SPEC §5 + migrasi awal (drizzle-kit generate).
   Migrasi dijalankan oleh `cli.js db:migrate` memakai migrator drizzle-orm (bukan drizzle-kit).
   Tambahkan script root `db:migrate` = `node --env-file=.env server/dist/cli.js db:migrate`
   (kontrak auto-deploy SPEC §12.3). Migrasi harus additive agar rollback kode aman.
3. lib/crypto.ts: AES-256-GCM format v1:<iv>:<tag>:<ct> dengan APP_KEY + unit test.
4. CLI: db:migrate, user:create (--name --email --admin; password lewat prompt interaktif
   atau --password-stdin, tidak pernah lewat argumen).
5. Logger pino dengan redact sesuai SPEC §11.
6. Helper test integrasi: skema dibuat ulang per run di DATABASE_URL_TEST.

Selesai jika: migrasi berjalan bersih di DATABASE_URL_TEST, user admin bisa dibuat lewat CLI di lokal,
semua test hijau. STATUS.md diperbarui, PR dibuat.
Cek produksi: setelah merge, log deploy menunjukkan db:migrate sukses di database wainbox.
```

## Prompt 2 — Autentikasi & kerangka UI

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §5.1, docs/SPEC.md §7, §10, §11.

Server:
- Sesi berbasis tabel sessions (cookie wai_sess httpOnly/Secure/SameSite=Lax, sliding 12 jam, simpan sha256 token).
- POST /api/auth/login|logout, GET /api/auth/me, PATCH /api/auth/password.
- Rate limit login 5/menit per IP + per email; pesan error generik.
- Cek Origin = APP_URL untuk request non-GET; @fastify/helmet; trustProxy.
- CRUD petugas untuk admin (GET/POST/PATCH /api/users); menonaktifkan user menghapus semua sesinya.
- Audit log untuk login dan perubahan user.
- Server melayani web/dist sebagai SPA (fallback index.html untuk route non-API).

Web:
- Halaman /login, guard route, layout utama: sidebar ikon (Chat, Pengaturan), header dengan
  slot ConnectionBanner, mode gelap/terang, bahasa Indonesia.
- /settings/users (admin) dan /settings/profile (ganti password).
- lib/api.ts (fetch wrapper + error), TanStack Query provider.

Selesai jika: test integrasi (fastify.inject) untuk login, logout, akses ditolak, dan rate limit hijau;
alur login berjalan di dev server. STATUS.md diperbarui, PR dibuat.
```

## Prompt 3 — Aktifkan aplikasi di produksi (Server)

```
Baca CLAUDE.md, docs/STATUS.md, docs/SPEC.md §12, dan DEPLOYMENT.local.md.
Kerjakan dari clone dev di server atau dari laptop dengan akses SSH. Folder produksi tidak boleh diedit.

1. Pastikan main sudah berisi Prompt 0–2 dan log deploy terakhir sukses.
2. Tambahkan ke repo: deploy/aapanel/cli.sh dan deploy/aapanel/watchdog.sh sesuai SPEC §12.4, lalu push ke main.
3. Ubah perintah jalan Node project aaPanel `wa_kppbwi_app` menjadi
   `node --env-file=.env server/dist/index.js` (btpython → nodejsModel.main().modify_project, isi semua
   field yang dibutuhkan fungsi itu), lalu restart lewat deploy/aapanel/restart.sh. Placeholder tidak lagi dipakai.
4. Buat admin produksi: `bash deploy/aapanel/cli.sh user:create --admin`. Saya yang mengetik password
   di terminal; jangan buat, tampilkan, atau simpan password.
5. Daftarkan cron LEWAT aaPanel: "WA Inbox – Watchdog" (tiap 5 menit) dan "Backup DB wainbox"
   (Backup Database bawaan, harian 01:00, simpan 7).
6. Opsional: buat database wainbox_dev lewat aaPanel untuk pengembangan dari laptop/clone dev
   (kredensial hanya di .env lokal masing-masing).

Selesai jika: https://wa.kppbwi.app menampilkan halaman login aplikasi; /healthz memuat SHA main;
kedua cron terlihat di aaPanel dan sudah sukses dijalankan sekali; sebuah commit kecil ke main ter-deploy
otomatis ≤ 2 menit. STATUS.md diperbarui.
```

## Prompt 4 — Koneksi WhatsApp

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §5.2, docs/SPEC.md §6.1, §6.6, §10 (/settings/whatsapp), §14.

Server:
- meta/graph-client.ts (timeout, retry hanya untuk GET 5xx/jaringan, TIDAK untuk kirim pesan),
  meta/errors.ts (peta error SPEC §6.6, cek ulang ke dokumentasi Meta).
- Modul connection: PUT /api/connection (validasi ke Meta: WABA + daftar nomor, simpan terenkripsi,
  buat verify_token), GET /api/connection, GET /api/connection/phone-numbers, POST /api/connection/check
  (subscribe app ke WABA + cek status nomor + last_webhook_at), POST /api/connection/register {pin}.
- Error 190 → wa_accounts.status=error.

Web:
- Wizard /settings/whatsapp 4 langkah (kredensial → pilih nomor → callback URL + verify token + panduan
  langkah di Meta sesuai SPEC §14 → cek koneksi), tombol salin, token hanya tampil 4 karakter terakhir.
- ConnectionBanner di header (hijau/kuning/merah).

Test: graph client di-mock (respons sukses, token tidak valid, WABA salah).
Selesai jika: test hijau, wizard berfungsi di dev dengan mock. STATUS.md diperbarui, PR dibuat.
```

## Prompt 5 — Webhook masuk & worker

```
Baca CLAUDE.md, docs/STATUS.md, docs/SPEC.md §5, §6.2, §6.3.

- GET/POST /webhooks/meta: verifikasi hub.challenge, raw body + X-Hub-Signature-256 (timingSafeEqual),
  simpan ke webhook_events lalu balas 200 segera.
- Worker in-process: klaim batch dengan SELECT … FOR UPDATE SKIP LOCKED + lease, backoff retry,
  status failed setelah 8 percobaan.
- Processor sesuai tabel SPEC §6.2: kontak, percakapan (unread, csw_expires_at), pesan masuk semua tipe,
  status monoton, pricing, reaksi, status template, account/quality update. Idempoten berdasarkan wamid.
- Unduh media segera ke STORAGE_DIR (SPEC §6.3), GET /api/media/:id dengan sesi.
- Event internal (EventEmitter) message.created/updated dan conversation.updated untuk dipakai SSE nanti.
- Halaman admin kecil: daftar webhook_events gagal + tombol replay.
- Fixture JSON berbentuk payload resmi Meta untuk tiap tipe di server/test/fixtures/meta
  + scripts/simulate-webhook.ts (menandatangani dengan app secret dari argumen).

Selesai jika: test parser dan idempotensi hijau (fixture yang sama dikirim 2× → 1 pesan);
simulate-webhook ke dev server menghasilkan data yang benar. STATUS.md diperbarui, PR dibuat.
```

## Prompt 6 — Inbox real-time

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §5.3–§5.4, docs/SPEC.md §7, §8, §10.

Server: GET /api/conversations (filter all|unread|open, q, cursor), GET /api/conversations/:id,
GET /api/conversations/:id/messages (before, limit), POST /api/conversations/:id/read
(kirim read receipt ke Meta jika SEND_READ_RECEIPTS), PATCH /api/contacts/:id, GET /api/events (SSE,
heartbeat 20 dtk, header anti-buffer).

Web: layout 2 panel ala WhatsApp Web di /chats; ConversationList (virtuoso, search, filter, badge,
indikator sisa jendela 24 jam); MessageTimeline (virtuoso terbalik, pemisah tanggal, MessageBubble per
tipe pesan SPEC §6.2 termasuk format *tebal* _miring_ ~coret~ ```mono```, kutipan, reaksi, StatusTicks);
panel info kontak; lib/sse.ts memperbarui cache TanStack Query + reconnect + invalidate;
notifikasi browser + suara + jumlah belum dibaca di judul tab. Responsif (HP: satu panel).

Selesai jika: dengan simulate-webhook, pesan baru muncul di inbox dev tanpa refresh. STATUS.md diperbarui, PR dibuat.
Cek produksi: `curl -N` ke https://wa.kppbwi.app/api/events (dengan cookie login) mengalirkan ping
tiap 20 detik, membuktikan SSE tidak tertahan buffer Apache.
```

## Prompt 7 — Membalas

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §5.5, docs/SPEC.md §6.3, §6.4, §6.6.

Server: POST /api/conversations/:id/messages untuk text (≤4096), reply (context), media (upload dulu via
POST /api/media → upload ke Meta), reaction; alur pending → accepted/failed + client_ref; tolak
window_closed sebelum memanggil Meta; POST /api/messages/:id/retry; audit log tiap kirim.

Web: Composer (auto-grow, Enter kirim, Shift+Enter baris baru, lampiran dengan validasi tipe/ukuran,
reply bar, terkunci + tombol "Kirim template" saat jendela tertutup), optimistic UI dengan client_ref,
error Meta dalam bahasa Indonesia + tombol coba lagi, peringatan pola NIK/NPWP 16 digit atau nomor
rekening (PRD SEND-6), emoji picker jika waktu cukup.

Selesai jika: test kirim (Graph di-mock: sukses, 131047, 190) hijau. STATUS.md diperbarui, PR dibuat.
Cek produksi (setelah Prompt 11 terhubung ke Meta): balasan teks dan gambar ke nomor uji terkirim dan
status berubah ✓ → ✓✓ → biru.
```

## Prompt 8 — Template & chat baru

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §5.6, docs/SPEC.md §6.5.

Server: sinkron template (paging, upsert, tandai DELETED), POST /api/templates/sync, GET /api/templates,
CLI `templates:sync`, kirim template (body params, header media, tombol URL dinamis),
POST /api/conversations/start {wa_id, template}. Normalisasi nomor Indonesia (08… / +62… → 62…).

Web: TemplatePicker (cari, kategori dengan penanda biaya Marketing vs Utility, isi variabel, preview
mirip bubble WhatsApp), tombol "Chat baru" (input nomor + template).

Selesai jika: test pembentukan komponen hijau. STATUS.md diperbarui, PR dibuat.
Bagian Server (setelah merge): daftarkan cron "WA Inbox – Sinkron template" (tiap 30 menit) LEWAT aaPanel
dengan perintah `bash /www/wwwroot/wa.kppbwi.app/deploy/aapanel/cli.sh templates:sync`, jalankan sekali,
pastikan log-nya sukses.
```

## Prompt 9 — API v1 & webhook keluar

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §5.7, docs/SPEC.md §9.

- API key: format wai_<40 base62>, simpan sha256 + prefix, scope, cabut; UI /settings/api tab API key
  (key hanya tampil sekali).
- Endpoint /api/v1 sesuai SPEC §9.2 dengan rate limit per key, Idempotency-Key (24 jam, 409 bila body beda),
  format respons {data}/{error}. Pesan dari API tercatat sent_by_api_key_id dan tampil "API: <nama>" di inbox.
- OpenAPI dari skema zod; Swagger UI di /api/docs khusus admin login.
- Webhook keluar: CRUD langganan, event message.received/message.sent/message.status, signature
  X-WaInbox-Signature (SPEC §9.3), dispatcher dengan retry dan nonaktif otomatis, UI daftar delivery + kirim ulang.
- docs/API.md: contoh curl + verifikasi signature di PHP dan Node.

Selesai jika: test API key, scope, rate limit, idempotensi, dan signature hijau. STATUS.md diperbarui, PR dibuat.
Cek produksi: curl POST /api/v1/messages mengirim pesan ke nomor uji, dan webhook keluar ke URL uji
(mis. webhook.site) diterima dengan signature valid.
```

## Prompt 10 — Pengamanan & operasi

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §6, docs/SPEC.md §11–§13.

- Tinjau keamanan: CSP, header, redact log, Origin check, akses media, otorisasi admin vs petugas di
  setiap route. Buat test yang memastikan petugas tidak bisa mengakses route admin dan API key tidak bisa
  mengakses route sesi.
- Halaman publik /privacy (bahasa Indonesia: data yang dikumpulkan lewat WhatsApp, tujuan layanan
  perpajakan, penyimpanan di server kantor, retensi, kontak). Ini draf; tandai bagian yang perlu disetujui kantor.
- CLI `housekeeping` sesuai SPEC §12.4.
- Jalankan /code-review pada seluruh kode dan perbaiki temuannya.

Selesai jika: semua test hijau. STATUS.md diperbarui, PR dibuat.
Bagian Server (setelah merge): daftarkan cron "WA Inbox – Housekeeping" LEWAT aaPanel, jalankan sekali,
cek sisa disk dan ukuran storage, lalu catat di STATUS.md.
```

## Prompt 11 — Go-live dengan Meta (Server + browser)

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §9, docs/SPEC.md §14, dan DEPLOYMENT.local.md.

Pandu saya menjalankan checklist SPEC §14 langkah demi langkah. Saya yang mengklik di Meta; buka browser
pane bila perlu dan tunggu saya login sendiri. Setelah webhook terverifikasi:
1. Kirim pesan dari HP uji → pastikan masuk di WA Inbox dan di Kirimdev (jalan paralel).
2. Balas dari WA Inbox → pastikan diterima di HP; catat apakah balasan ini muncul di Kirimdev.
3. Uji pesan gambar, dokumen, voice note, reaksi, dan template.
4. Tulis laporan uji di docs/GO-LIVE.md (hasil tiap skenario, kendala, keputusan kapan Kirimdev dilepas).
JANGAN mencabut akses Kirimdev atau menekan disconnect apa pun tanpa persetujuan saya.
```

---

## Setelah fase 1

Prompt pembuka fase 2 (tim & layanan). Tempat: Cloud, model: Fable 5.1 · high.

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §3 dan §10. Susun kebutuhan fase 2 (penugasan chat,
status percakapan, label, balasan cepat, balasan otomatis di luar jam layanan & hari libur,
ringkasan biaya bulanan) sebagai docs/PRD-fase2.md, perbarui docs/SPEC.md, lalu tambahkan
prompt lanjutan di docs/PROMPTS.md dengan kolom Tempat dan Model. Buat PR.
```
