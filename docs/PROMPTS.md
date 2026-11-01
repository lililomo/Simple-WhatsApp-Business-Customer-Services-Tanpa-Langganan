# Alur Prompt Pembangunan — WA Inbox

Urutan prompt untuk membangun aplikasi bersama Claude Code di laptop, di folder proyek ini. Deploy langsung ke server lewat SSH.

## Cara memakai

- Jalankan **satu prompt per sesi**. Mulai sesi baru (atau `/clear`) sebelum prompt berikutnya. Konteks proyek dibaca otomatis dari `CLAUDE.md`, `docs/STATUS.md`, `docs/PRD.md`, dan `docs/SPEC.md`.
- Salin blok prompt apa adanya. Bagian **Selesai jika** adalah syarat yang harus dibuktikan Claude sebelum menutup sesi.
- Setiap langkah diakhiri: test hijau → `docs/STATUS.md` diperbarui → commit → push ke GitHub (cadangan). Mulai Prompt 3, ditambah deploy dengan `scripts/deploy.sh`.
- Jangan lanjut ke langkah berikutnya jika test masih merah.
- Jika ada keputusan baru yang mengubah desain, minta Claude memperbarui `docs/SPEC.md` di sesi yang sama.

| # | Langkah | Hasil |
|---|---|---|
| 0 | Fondasi repo | Workspace, tooling |
| 1 | Server dasar & database | Fastify, skema Drizzle, migrasi, CLI, DB dev |
| 2 | Autentikasi & kerangka UI | Login, sesi, kelola petugas, layout |
| 3 | Pipeline deploy & aktivasi | Aplikasi tampil di https://wa.kppbwi.app |
| 4 | Koneksi WhatsApp | Wizard WABA + token, subscribe |
| 5 | Webhook masuk & worker | Pesan masuk tersimpan |
| 6 | Inbox real-time | Daftar & ruang chat + SSE |
| 7 | Membalas | Teks, kutipan, media, tandai dibaca |
| 8 | Template | Sinkron, kirim template, chat baru |
| 9 | API v1 & webhook keluar | Integrasi sistem lain |
| 10 | Pengamanan & operasi | Audit, privasi, cron aaPanel |
| 11 | Go-live | Uji Meta asli & jalan paralel dengan Kirimdev |

---

## Prompt 0 — Fondasi repo

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md, dan docs/SPEC.md (terutama §2–§4).

Siapkan fondasi repo sesuai SPEC §3:
- npm workspaces: server, web, shared. TypeScript strict + ESM di semua workspace, tsconfig dasar bersama,
  ESLint + Prettier. Script root: dev, build, test, lint, typecheck, dan check (= lint + typecheck + test).
  Commit package-lock.json.
- server: Fastify 5 minimal dengan GET /healthz → {ok, version, time}. version = process.env.APP_VERSION
  saat build (sisipkan lewat define tsup; default "dev"). Build dengan tsup ke server/dist/index.js dan
  server/dist/cli.js.
- web: Vite + React 19 + Tailwind 4 + shadcn/ui (init), halaman kosong "WA Inbox".
  Proxy dev /api dan /webhooks ke http://127.0.0.1:3210.
- shared: paket berisi zod, ekspor contoh skema.
- .env.example sesuai SPEC §4 (tanpa nilai rahasia).
- Vitest di server dan web dengan satu test contoh.

Selesai jika: npm install, npm run build, dan npm run check hijau; npm run dev menjalankan server :3210 dan
web :5173. STATUS.md diperbarui, commit "chore: repo foundation", push.
```

## Prompt 1 — Server dasar & database

```
Baca CLAUDE.md, docs/STATUS.md, docs/SPEC.md §4, §5, §11, §12.6, dan DEPLOYMENT.local.md.

