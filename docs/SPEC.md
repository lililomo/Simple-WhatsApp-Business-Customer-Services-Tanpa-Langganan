# SPEC — WA Inbox KPP Pratama Banyuwangi

Desain teknis untuk [PRD.md](PRD.md). Bagian yang ditandai **[server: sudah]** sudah disiapkan pada 1 November 2026.

## 1. Arsitektur

```
 Wajib pajak (WhatsApp)
        │
        ▼
 Meta WhatsApp Cloud API ──── webhook POST (signed) ───┐
        ▲                                               │
        │ Graph API (send, media, templates)            ▼
        │                          ┌──────────── server kantor (aaPanel) ─────────┐
        │                          │ Apache :443  wa.kppbwi.app  (SSL Let's Enc.) │
        │                          │      │ reverse proxy                         │
        │                          │      ▼                                       │
        └──────────────────────────┤ Node 24 · Fastify  127.0.0.1:3210           │
                                   │  ├─ /webhooks/meta   → webhook_events (DB)   │
 Browser petugas ◄── SSE ──────────┤  ├─ worker in-process (parse, media, kirim   │
   (React SPA)  ── REST /api ─────►│  │    webhook keluar)                        │
                                   │  ├─ /api/*  (sesi cookie, UI)                │
 Sistem lain ── REST /api/v1 ─────►│  ├─ /api/v1/* (API key)                      │
             ◄── webhook keluar ───┤  └─ static SPA (web/dist)                    │
                                   │ MariaDB 10.11 `wainbox` · storage/media      │
                                   │ Cron aaPanel: sync template, housekeeping,   │
                                   │ watchdog, backup DB                          │
                                   └──────────────────────────────────────────────┘
```

Prinsip:

- **Satu proses Node.** API, SSE, worker, dan file SPA dilayani satu proses. Volume kantor tidak butuh lebih. Jika kelak perlu lebih dari satu proses, pub/sub dipindah ke Redis (sudah ada di server, `127.0.0.1:6379`).
- **Webhook tahan gagal.** Payload disimpan ke tabel `webhook_events` lalu langsung dibalas 200. Pemrosesan berjalan asinkron dengan lease, retry, dan idempotensi berdasarkan `wamid`.
- **Real-time lewat SSE, bukan WebSocket.** Vhost Apache buatan aaPanel untuk Node project tidak memuat aturan upgrade WebSocket. Aturan manual akan tertimpa setiap kali aaPanel membuat ulang konfigurasi, sedangkan SSE berjalan lewat proxy bawaan tanpa ubahan.

## 2. Stack

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Runtime | Node.js **v24.14.0** (sudah terpasang lewat Node version manager aaPanel) | Satu bahasa (TypeScript) untuk server dan web; I/O-bound cocok untuk webhook + SSE |
| Bahasa | TypeScript (strict), ESM | — |
| Server | **Fastify 5** + `fastify-type-provider-zod` | Cepat, validasi skema, plugin resmi lengkap (cookie, static, multipart, rate-limit, helmet, swagger) |
| Validasi | **Zod** (dipakai bersama server & web lewat `shared/`) | — |
| Database | **MariaDB 10.11** (aaPanel) via **Drizzle ORM** + `mysql2`; migrasi `drizzle-kit` | MariaDB sudah berjalan dan di-backup aaPanel; Drizzle ringan, tanpa engine biner. MongoDB tidak dipakai (data chat relasional) |
| Hash password | `@node-rs/argon2` (argon2id) | Biner prebuilt, tanpa kompilasi |
| Web | **React 19** + **Vite** + **Tailwind CSS 4** + komponen **shadcn/ui** + `lucide-react` | — |
| Data fetching | **TanStack Query 5**; router **React Router 7** (mode SPA) | — |
| Daftar panjang | `react-virtuoso` | Virtualisasi daftar chat dan pesan |
| Tanggal | `date-fns` + locale `id` | Tampilan Asia/Jakarta, simpan UTC |
| Test | **Vitest** (server + web), fixture payload Meta | — |
| Build server | `tsup` → `server/dist/index.js`, `server/dist/cli.js` | — |

Gunakan versi stabil terbaru dari setiap paket saat implementasi, dan kunci versinya lewat `package-lock.json`.

## 3. Struktur repo

