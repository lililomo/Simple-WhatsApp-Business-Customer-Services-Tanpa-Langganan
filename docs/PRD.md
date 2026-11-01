# PRD — WA Inbox KPP Pratama Banyuwangi

| | |
|---|---|
| Produk | WA Inbox (nama kerja), aplikasi web internal |
| URL | https://wa.kppbwi.app |
| Pemilik | KPP Pratama Banyuwangi |
| Status | Draft v1 — 1 November 2026 |
| Dokumen terkait | [SPEC.md](SPEC.md) (desain teknis), [PROMPTS.md](PROMPTS.md) (alur pembangunan) |

## 1. Latar belakang

KPP Pratama Banyuwangi melayani wajib pajak lewat WhatsApp di nomor **+62 812-200-627**. Nomor ini sudah berjalan di **WhatsApp Cloud API** (tidak lagi aktif di aplikasi WhatsApp di HP) dan saat ini dioperasikan lewat SaaS pihak ketiga (Kirimdev) dengan biaya langganan.

Kantor ingin punya aplikasi sendiri yang:

- terhubung langsung ke Meta tanpa perantara;
- datanya tersimpan di server milik kantor, sejalan dengan UU PDP;
- cukup untuk kebutuhan layanan: membaca pesan masuk dan membalasnya;
- bisa diintegrasikan ke sistem internal lain lewat API.

Karena hanya mengelola aset WhatsApp milik sendiri, aplikasi ini berstatus **direct developer** di Meta: **tidak perlu App Review dan tidak perlu menjadi Tech Provider** (lihat dokumentasi Meta "Permissions": *direct developer yang hanya mengakses data bisnisnya sendiri tidak perlu App Review atau Advanced access*).

## 2. Tujuan

1. Petugas dapat melihat pesan WhatsApp baru secara real-time dan membalasnya dari browser.
2. Admin dapat menghubungkan nomor WhatsApp Business (Cloud API) dengan memasukkan kredensial Meta App sendiri (cara "Setup manual": WABA ID + system user token).
3. Sistem lain di kantor dapat mengirim dan membaca pesan lewat REST API, serta menerima event lewat webhook keluar.
4. Seluruh riwayat percakapan tersimpan di database milik kantor.

## 3. Di luar cakupan fase 1

| Tidak dibuat sekarang | Rencana |
|---|---|
| Penugasan chat ke petugas, label, SLA, catatan internal | Fase 2 (tim) |
| Balasan otomatis di luar jam layanan / hari libur | Fase 2 — **saat ini dipakai di Kirimdev**, lihat §9 |
| Balasan cepat (canned responses) | Fase 2 |
| Broadcast / kampanye, chatbot, AI | Belum direncanakan |
| Membuat/mengedit template | Dilakukan di WhatsApp Manager; aplikasi hanya sinkron & memakai |
| Embedded Signup, multi-tenant, Tech Provider | Tidak dibutuhkan (aplikasi internal) |
| Coexistence (nomor tetap di HP) | Tidak dibutuhkan (nomor sudah Cloud API-only) |
| Panggilan suara/video WhatsApp | Belum direncanakan |
| Impor riwayat chat lama dari Kirimdev | Opsional, terpisah |

## 4. Pengguna

| Peran | Kebutuhan |
|---|---|
| **Admin** (1–2 orang, TI kantor) | Menghubungkan nomor WhatsApp, mengelola akun petugas, membuat API key dan webhook keluar |
| **Petugas** (beberapa orang, layanan) | Membaca pesan masuk, membalas, mengirim template saat jendela 24 jam tertutup |
| **Sistem lain** (aplikasi internal) | Mengirim notifikasi/balasan dan membaca status lewat API |

Di fase 1 semua petugas melihat semua percakapan (belum ada penugasan).

## 5. Kebutuhan fungsional

Prioritas: **M** = wajib fase 1, **S** = sebaiknya fase 1 jika waktu cukup.

### 5.1 Autentikasi & pengguna

| ID | Prio | Kebutuhan | Kriteria terima |
|---|---|---|---|
| AUTH-1 | M | Login email + password | Password salah 5× dalam 1 menit → diblokir sementara; sesi berlaku 12 jam, diperpanjang saat aktif |
| AUTH-2 | M | Logout | Sesi dihapus di server |
| AUTH-3 | M | Admin membuat/menonaktifkan petugas & reset password | Petugas nonaktif langsung kehilangan sesi |
| AUTH-4 | M | Admin pertama dibuat lewat CLI di server | `node … cli.js user:create --admin` |
| AUTH-5 | S | Petugas mengganti password sendiri | — |

