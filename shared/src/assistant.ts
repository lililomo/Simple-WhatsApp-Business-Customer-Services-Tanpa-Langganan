import { z } from 'zod';

/** AOS (Asisten OSing): asisten AI untuk petugas. Lihat SPEC §19. */

export const AOS_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' },
] as const;
export const AOS_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AosEffort = (typeof AOS_EFFORTS)[number];

/** Jalur koneksi ke Claude: akun berlangganan atau kunci API. Urutannya diatur admin. */
export const aosProvider = z.enum(['subscription', 'api']);
export type AosProvider = z.infer<typeof aosProvider>;
export const AOS_PROVIDER_LABEL: Record<AosProvider, string> = { subscription: 'Langganan', api: 'API' };

/** offer = tawarkan dulu (bawaan), auto = langsung buat rekomendasi, manual = hanya saat diminta. */
export const aosMode = z.enum(['offer', 'auto', 'manual']);
export type AosMode = z.infer<typeof aosMode>;

export const AOS_DEFAULT_DOMAINS = [
  'pajak.go.id',
  'kemenkeu.go.id',
  'peraturan.go.id',
  'bpk.go.id',
  'ortax.org',
  'ddtc.co.id',
  'ikpi.or.id',
];

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Tulis nama situs saja, mis. pajak.go.id');

export const assistantSettings = z.object({
  enabled: z.boolean().default(false),
  /** Jalur pertama = utama, berikutnya = cadangan. Jalur yang belum terhubung dilewati. */
  order: z.array(aosProvider).min(1).max(2).default(['api', 'subscription']),
  answer: z
    .object({
      model: z.string().min(1).max(64).default('claude-opus-5-5'),
      effort: z.enum(AOS_EFFORTS).default('high'),
    })
    .prefault({}),
  triage: z
    .object({
      enabled: z.boolean().default(true),
      model: z.string().min(1).max(64).default('claude-haiku-5-5'),
      mode: aosMode.default('offer'),
      debounceSec: z.number().int().min(2).max(60).default(8),
    })
    .prefault({}),
  sources: z
    .object({
      web: z.boolean().default(true),
      domains: z.array(domain).max(40).default(AOS_DEFAULT_DOMAINS),
      maxSearches: z.number().int().min(1).max(10).default(5),
      library: z.boolean().default(true),
    })
    .prefault({}),
  privacy: z
    .object({
      mask: z.boolean().default(true),
      attachments: z.boolean().default(true),
      contextMessages: z.number().int().min(5).max(100).default(30),
    })
    .prefault({}),
  style: z
    .object({
      officeProfile: z.string().max(4000).default(''),
      instructions: z.string().max(4000).default(''),
      tone: z.enum(['formal', 'ramah']).default('ramah'),
    })
    .prefault({}),
  budget: z
    .object({
      /** Tidak dipakai lagi (pengaturan anggaran dihapus 26 Nov 2026); dipertahankan agar pengaturan lama tetap terbaca. */
      monthlyUsd: z.number().min(0).max(100_000).default(0),
    })
    .prefault({}),
});
export type AssistantSettings = z.infer<typeof assistantSettings>;

export interface AosProviderStatus {
  provider: AosProvider;
  connected: boolean;
  /** Empat karakter terakhir kredensial, untuk dikenali admin. Kredensialnya sendiri tidak pernah dikirim. */
  last4: string | null;
  state: 'ok' | 'cooldown' | 'rejected' | 'unknown';
  /** Diistirahatkan sampai waktu ini karena kena batas pemakaian. */
  cooldownUntil: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
}

/** Untuk admin (GET /api/assistant/settings). */
export interface AssistantSettingsDTO {
  settings: AssistantSettings;
  providers: AosProviderStatus[];
  /** Menyala dan minimal satu jalur terhubung. */
  ready: boolean;
  /** Biaya jalur API bulan berjalan (USD). */
  monthCostUsd: number;
}

/** Untuk semua petugas (GET /api/assistant/status). */
export interface AssistantStatusDTO {
  ready: boolean;
  mode: AosMode;
}

export const credentialBody = z.object({ secret: z.string().trim().min(20).max(600) });
export const orderBody = z.object({ order: z.array(aosProvider).min(1).max(2) });

/** Login langganan lewat tautan: server menyiapkan tautan login Claude, admin menempel kode yang ditampilkan Claude. */
export interface AosLoginStartDTO {
  url: string;
  /** Tautan dan sesi login berlaku sampai waktu ini. */
  expiresAt: string;
}
export const aosLoginCodeBody = z.object({ code: z.string().trim().min(8, 'Kode belum lengkap').max(2000) });

