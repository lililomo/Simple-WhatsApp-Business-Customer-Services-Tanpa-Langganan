# Simple WhatsApp Business Customer Services — Tanpa Langganan

Aplikasi web untuk melayani chat pelanggan lewat **WhatsApp Business Platform (Cloud API)** yang terhubung langsung ke Meta, tanpa langganan SaaS pihak ketiga. Biaya yang dibayar hanya tarif per pesan ke Meta (sejak 1 Okt 2026: 1.000 pesan service per nomor per bulan gratis, lihat [PRD §7](docs/PRD.md)).

Penerapan pertama: layanan WhatsApp KPP Pratama Banyuwangi (`wa.kppbwi.app`).

**Status:** tahap perencanaan; kode aplikasi belum dibuat. Lihat [docs/STATUS.md](docs/STATUS.md).

## Fitur fase 1

- Inbox real-time: lihat pesan masuk dan balas (teks, lampiran, kutipan, template) dari browser.
- Koneksi langsung ke Meta memakai WABA ID dan system user token milik sendiri (tanpa App Review atau status Tech Provider).
- REST API + webhook keluar untuk integrasi dengan sistem lain.

## Dokumen

| Dokumen | Isi |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Kebutuhan produk |
| [docs/SPEC.md](docs/SPEC.md) | Desain teknis |
| [docs/PROMPTS.md](docs/PROMPTS.md) | Urutan pembangunan dengan Claude Code |
| [docs/STATUS.md](docs/STATUS.md) | Progres & keputusan |

Stack: Node.js 24, TypeScript, Fastify, React, MariaDB, dideploy sebagai Node project aaPanel.