```
/                       npm workspaces: server, web, shared
├── CLAUDE.md
├── docs/               PRD.md, SPEC.md, PROMPTS.md
├── shared/src/         skema zod & tipe DTO (API internal + API v1 + event SSE)
├── server/
│   ├── src/
│   │   ├── index.ts            bootstrap Fastify + worker
│   │   ├── cli.ts              db:migrate, user:create, templates:sync, housekeeping
│   │   ├── config.ts           baca & validasi env (zod)
│   │   ├── db/                 schema.ts, client.ts, migrations/
│   │   ├── lib/                crypto (AES-GCM), ids, errors, logger
│   │   ├── meta/               graph-client.ts, errors.ts (peta kode error), types.ts
│   │   ├── modules/
│   │   │   ├── auth/           sesi, login, users
│   │   │   ├── connection/     pengaturan WABA/nomor, validasi, subscribe, register
│   │   │   ├── webhook-in/     GET verify, POST receive, signature
│   │   │   ├── processor/      worker webhook_events → contacts/conversations/messages
│   │   │   ├── conversations/  daftar, detail, tandai dibaca
│   │   │   ├── messages/       kirim teks/media/template/reaksi, status
│   │   │   ├── media/          upload ke Meta, unduh dari Meta, layani file
│   │   │   ├── templates/      sinkron & daftar
│   │   │   ├── realtime/       hub SSE
│   │   │   ├── api-v1/         API publik + API key + OpenAPI
│   │   │   ├── webhook-out/    langganan & pengiriman webhook keluar
│   │   │   └── audit/
│   │   └── public/             privacy.html
│   └── test/                   unit + fixtures/meta/*.json
├── web/src/                    app/, pages/, components/, lib/api.ts, lib/sse.ts
├── scripts/
│   ├── deploy.sh               deploy dari laptop ke server lewat SSH (Git Bash)
│   └── simulate-webhook.ts     kirim payload fixture bertanda tangan ke server lokal
└── deploy/
    ├── deploy.local.env.example  contoh host & folder tujuan (salinan aslinya tidak di-commit)
    └── server/                 activate.sh, bin/cli.sh, bin/restart.sh, bin/watchdog.sh
```

## 4. Konfigurasi (`.env`)

**[server: sudah]** File `/www/wwwroot/wa.kppbwi.app/.env` (owner `www`, mode 600) sudah berisi:
`NODE_ENV, PORT=3210, APP_URL, DATABASE_URL, APP_KEY, SESSION_SECRET, STORAGE_DIR, GRAPH_API_VERSION=v26.0, TZ=Asia/Jakarta`.
Variabel tambahan (opsional, dengan default):

| Variabel | Default | Keterangan |
|---|---|---|
| `MEDIA_RETENTION_DAYS` | 365 | Media lebih tua dihapus oleh housekeeping (0 = tidak pernah) |
| `MAX_UPLOAD_MB` | 100 | Batas upload lampiran |
| `API_RATE_LIMIT_PER_MIN` | 60 | Per API key |
| `SEND_READ_RECEIPTS` | true | Kirim centang biru saat chat dibuka |
| `LOG_LEVEL` | info | — |

Kredensial Meta **tidak** disimpan di `.env`. Kredensial dimasukkan admin lewat UI dan disimpan terenkripsi di tabel `wa_accounts` dengan kunci `APP_KEY`.

Contoh untuk pengembangan lokal ada di `.env.example` (tanpa nilai rahasia).

## 5. Model data (MariaDB, utf8mb4)

Semua waktu disimpan `DATETIME(3)` dalam UTC. ID memakai `BIGINT UNSIGNED AUTO_INCREMENT`, dan diekspos sebagai string di API.

```
users            id, name, email UQ, password_hash, role ENUM(admin,agent), is_active,
                 last_login_at, created_at, updated_at
sessions         id, user_id FK, token_hash CHAR(64) UQ, expires_at, ip, user_agent, created_at

wa_accounts      id, label, app_id, app_secret_enc, waba_id, phone_number_id UQ,
                 display_phone_number, verified_name, quality_rating, access_token_enc,
                 token_last4, verify_token, status ENUM(active,error,disabled),
                 last_error, last_webhook_at, subscribed_at, created_at, updated_at

contacts         id, wa_id UQ (nomor format internasional tanpa +), profile_name,
                 display_name, raw JSON, first_seen_at, created_at, updated_at
conversations    id, wa_account_id FK, contact_id FK, UQ(wa_account_id, contact_id),
                 last_message_id, last_message_at, last_message_preview VARCHAR(200),
                 last_inbound_at, csw_expires_at, unread_count, created_at, updated_at
                 IDX(wa_account_id, last_message_at DESC)
messages         id, conversation_id FK, wamid VARCHAR(128) UQ NULL, direction ENUM(in,out),
                 type VARCHAR(32), status ENUM(pending,accepted,sent,delivered,read,failed,received),
                 text MEDIUMTEXT, payload JSON, media_id FK NULL, reply_to_wamid,
                 reaction_emoji (reaksi terakhir dari kontak untuk pesan ini),
                 template_name, template_language, sent_by_user_id FK NULL,
                 sent_by_api_key_id FK NULL, client_ref VARCHAR(64) NULL,
                 error_code, error_title, error_detail,
                 pricing_category, pricing_billable, wa_timestamp,
                 sent_at, delivered_at, read_at, failed_at, created_at
                 IDX(conversation_id, id), FULLTEXT(text)
media            id, wa_media_id, direction, mime_type, file_name, file_size, sha256,
                 storage_path, status ENUM(pending,ready,failed,expired), error, created_at

templates        id, wa_account_id FK, meta_template_id, name, language, category, status,
                 components JSON, quality_score, rejected_reason, synced_at,
                 UQ(wa_account_id, name, language)

webhook_events   id, received_at, payload LONGTEXT (hanya signature valid), status
                 ENUM(pending,processing,done,failed), attempts, lease_until,
                 next_attempt_at, error TEXT, processed_at   IDX(status, next_attempt_at)

api_keys         id, name, prefix CHAR(12), key_hash CHAR(64) UQ, scopes JSON,
                 created_by FK, last_used_at, revoked_at, created_at
idempotency_keys id, api_key_id, idem_key, request_hash, response JSON, created_at,
                 UQ(api_key_id, idem_key)
outbound_webhooks          id, name, url, secret_enc, events JSON, is_active,
                           failure_count, created_at, updated_at
outbound_webhook_deliveries id, webhook_id FK, event_id CHAR(26), event_type, payload JSON,
                           status ENUM(pending,success,failed), attempts, next_attempt_at,
                           response_code, response_snippet, created_at, delivered_at

audit_logs       id, actor_user_id, actor_api_key_id, action, target_type, target_id,
                 meta JSON, ip, created_at
```