export interface AosConnectionTestDTO {
  ok: boolean;
  provider: AosProvider;
  model: string | null;
  message: string;
  durationMs: number;
}

/* ---------- Sesi per percakapan ---------- */

export type AosMessageKind = 'offer' | 'user' | 'answer' | 'error';
export type AosMessageStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';
export type AosConfidence = 'tinggi' | 'sedang' | 'rendah';

export interface AosSource {
  type: 'library' | 'web';
  title: string;
  documentId?: string;
  page?: number | null;
  url?: string;
}

export interface AosOption {
  label: string;
  /** Instruksi yang dijalankan bila pilihan ini ditekan. */
  instruction: string;
  primary?: boolean;
  /** Bila terisi, pilihan ini memasang label ke kontak, bukan meminta jawaban. */
  labelId?: string;
}

export interface AosAnswer {
  draft: string | null;
  notes: string | null;
  confidence: AosConfidence | null;
  sources: AosSource[];
  /**
   * Infografis yang didesain Claude sendiri: dokumen HTML+CSS mandiri (lebar 1080 px, tanpa skrip dan tanpa sumber
   * luar), sudah disaring `sanitizeInfographic`. Browser petugas menggambarnya menjadi PNG. Tidak ada di jawaban lama.
   */
  infographic?: string | null;
  /**
   * Draf yang dipecah agar setiap bagian muat dalam satu pesan WhatsApp, urut sesuai urutan kirim. Hanya ada bila
   * lebih dari satu bagian; jawaban lama tidak punya kolom ini (pakai `splitForWhatsApp(draft)`).
   */
  parts?: string[];
}

export interface AosMessageDTO {
  id: string;
  conversationId: string;
  kind: AosMessageKind;
  status: AosMessageStatus;
  /** Teks tawaran, teks petugas, atau teks jawaban mentah (bertanda bagian, lihat parseAosAnswer). */
  text: string | null;
  options: AosOption[] | null;
  offerState: 'open' | 'answered' | 'dismissed' | null;
  answer: AosAnswer | null;
  /** Langkah kerja yang sedang/sudah dilakukan ("Mencari di Pustaka…"). */
  steps: string[];
  error: string | null;
  author: { id: string; name: string } | null;
  provider: AosProvider | null;
  model: string | null;
  durationMs: number | null;
  feedback: 1 | -1 | null;
  usedAt: string | null;
  savedDocumentId: string | null;
  createdAt: string;
}

export interface AosThreadDTO {
  conversationId: string;
  topicStartedAt: string | null;
  messages: AosMessageDTO[];
  /** Tawaran yang belum dijawab/ditutup; panel terbuka sendiri bila ada. */
  openOfferId: string | null;
}

export const AOS_ACTIONS = ['summarize', 'explain', 'shorten', 'friendlier', 'regenerate', 'infographic'] as const;
export type AosAction = (typeof AOS_ACTIONS)[number];

export const aosAskBody = z
  .object({
    text: z.string().trim().min(1).max(4000).optional(),
    offerId: z.string().regex(/^\d+$/).optional(),
    optionIndex: z.number().int().min(0).max(9).optional(),
    action: z.enum(AOS_ACTIONS).optional(),
    /** Jawaban yang dimaksud untuk shorten/friendlier/regenerate (wajib) dan infographic (opsional). */
    targetId: z.string().regex(/^\d+$/).optional(),
  })
  .refine((b) => b.text !== undefined || b.action !== undefined || (b.offerId !== undefined && b.optionIndex !== undefined), {
    message: 'Isi pertanyaan, pilih salah satu tawaran, atau pilih tindakan.',
  });
export type AosAskBody = z.infer<typeof aosAskBody>;

export const aosFeedbackBody = z.object({ value: z.union([z.literal(1), z.literal(-1), z.null()]) });
export const aosSaveBody = z.object({ target: z.enum(['library', 'quick-reply']), title: z.string().trim().min(1).max(100) });
export const aosPlaygroundBody = z.object({ text: z.string().trim().min(1).max(4000) });

export interface AosPlaygroundDTO {
  text: string;
  answer: AosAnswer;
  provider: AosProvider;
  model: string;
  durationMs: number;
}

/* ---------- Pemakaian ---------- */

export interface AosUsageDTO {
  month: string;
  totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
  byDay: { day: string; calls: number; costUsd: number }[];
  byProvider: { provider: AosProvider; calls: number; costUsd: number; failed: number }[];
  byPurpose: { purpose: string; calls: number; costUsd: number }[];
  byModel: { model: string; calls: number; costUsd: number }[];
  answers: { made: number; used: number; up: number; down: number };
  offers: { made: number; answered: number; dismissed: number };
  /** Apa yang paling sering ditanyakan (dari deteksi awal). */
  topics: { topic: string; count: number }[];
  categories: { category: string; count: number }[];
}