### 5.2 Koneksi WhatsApp (Admin)

| ID | Prio | Kebutuhan | Kriteria terima |
|---|---|---|---|
| CONN-1 | M | Form isian: App ID, App Secret, WABA ID, System User Access Token | Token & App Secret disimpan terenkripsi, tidak pernah ditampilkan ulang (hanya 4 karakter terakhir) |
| CONN-2 | M | Validasi ke Meta saat simpan | Menampilkan nama WABA, mata uang, dan daftar nomor di WABA; token tidak valid → pesan error jelas |
| CONN-3 | M | Memilih nomor dari daftar (terdeteksi otomatis dari WABA) | Menyimpan Phone Number ID, nomor tampilan, verified name, quality rating |
| CONN-4 | M | Menampilkan **Callback URL** dan **Verify Token** untuk ditempel di Meta App | Tombol salin |
| CONN-5 | M | Tombol "Cek koneksi": subscribe app ke WABA + cek status nomor + cek webhook terakhir diterima | Status hijau/kuning/merah dengan penjelasan |
| CONN-6 | S | Jika nomor belum terdaftar di Cloud API: form PIN 6 digit → register | — |
| CONN-7 | M | Status koneksi tampil di header aplikasi | Merah jika token ditolak Meta (error 190) atau webhook tidak masuk > 24 jam padahal ada trafik keluar |

Model data mendukung lebih dari satu nomor, tetapi UI fase 1 cukup untuk satu nomor.

### 5.3 Inbox (daftar percakapan)

| ID | Prio | Kebutuhan | Kriteria terima |
|---|---|---|---|
| INB-1 | M | Daftar percakapan urut pesan terakhir | Nama kontak (atau nomor), cuplikan pesan terakhir, waktu relatif, badge belum dibaca |
| INB-2 | M | Real-time | Pesan baru muncul paling atas ≤ 2 detik setelah webhook diterima, tanpa refresh |
| INB-3 | M | Indikator jendela 24 jam | Ikon/teks "sisa 5 jam" atau "jendela tertutup" |
| INB-4 | M | Pencarian nama, nomor, isi pesan | — |
| INB-5 | M | Filter: Semua · Belum dibaca · Jendela terbuka | — |
| INB-6 | M | Notifikasi pesan baru | Suara + notifikasi browser (izin diminta sekali), jumlah belum dibaca di judul tab |
| INB-7 | M | Infinite scroll | Lancar untuk ribuan percakapan |

### 5.4 Ruang chat

| ID | Prio | Kebutuhan | Kriteria terima |
|---|---|---|---|
| CHAT-1 | M | Riwayat pesan dengan scroll ke atas (pagination) | Bubble masuk kiri, keluar kanan, pemisah tanggal |
| CHAT-2 | M | Render semua tipe pesan masuk | teks (format *tebal* _miring_ ~coret~ ```mono```), gambar, video, audio/voice note, dokumen, stiker, lokasi, kontak, balasan tombol/list, reaksi, pesan dengan kutipan; tipe tak dikenal → "Pesan tidak didukung" |
| CHAT-3 | M | Status pesan keluar | ✓ terkirim, ✓✓ diterima, ✓✓ biru dibaca, ⚠ gagal + alasan (dari kode error Meta) |
| CHAT-4 | M | Pengirim pesan keluar | Nama petugas, atau "API: <nama key>" |
| CHAT-5 | M | Saat chat dibuka: tandai dibaca | Unread jadi 0; read receipt dikirim ke Meta (bisa dimatikan di pengaturan) |
| CHAT-6 | M | Panel info kontak | Nomor, nama profil WA, nama tampilan (bisa diubah), waktu pesan pertama |
| CHAT-7 | S | Klik gambar → lihat besar; dokumen → unduh | — |

### 5.5 Membalas