Catatan:

- `csw_expires_at` = `GREATEST(csw_expires_at, wa_timestamp_pesan_masuk + 24 jam)`. Composer terkunci bila `NOW() > csw_expires_at`.
- `messages.wamid` unik, sehingga webhook ganda tidak menimbulkan duplikasi.
- Pesan bertipe `reaction` disimpan sebagai baris pesan, tetapi disembunyikan dari linimasa. Emoji reaksi ditulis ke `reaction_emoji` milik pesan target.
- Meta sedang menyiapkan fitur username WhatsApp. Simpan `contacts.raw` apa adanya, dan cek changelog Meta saat implementasi untuk field identitas pengguna yang baru.

## 6. Integrasi Meta

Basis: `https://graph.facebook.com/${GRAPH_API_VERSION}`, header `Authorization: Bearer <system user token>`. Timeout 15 detik.

- Panggilan baca: retry otomatis (maksimal 2×) hanya untuk 5xx atau error jaringan.
- **Panggilan kirim pesan tidak pernah di-retry otomatis**, karena berisiko terkirim ganda.

### 6.1 Koneksi (modul `connection`)

| Langkah | Endpoint |
|---|---|
| Validasi WABA | `GET /{WABA_ID}?fields=id,name,currency,timezone_id` |
| Daftar nomor | `GET /{WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status` |
| Subscribe app | `POST /{WABA_ID}/subscribed_apps` → `{"success":true}`; cek dengan `GET` |
| Register nomor (jika perlu) | `POST /{PHONE_NUMBER_ID}/register` body `{messaging_product:"whatsapp", pin:"123456"}` |

`verify_token` dibuat acak oleh server (32 karakter). Callback URL: `https://wa.kppbwi.app/webhooks/meta`.

### 6.2 Webhook masuk (modul `webhook-in` + `processor`)

- `GET /webhooks/meta`:
  - jika `hub.mode=subscribe` dan `hub.verify_token` cocok dengan salah satu `wa_accounts.verify_token`, balas `hub.challenge` sebagai text/plain;
  - selain itu 403.
- `POST /webhooks/meta`:
  1. Baca **raw body** (content-type parser khusus route ini) dengan batas **3 MB**, sesuai ukuran payload maksimum dari Meta. Lebih besar → `413`.
  2. Hitung `sha256=HMAC_SHA256(app_secret, raw)` dan bandingkan dengan header `X-Hub-Signature-256` memakai `timingSafeEqual`. Coba app_secret dari setiap akun aktif.
  3. Signature tidak valid → balas `401` dan **jangan simpan payload**. Endpoint ini publik, jadi siapa pun bisa mengirim sampah yang memenuhi disk. Cukup catat satu baris log (IP, ukuran) dan naikkan penghitung. Request bersignature tidak valid juga dibatasi rate limit per IP.
  4. Signature valid → simpan ke `webhook_events`, balas `200` segera, lalu beri tahu worker.
- **Worker:** ambil batch dengan `SELECT … FOR UPDATE SKIP LOCKED` (didukung MariaDB 10.6+), set `lease_until = now+60s`, lalu proses. Jika gagal: `attempts+1`, `next_attempt_at` dengan backoff (10 dtk, 1 mnt, 5 mnt, 30 mnt, 2 jam). Setelah 8 kali gagal → `failed` (terlihat di halaman admin).
- **Pemetaan payload** `entry[].changes[]`:

| `field` | Tindakan |
|---|---|
| `messages` → `value.messages[]` | Upsert kontak (`value.contacts[].wa_id`, `profile.name`) → upsert percakapan → insert pesan masuk (abaikan jika `wamid` sudah ada) → perbarui `last_*`, `unread_count+1`, `csw_expires_at` → jika ada media, buat baris `media(pending)` dan unduh → publikasikan SSE `message.created` + `conversation.updated` → antrekan webhook keluar `message.received` |
| `messages` → `value.statuses[]` | Jika wamid belum dikenal: diulang selama 2 menit (balasan Graph bisa kalah cepat dari webhook), setelah itu diabaikan karena berarti pesan dari aplikasi lain di WABA yang sama (mis. Kirimdev). Selain itu: cari pesan berdasarkan `id` (wamid) → perbarui status secara **monoton** (urutan `accepted < sent < delivered < read`; status lebih rendah diabaikan; `failed` hanya berlaku jika status sekarang belum `delivered/read`) → simpan `errors[0]` dan `pricing.{category,billable}` → SSE `message.updated` → webhook keluar `message.status` |
| `message_template_status_update` | Perbarui `templates.status` (+ alasan) |
| `template_category_update` / `message_template_quality_update` | Perbarui kategori / kualitas |
| `account_update`, `phone_number_quality_update`, `account_alerts` | Simpan ke `wa_accounts` (quality, limit, peringatan) + tampilkan di status koneksi |
| `value.metadata.phone_number_id` tidak dikenal | Tandai `done` dan catat log warning |