/* ---------- Bentuk jawaban ---------- */

const section = (text: string, tag: string): { value: string | null; open: boolean } => {
  const start = text.indexOf(`<${tag}>`);
  if (start < 0) return { value: null, open: false };
  const from = start + tag.length + 2;
  const end = text.indexOf(`</${tag}>`, from);
  return end < 0 ? { value: text.slice(from).trim(), open: true } : { value: text.slice(from, end).trim(), open: false };
};

/** Semua kemunculan satu bagian bertanda, berurutan (draf boleh ditulis dalam beberapa bagian). */
const sections = (text: string, tag: string): string[] => {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(`<${tag}>`, from);
    if (start < 0) break;
    const body = start + tag.length + 2;
    const end = text.indexOf(`</${tag}>`, body);
    const value = (end < 0 ? text.slice(body) : text.slice(body, end)).trim();
    if (value) out.push(value);
    if (end < 0) break;
    from = end + tag.length + 3;
  }
  return out;
};

export interface ParsedAosAnswer {
  /** Dokumen HTML infografis apa adanya (belum disaring); null bila tidak ada atau belum selesai ditulis. */
  infographic: string | null;
  /** Bagian infografis sudah dibuka tetapi belum ditutup (masih ditulis). */
  infographicPending: boolean;
  /** Seluruh draf; bila model menulis beberapa bagian <draf>, digabung dengan baris kosong. */
  draft: string | null;
  /** Bagian-bagian <draf> apa adanya, berurutan. */
  draftParts: string[];
  notes: string | null;
  confidence: AosConfidence | null;
  /** Baris mentah di bagian sumber, mis. "P12 hlm 3" atau alamat web. */
  sourceLines: string[];
  /** Teks di luar bagian bertanda (jawaban bebas, mis. ringkasan chat). */
  plain: string | null;
}

/**
 * Jawaban AOS ditulis model dengan bagian bertanda: <draf>, <catatan>, <keyakinan>, <sumber>.
 * Dipakai server (hasil akhir) dan web (teks yang masih mengalir, jadi bagian yang belum ditutup tetap dibaca).
 */
export function parseAosAnswer(raw: string): ParsedAosAnswer {
  // Infografis dibaca dan dibuang lebih dulu: isinya HTML yang bisa memuat teks mirip tanda bagian lain.
  const info = section(raw, 'infografis');
  const start = raw.indexOf('<infografis>');
  const end = raw.indexOf('</infografis>', start);
  const text = start < 0 ? raw : raw.slice(0, start) + (end < 0 ? '' : raw.slice(end + '</infografis>'.length));
  const infographic = info.value && !info.open ? info.value : null;
  const draftParts = sections(text, 'draf');
  const draft = draftParts.join('\n\n');
  const notes = section(text, 'catatan').value;
  const conf = section(text, 'keyakinan').value?.toLowerCase() ?? '';
  const confidence = conf.includes('tinggi') ? 'tinggi' : conf.includes('sedang') ? 'sedang' : conf.includes('rendah') ? 'rendah' : null;
  const sourceLines = (section(text, 'sumber').value ?? '')
    .split('\n')
    .map((l) => l.replace(/^[-*•\s]+/, '').trim())
    .filter(Boolean);
  const plain =
    text
      .replace(/<(draf|catatan|keyakinan|sumber)>[\s\S]*?(<\/\1>|$)/g, '')
      .trim() || null;
  return { infographic, infographicPending: info.open, draft: draft || null, draftParts, notes: notes || null, confidence, sourceLines, plain };
}

/* ---------- Batas panjang pesan WhatsApp ---------- */

/** Batas aman satu pesan teks WhatsApp untuk draf AOS (batas Meta 4.096 karakter, disisakan sedikit). */
export const WA_PART_MAX = 4000;

/** Potong satu blok yang terlalu panjang: di batas baris, lalu kalimat, lalu kata. */
function splitBlock(block: string, max: number): string[] {
  if (block.length <= max) return [block];
  for (const sep of ['\n', '. ', ' ']) {
    const pieces = block.split(sep);
    if (pieces.length < 2) continue;
    const out: string[] = [];
    let cur = '';
    for (const [i, piece] of pieces.entries()) {
      const unit = i < pieces.length - 1 ? piece + sep : piece;
      if (cur && (cur + unit).length > max) {
        out.push(cur.trimEnd());
        cur = '';
      }
      cur += unit;
    }
    if (cur.trim()) out.push(cur.trimEnd());
    if (out.every((p) => p.length <= max)) return out;
    return out.flatMap((p) => splitBlock(p, max));
  }
  const out: string[] = [];
  for (let i = 0; i < block.length; i += max) out.push(block.slice(i, i + max));
  return out;
}