1. Buat database `wainbox_dev` di server LEWAT aaPanel (btpython → database.database().AddDatabase,
   akses 127.0.0.1, utf8mb4), sama seperti `wainbox` dibuat. Simpan kredensialnya hanya di .env lokal
   (DATABASE_URL dan DATABASE_URL_TEST); jangan tampilkan di chat. Akses lewat tunnel SSH (SPEC §12.6).
2. server/src/config.ts: validasi env dengan zod (gagal start jika env wajib kosong).
3. Skema Drizzle lengkap untuk SEMUA tabel SPEC §5 + migrasi awal (drizzle-kit generate).
   Migrasi dijalankan oleh `cli.js db:migrate` memakai migrator drizzle-orm (bukan drizzle-kit) agar bisa
   jalan di produksi. Migrasi harus additive.
4. lib/crypto.ts: AES-256-GCM format v1:<iv>:<tag>:<ct> dengan APP_KEY + unit test.
5. CLI: db:migrate, user:create (--name --email --admin; password lewat prompt interaktif atau
   --password-stdin, tidak pernah lewat argumen).
6. Logger pino dengan redact sesuai SPEC §11.
7. Helper test integrasi: skema dibuat ulang per run di DATABASE_URL_TEST.

Selesai jika: migrasi berjalan bersih di wainbox_dev, user admin bisa dibuat lewat CLI di lokal,
npm run check hijau. STATUS.md diperbarui, commit, push.
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
alur login berjalan di browser lokal (cek dengan browser pane). STATUS.md diperbarui, commit, push.
```

## Prompt 3 — Pipeline deploy & aktivasi

```
Baca CLAUDE.md, docs/STATUS.md, docs/SPEC.md §12, dan DEPLOYMENT.local.md.

1. Buat scripts/deploy.sh, deploy/deploy.local.env.example, deploy/deploy.local.env (tidak di-commit),
   deploy/server/activate.sh, dan deploy/server/bin/{cli.sh,watchdog.sh} persis sesuai SPEC §12.2–§12.4.
   deploy/server/bin/restart.sh sudah ada dan teruji, pakai apa adanya. Ikuti "Aturan penulisan skrip"
   di SPEC §12.3: setiap langkah dicek eksplisit, versi /healthz dicocokkan dengan SHA, fd kunci ditutup
   saat restart, output build tidak masuk log utama.
2. Uji activate.sh di SANDBOX di server (folder /tmp, project aaPanel tiruan atau restart di-stub) untuk:
   deploy pertama dari placeholder, build gagal, versi healthz salah, dan rollback manual.
   Produksi tidak boleh tersentuh selama uji.
3. Deploy pertama ke produksi dengan scripts/deploy.sh. Pastikan perintah jalan aaPanel berubah otomatis
   menjadi `node --env-file=.env app/server/dist/index.js` dan placeholder tidak lagi dipakai.
4. Buat admin produksi: `bash /www/wwwroot/wa.kppbwi.app/bin/cli.sh user:create --admin` di server.
   Saya yang mengetik password di terminal; jangan buat, tampilkan, atau simpan password.
5. Daftarkan cron LEWAT aaPanel: "WA Inbox – Watchdog" (tiap 5 menit) dan "Backup DB wainbox"
   (Backup Database bawaan, harian 01:00, simpan 7).

Selesai jika: https://wa.kppbwi.app menampilkan halaman login; /healthz memuat SHA commit;
kedua cron terlihat di aaPanel dan sudah sukses dijalankan sekali; deploy kedua (tanpa perubahan)
sukses dan release lama dibersihkan; `scripts/deploy.sh --rollback` teruji. STATUS.md diperbarui, commit, push.
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
Selesai jika: test hijau, wizard berfungsi di lokal dengan mock, deploy ke produksi.
STATUS.md diperbarui, commit, push.
```

## Prompt 5 — Webhook masuk & worker

```
Baca CLAUDE.md, docs/STATUS.md, docs/SPEC.md §5, §6.2, §6.3.