- **Tipe pesan masuk** yang dirender: `text`, `image`, `video`, `audio` (voice: `audio.voice=true`), `document`, `sticker`, `location`, `contacts`, `interactive` (`button_reply`, `list_reply`, `nfm_reply`), `button` (balasan tombol template), `reaction`, `order`, `system`, `unsupported`. Pesan dengan `context.id` → kutipan.

### 6.3 Media

- **Unduh:** `GET /{MEDIA_ID}` → `url` (berlaku ±5 menit) → `GET url` dengan header Bearer yang sama → simpan ke `STORAGE_DIR/media/YYYY/MM/<sha256>.<ext>`. Lakukan segera saat webhook diproses.
- **Unggah (kirim):** `POST /{PHONE_NUMBER_ID}/media` (multipart, `messaging_product=whatsapp`, `type`, `file`) → `id`, lalu kirim pesan dengan `{image:{id, caption}}`. Salinan lokal disimpan juga.
- **Batas Meta** (validasi di UI dan server):

  | Tipe | Format | Ukuran maks |
  |---|---|---|
  | Gambar | JPEG/PNG | 5 MB |
  | Video | MP4/3GPP | 16 MB |
  | Audio | AAC/AMR/MP3/M4A/OGG-Opus | 16 MB |
  | Dokumen | — | 100 MB |
  | Stiker | WebP | 100 KB statis / 500 KB animasi |

  Konfirmasi angka ini ke dokumentasi Meta saat implementasi.
- **Penyajian:** file dilayani lewat `GET /api/media/:id` (wajib sesi) dan `GET /api/v1/media/:id` (wajib API key), bukan direktori publik.

### 6.4 Mengirim

`POST /{PHONE_NUMBER_ID}/messages`, selalu dengan `messaging_product:"whatsapp"`, `recipient_type:"individual"`, `to:<wa_id>`.

| Jenis | Body |
|---|---|
| Teks | `type:"text", text:{body, preview_url:true}` |
| Balasan | tambah `context:{message_id:<wamid>}` |
| Media | `type:"image" \| "video" \| "audio" \| "document", <type>:{id, caption?, filename?}` |
| Template | `type:"template", template:{name, language:{code}, components:[…parameters]}` |
| Reaksi (S) | `type:"reaction", reaction:{message_id, emoji}` |
| Tandai dibaca | `{messaging_product, status:"read", message_id}` (opsional `typing_indicator:{type:"text"}`) |

Alur kirim:
1. Insert `messages(status=pending, client_ref)`, lalu SSE.
2. Panggil Graph.
3. Jika sukses: simpan `wamid`, `status=accepted`.
4. Jika gagal: `status=failed` + error yang sudah dipetakan.

Status `sent/delivered/read` datang belakangan lewat webhook.

Pemeriksaan sebelum kirim teks/media: jika jendela 24 jam tertutup, tolak dengan `window_closed` tanpa memanggil Meta.

### 6.5 Template

`GET /{WABA_ID}/message_templates?fields=id,name,language,status,category,components,quality_score,rejected_reason&limit=100`, dengan paging `paging.next`. Lakukan upsert. Template yang hilang dari Meta ditandai `status=DELETED`.

Pembentukan parameter:
- variabel `{{1}}` di BODY → `components:[{type:"body", parameters:[{type:"text", text}]}]`;
- header media → parameter `image/document/video` berisi `id` atau `link`;
- tombol URL dinamis → `{type:"button", sub_type:"url", index, parameters:[…]}`.

### 6.6 Peta error Meta → pesan Indonesia (`meta/errors.ts`)

| Kode | Pesan untuk petugas |
|---|---|
| 131047 | Lebih dari 24 jam sejak pesan terakhir pelanggan. Kirim template. |
| 131026 | Pesan tidak bisa diterima nomor ini (bukan pengguna WhatsApp / aplikasinya terlalu lama). |
| 131049 | Meta menahan pesan marketing ini untuk menjaga keterlibatan pengguna. Coba lagi nanti. |
| 131056 | Terlalu banyak pesan ke nomor yang sama dalam waktu singkat. |
| 130429 | Batas kecepatan kirim tercapai. Coba lagi sebentar lagi. |
| 131042 | Masalah metode pembayaran akun WhatsApp Business. Hubungi admin. |
| 131031 | Akun WhatsApp Business dikunci Meta. Hubungi admin. |
| 368 | Akun dibatasi sementara karena pelanggaran kebijakan. |
| 190 | Token Meta tidak valid/kedaluwarsa. Admin perlu memperbarui token. |
| 132000 / 132001 | Variabel template tidak sesuai / template tidak ditemukan untuk bahasa ini. |
| 131052 / 131053 | Gagal mengunduh / mengunggah media. |
| lainnya | `error.title` + `error_data.details` dari Meta |

Verifikasi daftar ini terhadap halaman "Error codes" Meta saat implementasi. Error 190 juga mengubah `wa_accounts.status=error` dan memunculkan banner merah.