/**
 * Memecah teks menjadi beberapa pesan yang masing-masing muat di WhatsApp, utamakan di batas paragraf supaya tiap
 * bagian tetap utuh dibaca. Teks yang sudah muat dikembalikan apa adanya.
 */
export function splitForWhatsApp(text: string, max = WA_PART_MAX): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const out: string[] = [];
  let cur = '';
  for (const para of clean.split(/\n{2,}/)) {
    for (const piece of splitBlock(para, max)) {
      if (cur && cur.length + 2 + piece.length > max) {
        out.push(cur);
        cur = '';
      }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Bagian-bagian draf siap kirim: tiap <draf> dari model, dipecah lagi bila masih melewati batas. */
export function draftPartsForWhatsApp(parts: string[], max = WA_PART_MAX): string[] {
  return parts.flatMap((part) => splitForWhatsApp(part, max));
}

/* ---------- Infografis ---------- */

/** Lebar kanvas infografis (px); tingginya mengikuti isi. */
export const INFOGRAPHIC_WIDTH = 1080;
const INFOGRAPHIC_MAX_CHARS = 300_000;

/**
 * Menyaring HTML infografis buatan model sebelum disimpan. Lapis pertama saja: browser juga merendernya di iframe
 * tanpa izin skrip dan di bawah CSP aplikasi. Yang dibuang: skrip, elemen yang memuat atau menyematkan halaman lain,
 * atribut penangan event, dan semua alamat luar (http, https, //, javascript:), supaya isi chat tidak bisa dikirim
 * ke luar lewat gambar atau font. Gambar data: dan SVG di dalam dokumen tetap boleh.
 */
export function sanitizeInfographic(html: string | null | undefined): string | null {
  if (!html) return null;
  let out = html.trim();
  if (!out || out.length > INFOGRAPHIC_MAX_CHARS) return null;
  // Pagar kode Markdown yang kadang ikut ditulis model.
  out = out.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  out = out
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?>/gi, '')
    .replace(/<\/?(iframe|frame|frameset|object|embed|applet|link|meta|base|form|input|button|textarea|select|portal)\b[^>]*>/gi, '')
    .replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src|srcset|xlink:href|action|formaction|poster|background)\s*=\s*("\s*(?:https?:|\/\/|javascript:)[^"]*"|'\s*(?:https?:|\/\/|javascript:)[^']*'|(?:https?:|\/\/|javascript:)[^\s>]*)/gi, '$1=""')
    .replace(/url\(\s*(["']?)\s*(?:https?:|\/\/|javascript:)[^)]*\)/gi, 'none')
    .replace(/@import\b[^;]*;?/gi, '');
  return out.trim() || null;
}

/* ---------- Penyamaran data pribadi ---------- */

export interface MaskResult {
  text: string;
  /** Penanda → nilai asli, untuk dikembalikan di tampilan petugas. */
  map: Record<string, string>;
}

const MASK_PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // NPWP berformat 00.000.000.0-000.000 atau deretan 15–16 digit (NPWP/NIK), dengan pemisah opsional.
  { label: 'ID', re: /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[.\s]?\d[-.\s]?\d{3}[.\s]?\d{3}\b|\b\d{15,16}\b/g },
  { label: 'TELP', re: /(?<![\d])(?:\+?62|0)8\d{1,3}[-\s]?\d{3,4}[-\s]?\d{3,5}(?![\d])/g },
];

/** Mengganti NIK/NPWP, nomor telepon, dan email dengan penanda seperti [ID-1]. Nilai yang sama mendapat penanda yang sama. */
export function maskSensitive(text: string, map: Record<string, string> = {}): MaskResult {
  const byValue = new Map(Object.entries(map).map(([k, v]) => [v, k]));
  let out = text;
  for (const { label, re } of MASK_PATTERNS) {
    out = out.replace(re, (value) => {
      const known = byValue.get(value);
      if (known) return known;
      const n = Object.keys(map).filter((k) => k.startsWith(`[${label}-`)).length + 1;
      const token = `[${label}-${n}]`;
      map[token] = value;
      byValue.set(value, token);
      return token;
    });
  }
  return { text: out, map };
}

export function unmaskSensitive(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [token, value] of Object.entries(map)) out = out.split(token).join(value);
  return out;
}