- GET/POST /webhooks/meta: verifikasi hub.challenge; POST dengan batas body 3 MB, raw body +
  X-Hub-Signature-256 (timingSafeEqual); signature tidak valid → 401 tanpa menyimpan payload, rate limit
  per IP; signature valid → simpan ke webhook_events lalu balas 200 segera.
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
simulate-webhook ke server lokal menghasilkan data yang benar; deploy ke produksi.
STATUS.md diperbarui, commit, push.
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

Selesai jika: dengan simulate-webhook, pesan baru muncul di inbox lokal tanpa refresh; setelah deploy,
`curl -N` ke https://wa.kppbwi.app/api/events (dengan cookie login) mengalirkan ping tiap 20 detik,
membuktikan SSE tidak tertahan buffer Apache. STATUS.md diperbarui, commit, push.
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

Selesai jika: test kirim (Graph di-mock: sukses, 131047, 190) hijau; deploy ke produksi. Setelah
Prompt 11 terhubung ke Meta: balasan teks dan gambar ke nomor uji terkirim dan status berubah
✓ → ✓✓ → biru. STATUS.md diperbarui, commit, push.
```

## Prompt 8 — Template & chat baru

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §5.6, docs/SPEC.md §6.5.

Server: sinkron template (paging, upsert, tandai DELETED), POST /api/templates/sync, GET /api/templates,
CLI `templates:sync`, kirim template (body params, header media, tombol URL dinamis),
POST /api/conversations/start {wa_id, template}. Normalisasi nomor Indonesia (08… / +62… → 62…).

Web: TemplatePicker (cari, kategori dengan penanda biaya Marketing vs Utility, isi variabel, preview
mirip bubble WhatsApp), tombol "Chat baru" (input nomor + template).

Setelah deploy, daftarkan cron "WA Inbox – Sinkron template" (tiap 30 menit) LEWAT aaPanel.
Selesai jika: test pembentukan komponen hijau; cron terlihat di aaPanel dan log-nya sukses.
STATUS.md diperbarui, commit, push.
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

Selesai jika: test API key, scope, rate limit, idempotensi, dan signature hijau; deploy; di produksi
curl POST /api/v1/messages mengirim pesan ke nomor uji dan webhook keluar ke URL uji (mis. webhook.site)
diterima dengan signature valid. STATUS.md diperbarui, commit, push.
```

## Prompt 10 — Pengamanan & operasi

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §6, docs/SPEC.md §11–§13.

- Tinjau keamanan: CSP, header, redact log, Origin check, akses media, otorisasi admin vs petugas di
  setiap route. Buat test yang memastikan petugas tidak bisa mengakses route admin dan API key tidak bisa
  mengakses route sesi.
- Halaman publik /privacy (bahasa Indonesia: data yang dikumpulkan lewat WhatsApp, tujuan layanan
  perpajakan, penyimpanan di server kantor, retensi, kontak). Ini draf; tandai bagian yang perlu disetujui kantor.
- CLI `housekeeping` sesuai SPEC §12.4 + daftarkan cron "WA Inbox – Housekeeping" LEWAT aaPanel.
- Cek sisa disk server dan ukuran storage; catat di STATUS.md.
- Jalankan /code-review pada seluruh kode dan perbaiki temuannya.

Selesai jika: semua test hijau, semua cron di SPEC §12.4 terlihat di aaPanel dan sukses dijalankan sekali,
deploy berhasil. STATUS.md diperbarui, commit, push.
```

## Prompt 11 — Go-live dengan Meta

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

Prompt pembuka fase 2 (tim & layanan):

```
Baca CLAUDE.md, docs/STATUS.md, docs/PRD.md §3 dan §10. Susun kebutuhan fase 2 (penugasan chat,
status percakapan, label, balasan cepat, balasan otomatis di luar jam layanan & hari libur,
ringkasan biaya bulanan) sebagai docs/PRD-fase2.md, perbarui docs/SPEC.md, lalu tambahkan
prompt lanjutan di docs/PROMPTS.md.
```