## 7. API internal untuk UI (sesi cookie)

Prefix `/api`. Semua request non-GET memeriksa header `Origin` = `APP_URL` sebagai proteksi CSRF.

```
POST   /api/auth/login            {email,password} → set cookie wai_sess
POST   /api/auth/logout
GET    /api/auth/me
PATCH  /api/auth/password
GET    /api/users                 (admin)   POST /api/users   PATCH /api/users/:id
GET    /api/connection            (admin)   PUT  /api/connection   (validasi + simpan)
GET    /api/connection/phone-numbers         POST /api/connection/check
POST   /api/connection/register   {pin}
GET    /api/conversations?filter=all|unread|open&q=&cursor=
GET    /api/conversations/:id
POST   /api/conversations/:id/read
GET    /api/conversations/:id/messages?before=<id>&limit=50
POST   /api/conversations/:id/messages        {type:text|media|template|reaction, …, client_ref}
POST   /api/messages/:id/retry
POST   /api/conversations/start   {wa_id, template}   (chat baru)
PATCH  /api/contacts/:id          {display_name}
POST   /api/media                 multipart → {media_id}
GET    /api/media/:id             (stream file)
GET    /api/templates             POST /api/templates/sync
GET    /api/events                SSE
GET/POST/DELETE /api/api-keys     (admin)
GET/POST/PATCH/DELETE /api/outbound-webhooks   GET /api/outbound-webhooks/:id/deliveries
GET    /api/admin/webhook-events?status=failed   POST /api/admin/webhook-events/:id/replay
```

## 8. Real-time (SSE)

- `GET /api/events`, autentikasi lewat cookie sesi. Header respons:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `X-Accel-Buffering: no`
- Heartbeat berupa komentar `: ping` setiap 20 detik, agar koneksi tidak diputus proxy Apache.
- Event: `message.created`, `message.updated`, `conversation.updated`, `connection.updated`. Payload berupa DTO lengkap dari `shared/`, sehingga klien bisa langsung memperbarui cache TanStack Query tanpa fetch ulang.
- Setelah reconnect, klien meng-invalidate query percakapan yang terbuka dan daftar percakapan. Pesan yang terlewat terambil dari situ, jadi `Last-Event-ID` tidak diperlukan.
- **Uji wajib setelah deploy:** `curl -N https://wa.kppbwi.app/api/events` (dengan cookie). Event harus mengalir tanpa tertahan buffer Apache/mod_deflate.

## 9. API publik v1 & webhook keluar

### 9.1 Autentikasi & format

- Header `Authorization: Bearer wai_<40 karakter base62>`. Server mencari berdasarkan `sha256(key)`. `prefix` = 12 karakter pertama, ditampilkan di UI.
- Scope: `messages:send`, `messages:read`, `conversations:read`, `templates:read`, `media:write`.
- Respons sukses `{"data": …}`; error `{"error":{"code":"window_closed","message":"…","details":{…}}}` dengan HTTP status yang sesuai.
- Rate limit per key (`@fastify/rate-limit`, key generator = api_key_id) → 429 + `Retry-After`.
- Dokumentasi OpenAPI dari skema zod (`@fastify/swagger`). Swagger UI di `/api/docs`, hanya admin yang login.

### 9.2 Endpoint

Nama field memakai camelCase, sama dengan DTO internal. Contoh lengkap ada di [API.md](API.md).

```
POST /api/v1/messages              scope messages:send   header Idempotency-Key (disarankan)
  { "to": "0812…" | "62812…" | "+62 812…",
    "type": "text" | "template" | "image" | "document" | "audio" | "video",
    "text": "…",
    "template": { "name": "…", "language": "id", "params": { "header": {…}, "body": { "1": "…" }, "buttons": {…}, "headerMediaId": "…" } },
    "media": { "mediaId": "<dari POST /api/v1/media>" | "link": "https://…", "caption": "…", "filename": "…" },
    "replyTo": "<id pesan internal atau wamid>",
    "clientRef": "ID-sistem-pemanggil (dikembalikan apa adanya)" }
  → 202 { data: { id, wamid, status, conversationId, clientRef } }
  Error: 422 window_closed · 404 template_not_found · 400 invalid_phone · 422/502 meta_error {metaCode, messageId}
GET  /api/v1/messages/:id            scope messages:read
GET  /api/v1/conversations?filter=all|unread|open&q=&cursor=  scope conversations:read → { data, nextCursor }
GET  /api/v1/conversations/:id/messages?before=&limit=        scope messages:read → { data, hasMore }
GET  /api/v1/contacts/:waId          scope conversations:read (nomor boleh format 08…)
GET  /api/v1/templates?status=APPROVED                        scope templates:read
POST /api/v1/media  (multipart, field "file")                 scope media:write → { data: { mediaId, … } }
GET  /api/v1/media/:id               scope messages:read (selalu sebagai lampiran)
```

Pesan yang dikirim lewat API muncul di inbox UI dengan label "API: <nama key>".

**Idempotensi:** kombinasi `(api_key_id, Idempotency-Key)` disimpan 24 jam.
- Request ulang dengan body sama → respons tersimpan dikembalikan dengan header `Idempotent-Replayed: true`.
- Request ulang dengan body berbeda → 409 `idempotency_conflict`.
- Request yang masih diproses → 409 `idempotency_in_progress`.

