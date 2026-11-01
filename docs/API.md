# API WA Inbox untuk Sistem Lain

Dokumentasi interaktif (OpenAPI) tersedia di `https://wa.kppbwi.app/api/docs`, khusus admin yang sudah login. Halaman ini berisi contoh praktis.

## Autentikasi

1. Admin membuat API key di **Pengaturan → API & Webhook → API key**, dengan izin seperlunya.
2. Key (`wai_…`) hanya ditampilkan sekali. Simpan di konfigurasi sistem pemanggil, jangan di kode.
3. Setiap request membawa header:

```
Authorization: Bearer wai_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Batas: 60 request per menit per key (bisa diatur dengan `API_RATE_LIMIT_PER_MIN`). Jika terlampaui, server membalas 429 dengan header `Retry-After`.

Format respons: sukses `{"data": …}`; gagal `{"error": {"code": "…", "message": "…", "details": {…}}}`.

## Mengirim pesan

### Teks (hanya dalam jendela 24 jam sejak pesan terakhir kontak)

```bash
curl -X POST https://wa.kppbwi.app/api/v1/messages \
  -H "Authorization: Bearer $WA_INBOX_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: tiket-2025-000123" \
  -d '{"to":"081234567890","type":"text","text":"Berkas Anda sudah kami terima.","clientRef":"TIKET-123"}'
```

Respons `202`:

```json
{ "data": { "id": "812", "wamid": "wamid.HBg…", "status": "accepted", "conversationId": "41", "clientRef": "TIKET-123" } }
```

Di luar jendela 24 jam, respons berupa `422 window_closed`. Kirim template sebagai gantinya.

### Template (boleh kapan saja)

```bash
curl -X POST https://wa.kppbwi.app/api/v1/messages \
  -H "Authorization: Bearer $WA_INBOX_KEY" -H "Content-Type: application/json" \
  -d '{
    "to": "+62 812-3456-7890",
    "type": "template",
    "template": { "name": "penyampaian_spt", "language": "id", "params": { "body": { "1": "Bapak Budi" } } }
  }'
```

- Variabel posisi `{{1}}` diisi dengan kunci `"1"`, `"2"`, dan seterusnya; variabel bernama `{{nama}}` dengan kunci `"nama"`.
- Variabel header teks: `params.header`. Tombol URL dinamis: `params.buttons`, dengan kunci **indeks tombol** (`"0"` untuk tombol pertama, `"1"` untuk tombol kedua) dan nilai berupa akhiran URL.
- Header gambar/dokumen: unggah dulu lewat `/api/v1/media`, lalu isi `params.headerMediaId`.
- Daftar template dan variabelnya: `GET /api/v1/templates?status=APPROVED`.

### Lampiran

```bash
# 1. Unggah
curl -X POST https://wa.kppbwi.app/api/v1/media \
  -H "Authorization: Bearer $WA_INBOX_KEY" \
  -F "file=@Surat-Teguran.pdf;type=application/pdf"
# → {"data":{"mediaId":"77", …}}

# 2. Kirim (dalam jendela 24 jam)
curl -X POST https://wa.kppbwi.app/api/v1/messages \
  -H "Authorization: Bearer $WA_INBOX_KEY" -H "Content-Type: application/json" \
  -d '{"to":"081234567890","type":"document","media":{"mediaId":"77","caption":"Mohon dibaca"}}'
```

Batas Meta: gambar JPG/PNG maks 5 MB; video MP4/3GP dan audio maks 16 MB; dokumen (PDF/Office/TXT) maks 100 MB.

### Idempotensi

Kirim header `Idempotency-Key` yang unik per pesan, misalnya nomor tiket.
- Jika request terputus lalu diulang dengan key dan body yang sama dalam 24 jam, server mengembalikan respons pertama (`Idempotent-Replayed: true`) tanpa mengirim pesan dua kali.
- Key yang sama dengan body berbeda → `409`.

## Membaca data

| Endpoint | Izin |
|---|---|
| `GET /api/v1/messages/{id}`: detail & status (`accepted` → `sent` → `delivered` → `read`, atau `failed` + `error`) | `messages:read` |
| `GET /api/v1/conversations?filter=unread&q=…&cursor=…` | `conversations:read` |
| `GET /api/v1/conversations/{id}/messages?before={idPesan}&limit=50` | `messages:read` |
| `GET /api/v1/contacts/081234567890` | `conversations:read` |
| `GET /api/v1/media/{id}` (unduh file) | `messages:read` |

## Webhook keluar

Daftarkan URL HTTPS sistem Anda di **Pengaturan → API & Webhook → Webhook keluar**, lalu pilih event:
- `message.received`: pesan masuk dari wajib pajak.
- `message.sent`: pesan keluar dari petugas maupun API.
- `message.status`: perubahan status pesan keluar.

Contoh body:

```json
{
  "id": "01JC6Q2S6ZK3T7Y8F4M1N2P3QR",
  "type": "message.received",
  "createdAt": "2026-11-01T09:30:00.000Z",
  "data": {
    "message": { "id": "812", "direction": "in", "type": "text", "text": "Halo", "timestamp": "…" },
    "conversation": { "id": "41", "contact": { "waId": "6281234567890", "name": "Budi" } }
  }
}
```

Header yang dikirim: `X-WaInbox-Event`, `X-WaInbox-Delivery`, `X-WaInbox-Timestamp`, `X-WaInbox-Signature`.

Balas `2xx` dalam 10 detik. Jika gagal, server mencoba lagi setelah 1 menit, 5 menit, 30 menit, 2 jam, 6 jam, dan 24 jam. Event bisa terkirim lebih dari sekali, jadi pakai `id` untuk menghindari pemrosesan ganda.

### Verifikasi tanda tangan: PHP

```php
<?php
$secret    = getenv('WA_INBOX_WEBHOOK_SECRET'); // whsec_…
$body      = file_get_contents('php://input');
$timestamp = $_SERVER['HTTP_X_WAINBOX_TIMESTAMP'] ?? '';
$signature = $_SERVER['HTTP_X_WAINBOX_SIGNATURE'] ?? '';

$expected = 'sha256=' . hash_hmac('sha256', $timestamp . '.' . $body, $secret);
if (!hash_equals($expected, $signature) || abs(time() - (int) $timestamp) > 300) {
    http_response_code(401);
    exit;
}
$event = json_decode($body, true);
// … proses $event['type'] dan $event['data'] …
http_response_code(200);
```

### Verifikasi tanda tangan: Node.js

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyWaInbox(rawBody, headers, secret) {
  const timestamp = headers['x-wainbox-timestamp'];
  const signature = headers['x-wainbox-signature'] ?? '';
  const expected = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
  return fresh && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Gunakan body mentah (string/buffer persis seperti diterima), bukan hasil `JSON.parse` lalu `JSON.stringify`.
