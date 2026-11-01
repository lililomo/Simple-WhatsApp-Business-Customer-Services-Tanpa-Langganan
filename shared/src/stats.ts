/**
 * Statistik layanan per pegawai per bulan (WIB), dibaca portal kppbwi.app untuk pemantauan.
 *
 * "Pertanyaan" = satu giliran warga: pesan masuk pertama setelah balasan terakhir dari petugas. Giliran itu
 * dianggap dijawab oleh petugas yang pertama membalas sesudahnya; selisih waktunya = waktu tanggap.
 * Balasan otomatis dan pesan lewat API tidak dihitung sebagai jawaban petugas.
 */
export interface AgentStatsDTO {
  userId: string;
  nip: string | null;
  name: string;
  seksi: string | null;
  /** Pesan yang dikirim petugas (semua jenis, kecuali yang gagal). */
  messagesSent: number;
  /** Percakapan yang dibalas petugas minimal sekali. */
  conversationsHandled: number;
  /** Giliran pertanyaan warga yang dijawab petugas ini lebih dulu. */
  questionsAnswered: number;
  responseMedianSec: number | null;
  responseAvgSec: number | null;
  mediaSent: number;
  stickersSent: number;
  templatesSent: number;
  /** Jumlah hari (WIB) petugas mengirim pesan. */
  activeDays: number;
  lastActivityAt: string | null;
}

export interface MonthlyStatsDTO {
  month: string;
  from: string;
  to: string;
  totals: {
    inboundMessages: number;
    /** Percakapan yang menerima pesan masuk bulan ini. */
    conversations: number;
    newContacts: number;
    questions: number;
    /** Dijawab petugas lewat WA Inbox. */
    questionsAnswered: number;
    /** Ditutup pesan dari sistem lain lewat API (mis. kode billing dari portal), tanpa petugas WA Inbox. */
    questionsAnsweredByApi: number;
    questionsUnanswered: number;
    responseMedianSec: number | null;
    agentMessages: number;
    autoReplies: number;
    apiMessages: number;
  };
  agents: AgentStatsDTO[];
}