### 9.3 Webhook keluar

- Event: `message.received`, `message.sent` (dari UI maupun API), `message.status` (hanya saat status pesan keluar berubah). Event uji: `ping`.
- Body: `{"id":"<ULID event>","type":"message.received","createdAt":"…","data":{"message":{…},"conversation":{…}}}`. Untuk `message.status`, `data` hanya berisi `message`.
- Header:
  - `X-WaInbox-Event`
  - `X-WaInbox-Delivery` (ID delivery)
  - `X-WaInbox-Timestamp` (unix detik)
  - `X-WaInbox-Signature: sha256=<hex(HMAC_SHA256(secret, timestamp + "." + body))>`
- Secret (`whsec_…`) ditampilkan sekali saat dibuat atau diganti.
- Penerima wajib membalas 2xx dalam 10 detik. Jika gagal, retry setelah 1 mnt, 5 mnt, 30 mnt, 2 jam, 6 jam, 24 jam, lalu dinyatakan `failed`. Setelah 50 delivery gagal total, webhook dinonaktifkan otomatis.
- Di produksi URL wajib HTTPS.
- UI admin: daftar delivery (status, kode respons, cuplikan body), kirim ulang, kirim event uji.

## 10. Frontend

| Route | Isi |
|---|---|
| `/login` | Form login |
| `/chats`, `/chats/:id` | Layout 2 panel ala WhatsApp Web: kiri daftar percakapan (search, filter, badge), kanan ruang chat (header kontak + sisa jendela 24 jam, linimasa, composer). Di layar sempit tampil satu panel + tombol kembali |
| `/settings/whatsapp` | Wizard koneksi: (1) kredensial → (2) pilih nomor → (3) callback URL + verify token + langkah di Meta → (4) cek koneksi |
| `/settings/users` | Kelola petugas (admin) |
| `/settings/api` | Tab API key, Webhook keluar (+ delivery), link ke `/api/docs` |
| `/settings/profile` | Ganti password |
| `/privacy` | Halaman statis dari server (`server/src/public/privacy.html`), publik |

Komponen inti:
- `ConversationList` (virtuoso, infinite query);
- `MessageTimeline` (virtuoso terbalik, pemisah tanggal, `MessageBubble` per tipe, `StatusTicks`);
- `Composer` (textarea auto-grow, lampiran, reply bar, kunci saat jendela tertutup);
- `TemplatePicker` (dialog: pilih template, isi variabel, preview);
- `ConnectionBanner`.

State: TanStack Query sebagai sumber data, `lib/sse.ts` memperbarui cache. Optimistic send memakai `client_ref` (UUID) yang dicocokkan saat event `message.created` atau `message.updated` datang.

Notifikasi: `Notification` API + suara singkat (`/sounds/incoming.mp3`), hanya saat tab tidak fokus atau chat tersebut tidak sedang dibuka. Judul tab: `(3) WA Inbox`.

## 11. Keamanan

- `@fastify/helmet` dengan CSP ketat (self + data: untuk gambar). `trustProxy` diaktifkan agar IP klien terbaca dari Apache.
- Cookie `wai_sess`: httpOnly, Secure, SameSite=Lax, 12 jam sliding. DB hanya menyimpan `sha256(token)`.
- Login: rate limit 5/menit per IP + per email. Pesan error generik.
- Enkripsi kolom `*_enc`: AES-256-GCM, kunci `APP_KEY` (base64 32 byte), format `v1:<iv>:<tag>:<ciphertext>`.
- Pino `redact` untuk `authorization`, `cookie`, `access_token`, `password`, `app_secret`, `*.token`.
- Audit log untuk: login, kirim pesan (user/API), ubah koneksi, buat/cabut API key, ubah webhook keluar, ubah user.
- File `.env` dan `storage/` tidak pernah dilayani langsung (proxy hanya ke Node; aaPanel juga memblokir `.env`).

## 12. Server, deploy & operasi

### 12.1 Lingkungan produksi

**[server: sudah]**

| Item | Nilai |
|---|---|
| Panel | aaPanel 8, web server **Apache** (bukan Nginx) |
| Node project aaPanel | **`wa_kppbwi_app`**, folder `/www/wwwroot/wa.kppbwi.app`, port **3210** (hanya 127.0.0.1), run user `www`, auto-start, Node `v24.14.0` (Node version manager aaPanel), batas memori 1024 MB |
| Perintah jalan | Saat ini `node placeholder/server.js`. Deploy pertama mengubahnya otomatis menjadi `node --env-file=.env app/server/dist/index.js` |
| Domain & SSL | `wa.kppbwi.app`, Let's Encrypt via aaPanel (diperpanjang otomatis oleh cron bawaan aaPanel), Force HTTPS |
| Database | MariaDB 10.11 milik aaPanel, DB **`wainbox`**, user `wainbox` (akses 127.0.0.1); kredensial di `.env` server |
| Lainnya | Redis lokal tersedia (belum dipakai). **Disk terbatas** (sisa ±11 GB): simpan maksimal 3 release, batasi log, backup, dan retensi media |