| ID | Prio | Kebutuhan | Kriteria terima |
|---|---|---|---|
| SEND-1 | M | Kirim teks (≤ 4096 karakter) | Enter kirim, Shift+Enter baris baru; pesan tampil langsung (optimistic) lalu status diperbarui |
| SEND-2 | M | Balas dengan kutipan (reply) | Pesan terkirim memakai `context.message_id` |
| SEND-3 | M | Kirim lampiran: gambar, dokumen, audio, video (+ caption) | Validasi tipe & ukuran sesuai batas Meta sebelum upload |
| SEND-4 | M | Jendela 24 jam tertutup → kotak teks terkunci | Ada penjelasan + tombol "Kirim template" |
| SEND-5 | M | Gagal kirim → tampil error yang bisa dipahami + tombol coba lagi | Kode error Meta dipetakan ke bahasa Indonesia |
| SEND-6 | S | Peringatan saat mengetik pola NIK/NPWP 16 digit atau nomor rekening | Mengingatkan Policy WhatsApp: jangan meminta/membagikan nomor identitas lewat chat |
| SEND-7 | S | Emoji picker | — |

### 5.6 Template

| ID | Prio | Kebutuhan | Kriteria terima |
|---|---|---|---|
| TPL-1 | M | Sinkron template dari Meta | Otomatis tiap 30 menit (cron aaPanel) + tombol manual |
| TPL-2 | M | Pilih template APPROVED, isi variabel, lihat preview, kirim | Kategori ditampilkan (Marketing lebih mahal dari Utility) |
| TPL-3 | M | Mulai chat baru ke nomor yang belum pernah chat | Wajib memakai template |
| TPL-4 | M | Status template berubah (disetujui/ditolak/dijeda/kategori diubah Meta) tercermin otomatis lewat webhook | — |

### 5.7 API integrasi (Admin)

| ID | Prio | Kebutuhan | Kriteria terima |
|---|---|---|---|
| API-1 | M | Admin membuat API key (nama + scope), key hanya tampil sekali | Disimpan sebagai hash; bisa dicabut kapan saja |
| API-2 | M | REST API v1: kirim teks/template/media, ambil status pesan, daftar percakapan & pesan, daftar template, upload media | Respons JSON konsisten; error memakai kode yang jelas (mis. `window_closed`) |
| API-3 | M | Idempotensi kirim pesan lewat header `Idempotency-Key` | Request ulang dengan key sama tidak mengirim dua kali |
| API-4 | M | Webhook keluar: admin mendaftarkan URL + memilih event | Event `message.received`, `message.sent`, `message.status`; ditandatangani HMAC; retry otomatis |
| API-5 | M | Dokumentasi OpenAPI (Swagger UI) di `/api/docs` | Hanya untuk admin yang login |
| API-6 | M | Rate limit per key (default 60 request/menit) | 429 + `Retry-After` |
| API-7 | S | Log pemakaian per key (terakhir dipakai, jumlah request, delivery webhook gagal) | — |

### 5.8 Halaman publik

| ID | Prio | Kebutuhan |
|---|---|---|
| PUB-1 | M | `/privacy`: kebijakan privasi layanan WhatsApp KPP (dibutuhkan Meta App untuk Live mode) |
| PUB-2 | M | `/healthz` untuk pemantauan |

## 6. Kebutuhan non-fungsional

| Area | Kebutuhan |
|---|---|
| Keamanan | HTTPS saja; token Meta, App Secret, dan secret webhook dienkripsi AES-256-GCM; password argon2id; cookie sesi httpOnly + Secure + SameSite; signature `X-Hub-Signature-256` wajib valid; log tidak boleh memuat token/password |
| Keandalan | Webhook dari Meta disimpan dulu ke database lalu dibalas 200 (< 1 detik), baru diproses; pemrosesan idempoten (Meta bisa mengirim ulang hingga 7 hari) |
| Ketersediaan | Berjalan sebagai Node project aaPanel dengan auto-start; watchdog cron menyalakan ulang jika `/healthz` gagal |
| Data & PDP | Data di server sendiri; akses hanya pengguna login; audit log untuk aksi kirim/ubah pengaturan; retensi media dapat diatur (default 365 hari); backup database harian lewat aaPanel |
| Kinerja | Daftar percakapan < 300 ms untuk 10.000 percakapan; chat 1.000 pesan tetap lancar (virtualisasi) |
| Kapasitas | Volume layanan kantor (ratusan–ribuan pesan/hari); batas Meta 80 pesan/detik tidak relevan |
| UI | Bahasa Indonesia; desktop utama, tetap bisa dipakai di HP; mode gelap & terang |
| Operasional | Semua sumber daya server didaftarkan lewat aaPanel (site, SSL, database, cron, backup) |

