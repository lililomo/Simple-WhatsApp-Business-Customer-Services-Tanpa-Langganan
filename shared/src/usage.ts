/**
 * Kuota pesan service gratis WhatsApp (sejak 1 Okt 2026): 1.000 pesan service (non-template, di dalam jendela
 * 24 jam) per nomor per bulan; mulai pesan ke-1.001 ditagih, kecuali instansi pemerintah eligible
 * (`service_pricing_policy` = PAID_EXEMPT) yang tetap gratis sampai 31 Des 2027. Template selalu terpisah.
 */
export const FREE_SERVICE_MESSAGES = 1000;

export interface UsageDTO {
  month: string;
  /** Reset kuota berikutnya (awal bulan depan, WIB). */
  resetsAt: string;
  freeLimit: number;
  /** Pesan service terkirim bulan ini (nilai terbesar dari hitungan WA Inbox dan laporan Meta). */
  used: number;
  remaining: number;
  /** Hitungan realtime WA Inbox dari webhook status (semua aplikasi di nomor ini, sejak dicatat). */
  local: { service: number; serviceBillable: number; templates: number };
  /** Laporan pricing_analytics Meta (resmi, bisa tertunda beberapa jam); null bila gagal diambil. */
  meta: {
    service: number;
    serviceBillable: number;
    templates: number;
    cost: number;
    currency: string | null;
    fetchedAt: string;
  } | null;
  metaError: string | null;
  /** PAID_EXEMPT = pesan service di atas 1.000 tetap gratis (instansi pemerintah); null bila tidak diketahui. */
  servicePricingPolicy: 'PAID_EXEMPT' | 'REGULAR' | null;
}