Akses SSH, alamat server, dan catatan site lain ada di `DEPLOYMENT.local.md` (tidak di-commit, hanya di laptop admin).

### 12.2 Tata letak di server

```
/www/wwwroot/wa.kppbwi.app/              (owner www, BUKAN git clone)
├── .env                                 dipertahankan antar deploy
├── storage/media/                       dipertahankan
├── releases/<YYYYmmdd-HHMMSS>-<sha7>/   kode + hasil build per deploy (simpan 3 terbaru)
├── app -> releases/<aktif>              symlink yang dijalankan aaPanel
├── bin/                                 cli.sh, restart.sh, watchdog.sh, rollback.sh (disalin dari deploy/server/bin)
└── placeholder/server.js                halaman sementara sebelum deploy pertama
```

### 12.3 Deploy dari laptop (`scripts/deploy.sh`, dibuat di Prompt 3)

Pengembangan dan deploy dilakukan dari laptop, oleh sesi Claude Code di folder proyek. Produksi hanya berubah saat `scripts/deploy.sh` dijalankan. Tidak ada auto-deploy.

1. **Di laptop:** working tree bersih, lalu `npm run check` (lint, typecheck, test) harus hijau. Jika tidak, deploy dibatalkan.
2. `git archive HEAD | ssh <host> "tar -x -C <APP_DIR>/releases/<rel>"`. Host dan folder dibaca dari `deploy/deploy.local.env` (tidak di-commit).
3. `ssh <host> "bash <APP_DIR>/releases/<rel>/deploy/server/activate.sh <rel> <sha>"`. Di server, `activate.sh`:
   1. Mengunci proses dengan `flock`. Deskriptor kunci ditutup saat memanggil restart (`9>&-`), agar proses Node tidak mewarisi kunci.
   2. Menaruh Node 24 di PATH, lalu menjalankan `npm ci` dan `npm run build` sebagai `www` di folder release, dengan `APP_VERSION=<sha>`. Folder release tidak punya `.git`, jadi versi diberikan lewat env. Jika gagal: folder release dihapus, produksi tidak berubah, exit 1.
   3. Migrasi: `node --env-file=<APP_DIR>/.env releases/<rel>/server/dist/cli.js db:migrate` sebagai `www`. **Migrasi wajib additive**, karena rollback hanya mengembalikan kode, bukan skema.
   4. Menyalin `deploy/server/bin/*` ke `<APP_DIR>/bin/`.
   5. Mencatat target symlink lama, lalu `ln -sfn releases/<rel> app`.
   6. Jika perintah jalan aaPanel belum `node --env-file=.env app/server/dist/index.js`, mengubahnya lewat `nodejsModel.modify_project`.
   7. Restart lewat aaPanel (`bin/restart.sh`).
   8. Healthcheck `http://127.0.0.1:3210/healthz` maksimal 40 detik. Field `version` wajib sama dengan `<sha>`. Jika gagal:
      - symlink dikembalikan ke release lama (pada deploy pertama: perintah jalan kembali ke placeholder);
      - restart;
      - folder release yang gagal dihapus (log disalin ke `/www/wwwlogs/wa_kppbwi_app-activate-failed.log`), agar tidak pernah menjadi target rollback;
      - exit 1.
   9. Menghapus release selain 3 terbaru.
4. Setelah sukses: `git push` ke GitHub sebagai cadangan.

Aturan penulisan skrip, dari review 1 Nov 2026:
- Setiap langkah dicek eksplisit (`|| { log …; exit 1; }`). Jangan mengandalkan `set -e` di dalam fungsi yang dipanggil dari `if`, karena bash mengabaikannya di sana.
- Output panjang npm/build ditulis ke `releases/<rel>/.build.log`, bukan ke log utama.
- Skenario wajib diuji di sandbox server sebelum dipakai: deploy pertama dari placeholder, build gagal, healthcheck/versi salah, dan rollback manual.

Operasional:
- Log ringkas: `/www/wwwlogs/wa_kppbwi_app-deploy.log`.
- Rollback manual: `scripts/deploy.sh --rollback` (menjalankan `bin/rollback.sh` di server). Perintah ini mengarahkan symlink ke release sebelumnya, lalu restart dan healthcheck. Jika release itu tidak sehat, symlink kembali ke release semula.
- Uji sandbox 1 Nov 2026 (project aaPanel di-stub, port terpisah): deploy pertama dari placeholder, build gagal, versi healthz salah + rollback otomatis, rollback manual, watchdog, dan kunci deploy tidak diwarisi proses Node. Semuanya lolos.
- **Kontrak untuk aplikasi:**
  - script root `build` membangun shared, server, dan web;
  - `server/dist/cli.js db:migrate` tersedia;
  - `GET /healthz` mengembalikan 200 dan JSON berisi `version` = `APP_VERSION` saat build.

### 12.4 Cron (didaftarkan di aaPanel → Cron, tipe Shell Script)