## 7. Aturan Meta yang harus dipatuhi aplikasi

- **Jendela layanan 24 jam:** pesan bebas hanya boleh dikirim ≤ 24 jam sejak pesan terakhir wajib pajak. Di luar itu wajib template yang disetujui.
- **Biaya (per 1 Okt 2026):** setiap nomor mendapat 1.000 pesan service gratis per bulan. Template utility, termasuk yang dikirim di dalam jendela 24 jam, ditagih (±Rp357). Template marketing ±Rp586. Instansi pemerintah yang dinilai eligible oleh Meta tetap gratis untuk pesan service di atas kuota sampai 31 Des 2027. Tagihan dibayar langsung ke Meta oleh kantor.
  - Sumber: halaman resmi [Pricing WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), dicek 1 Nov 2026. Aturan ini berlaku sejak **1 Okt 2026**. Sebelumnya pesan service gratis tanpa batas dan utility di dalam jendela 24 jam gratis, sehingga model yang pengetahuannya berhenti sebelum Oktober 2026 bisa menganggap angka ini keliru.
  - Tarif rupiah bersifat indikatif dari rate card mitra. Cek ulang rate card Meta sebelum menetapkan anggaran.
- **Policy WhatsApp:**
  - wajib ada persetujuan (opt-in) dari penerima, dan permintaan berhenti harus dihormati;
  - jangan meminta atau membagikan nomor identitas pribadi maupun nomor kartu/rekening;
  - percakapan satu pelanggan tidak boleh diteruskan ke pelanggan lain.
- **Batas kirim:** template ke penerima unik dibatasi per 24 jam sesuai tier portfolio, dimulai dari 250 lalu naik setelah verifikasi bisnis.

## 8. Metrik keberhasilan

- 100% pesan masuk di WhatsApp Manager juga tercatat di WA Inbox (uji paralel 1 minggu).
- Median waktu tampil pesan baru di inbox ≤ 2 detik.
- Tidak ada pesan terkirim ganda akibat retry webhook atau API.
- Petugas tidak lagi membuka Kirimdev untuk membalas chat setelah go-live.

## 9. Rencana transisi dari Kirimdev

1. **Persiapan Meta (admin):** buat (atau pakai ulang) Meta App tipe Business di business portfolio KPP. Buat system user dengan token permanen, lalu beri akses ke App dan WABA yang sudah ada. Nomor **tidak perlu didaftarkan ulang**.
   - Cek apakah Meta App lama milik kantor bisa dipakai ulang (catatan di `DEPLOYMENT.local.md`).
2. **Jalan paralel:**
   - Meta mengirim webhook ke **semua** app yang ter-subscribe ke WABA, jadi Kirimdev dan WA Inbox sama-sama menerima pesan masuk.
   - Pesan keluar yang dikirim dari satu aplikasi kemungkinan tidak tercatat di aplikasi lainnya (perlu diuji).
   - Balasan otomatis "di luar jam layanan" dari Kirimdev tetap berjalan selama Kirimdev masih ter-subscribe.
3. **Pindah membalas:** petugas mulai membalas dari WA Inbox. Kirimdev tetap dipertahankan sampai fitur balasan otomatis luar jam layanan selesai (fase 2), atau sampai kantor memutuskan fitur itu boleh hilang.
4. **Lepas Kirimdev:**
   - Cabut akses app Kirimdev dari WABA di **Meta Business Settings**.
   - **Jangan** memakai tombol hapus/disconnect akun di Kirimdev sebelum dipastikan tombol itu tidak men-*deregister* nomor dari Cloud API.
   - Setelah itu baru hentikan langganan.
5. Riwayat chat lama di Kirimdev **tidak** bisa diambil dari Meta (Cloud API tidak menyediakan riwayat). Jika dibutuhkan, ekspor dari API Kirimdev sebagai proyek terpisah.

## 10. Fase berikutnya (gambaran)

- **Fase 2 — Tim & layanan:**
  - penugasan chat (manual/round-robin), status percakapan (terbuka/selesai), label, balasan cepat;
  - balasan otomatis di luar jam layanan dan hari libur;
  - ringkasan biaya bulanan per kategori (data `pricing` dari webhook status sudah disimpan sejak fase 1).
- **Fase 3:** laporan (waktu respon, volume), CSAT, multi-nomor di UI.
