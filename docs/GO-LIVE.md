# Laporan Go-live

Go-live WA Inbox dengan Meta (Prompt 11), 1 November 2026 malam. Langkah di sisi Meta dikerjakan pemilik mengikuti [SPEC §14](SPEC.md#14-checklist-di-sisi-meta-dikerjakan-admin). ID dan nama aset Meta dicatat di `DEPLOYMENT.local.md`, bukan di repo publik.

## Yang disiapkan

| Langkah | Hasil |
|---|---|
| Admin produksi | Dibuat pemilik lewat `bin/cli.sh user:create --admin` |
| SSE lewat Apache + HTTP/2 | Terverifikasi di produksi: event pertama ±1 detik, berikutnya langsung (SPEC §8) |
| Meta App baru (use case WhatsApp, business portfolio KPP) | Dibuat. Meta App lama tidak dipakai ulang |
| App settings → Basic | Privacy policy, terms, dan data deletion URL → `https://wa.kppbwi.app/privacy`, kategori, email kontak |
| System user (Admin) | Aset: App (full control) + WABA kantor (full control). Token tanpa kedaluwarsa, izin `whatsapp_business_messaging` + `whatsapp_business_management` |
| Koneksi di WA Inbox | Tersimpan terenkripsi. Cek koneksi: token valid, app ter-subscribe ke WABA, nomor CONNECTED di Cloud API |
| Webhook Meta | Diverifikasi Meta pukul 21:07; field pesan, status template, dan sinyal akun di-subscribe |
| Publish app | Dipublikasikan. Selama belum publish, Meta hanya mengirim webhook uji dari dashboard |

## Hasil uji

Pengujian dilakukan dengan HP pribadi pemilik ke nomor layanan.

| Skenario | Hasil |
|---|---|
| Pesan teks dari HP masuk ke WA Inbox | Berhasil. Webhook pertama 21:15, langsung tampil lewat SSE |
| Balasan teks dari WA Inbox diterima di HP, centang ✓ → ✓✓ → biru | Berhasil (dilaporkan pemilik) |
| Gambar, dokumen PDF, voice note dari HP | Berhasil (dilaporkan pemilik) |
| Lampiran dokumen dari WA Inbox ke HP | Berhasil (dilaporkan pemilik) |
| Reaksi emoji dari HP | Berhasil (dilaporkan pemilik) |
| Sinkron template dari Meta | Berhasil: 3 template |
| Kirim template | **Belum diuji**: setiap template dikenai biaya Meta. Uji saat ada kebutuhan nyata pertama |
| Percakapan selain nomor uji | Sudah mulai masuk ke WA Inbox setelah app dipublikasikan |

Kirimdev tetap ter-subscribe ke WABA yang sama, jadi pesan masuk diterima kedua aplikasi. Balasan yang dikirim dari WA Inbox hanya tersimpan di WA Inbox. Belum dicatat apakah Kirimdev menampilkannya.

## Kendala dan perbaikan

1. **"Cek koneksi" memperingatkan "verifikasi kode: EXPIRED".**
   - Penyebab: `code_verification_status` hanya menyangkut OTP saat nomor didaftarkan; nomor lama yang sudah CONNECTED wajar berstatus EXPIRED.
   - Perbaikan: peringatan sekarang hanya muncul bila status nomor bukan CONNECTED.
2. **Bunyi notifikasi terdengar, tetapi pesan baru tidak terlihat sampai halaman di-reload.**
   - Penyebab: pesan masuk saat jendela tidak terlihat. Selama tab tersembunyi, daftar pesan virtual tidak bisa mengukur pesan baru, sehingga tidak menggulir ke bawah.
   - Perbaikan:
     - posisi bawah diingat saat tab disembunyikan, lalu digulir ke pesan terakhir saat tab terlihat lagi;
     - tombol "Pesan baru" muncul bila ada pesan masuk saat pengguna sedang membaca pesan lama;
     - pengambilan data yang kebetulan sedang berjalan saat event datang diulang, agar tidak menimpa pesan baru.
3. **Halaman `/privacy` masih draf.** Bagian bertanda [PERLU DISETUJUI] wajib diisi dan disetujui kantor.
4. **Business verification di Meta masih "In progress".** Tidak menghalangi pengiriman, tetapi batas pesan bisnis-inisiatif bergantung padanya.

## Keputusan: kapan Kirimdev dilepas

Kirimdev tetap berjalan paralel sampai fitur balasan otomatis di luar jam layanan (fase 2) tersedia di WA Inbox. Saat itu, pemilik sendiri yang mencabut akses partner Kirimdev di Business Settings. Jangan mencabutnya sebelum ada persetujuan pemilik.

Sebelum melepas Kirimdev, periksa:

- template yang dibuat lewat Kirimdev tetap ada di WABA (template milik WABA, bukan milik Kirimdev);
- integrasi lain yang masih memakai API Kirimdev sudah dipindah ke API v1 WA Inbox ([API.md](API.md)).