| Nama tugas | Jadwal | Perintah | Kapan dibuat |
|---|---|---|---|
| WA Inbox – Watchdog | tiap 5 menit | `bash /www/wwwroot/wa.kppbwi.app/bin/watchdog.sh`: jika `/healthz` gagal 2× berturut-turut → `restart.sh`, catat ke log. Diperlukan karena aaPanel menjalankan Node project dengan `nohup` dan tidak menyalakan ulang proses yang crash | Prompt 3 |
| Backup DB wainbox | harian 01:00, simpan 7 | Tipe **Backup Database** bawaan aaPanel | Prompt 3 |
| WA Inbox – Sinkron template | tiap 30 menit | `bash /www/wwwroot/wa.kppbwi.app/bin/cli.sh templates:sync` | Prompt 8 |
| WA Inbox – Housekeeping | harian 02:30 | `bash /www/wwwroot/wa.kppbwi.app/bin/cli.sh housekeeping`: hapus sesi kedaluwarsa, `webhook_events` selesai > 30 hari, delivery > 30 hari, idempotency > 24 jam, dan media > `MEDIA_RETENTION_DAYS` | Prompt 10 |

`bin/cli.sh` menjalankan CLI sebagai `www`:
`runuser -u www -- /www/server/nodejs/v24.14.0/bin/node --env-file=/www/wwwroot/wa.kppbwi.app/.env /www/wwwroot/wa.kppbwi.app/app/server/dist/cli.js "$@"`

Cron dibuat lewat UI aaPanel atau `btpython` (`crontab.crontab().AddCrontab`). Nama tugas harus persis seperti di atas.

### 12.5 Log

- Aplikasi: pino JSON → stdout → `/www/server/nodejs/vhost/logs/wa_kppbwi_app.log` (dikelola aaPanel).
- Deploy: `/www/wwwlogs/wa_kppbwi_app-deploy.log`.
- Apache: `/www/wwwlogs/wa_kppbwi_app-*_log`.

### 12.6 Pengembangan lokal (laptop)

- Node 24 di laptop. Semua perintah dijalankan dari folder proyek.
- Database dev & test: `wainbox_dev`, dibuat lewat aaPanel di Prompt 1. Diakses lewat tunnel `ssh -N -L 3307:127.0.0.1:3306 <host>` (host di `DEPLOYMENT.local.md`). Variabel `DATABASE_URL` (dev) dan `DATABASE_URL_TEST` ada di `.env` lokal.
- `npm run dev` menjalankan server (tsx watch, port 3210) dan Vite (port 5173, proxy `/api` & `/webhooks` ke 3210).
- Meta tidak bisa memanggil localhost. Uji lokal memakai `scripts/simulate-webhook.ts` yang mengirim fixture bertanda tangan. Uji dengan Meta asli dilakukan di produksi.

## 13. Pengujian

- Unit (Vitest):
  - verifikasi signature;
  - parser webhook untuk setiap fixture tipe pesan & status;
  - urutan status monoton;
  - perhitungan jendela 24 jam;
  - pembentukan komponen template;
  - peta error;
  - enkripsi AES-GCM;
  - hash API key & idempotensi;
  - signature webhook keluar.
- Integrasi: Fastify `inject` terhadap database test dari `DATABASE_URL_TEST` (`wainbox_dev` lewat tunnel SSH; skema dibuat ulang per run) untuk alur webhook → pesan → SSE, kirim pesan (Graph di-mock), dan API v1.
- Fixture disimpan di `server/test/fixtures/meta/` dengan bentuk payload resmi Meta.
- **Sebelum deploy:** `npm run check` (lint, typecheck, test) wajib hijau. `scripts/deploy.sh` menjalankannya dan menolak deploy jika gagal.
- **Smoke test produksi** setelah deploy: `/healthz`, login, SSE, kirim pesan ke nomor uji, terima balasan, status ✓✓ biru.

## 14. Checklist di sisi Meta (dikerjakan admin)

1. **business.facebook.com** → pastikan memegang akses penuh ke business portfolio KPP dan WABA yang memuat nomor +62 812-200-627.
2. **developers.facebook.com** → Create App → use case *Connect with customers through WhatsApp* → pilih business portfolio KPP. Bisa juga memakai ulang Meta App lama, jika ada.
3. App settings → Basic:
   - catat **App ID** dan **App Secret**;
   - isi Privacy Policy URL `https://wa.kppbwi.app/privacy`, ikon, dan kategori;
   - ubah app ke mode **Live**. Sebagian webhook tidak dikirim saat Development mode. **Tidak perlu App Review.**
4. Business Settings → Users → **System users** → tambah (role Admin):
   - Assign assets: App (full control) dan WhatsApp account (full control);
   - Generate token: pilih App, expiration **Never**, permission `whatsapp_business_messaging` + `whatsapp_business_management`;
   - salin token (hanya tampil sekali).
5. Di WA Inbox → Pengaturan → WhatsApp: masukkan App ID, App Secret, WABA ID, dan token → pilih nomor → salin Callback URL & Verify Token.
6. Meta App → WhatsApp → Configuration → Webhook:
   - tempel Callback URL & Verify Token → **Verify and save**;
   - subscribe field `messages`, `message_template_status_update`, `template_category_update`, `message_template_quality_update`, `account_update`, `phone_number_quality_update`.
7. Kembali ke WA Inbox → **Cek koneksi** (melakukan subscribe app ke WABA) → kirim pesan dari HP ke nomor kantor → pesan muncul di inbox.
8. Metode pembayaran WABA sudah ada (dipakai Kirimdev). Cek di WhatsApp Manager → Overview.
