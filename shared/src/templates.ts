import { z } from 'zod';

/** Komponen template seperti dikembalikan Meta (field yang dipakai). */
export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | string;
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | string;
  text?: string;
  buttons?: { type: string; text: string; url?: string; phone_number?: string }[];
  example?: unknown;
}

export interface TemplateVariables {
  /** Kunci variabel header teks ("1" atau nama), atau format media header. */
  header: { format: string; keys: string[] } | null;
  body: string[];
  /** Tombol URL dinamis: index tombol → kunci variabel. */
  buttons: { index: number; text: string; keys: string[] }[];
  named: boolean;
}

export interface TemplateDTO {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  qualityScore: string | null;
  rejectedReason: string | null;
  components: TemplateComponent[];
  variables: TemplateVariables;
  syncedAt: string;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function placeholderKeys(text: string | undefined): string[] {
  if (!text) return [];
  const keys: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) if (!keys.includes(m[1]!)) keys.push(m[1]!);
  // Variabel posisi diurutkan secara numerik ({{1}}, {{2}}, …).
  return keys.every((k) => /^\d+$/.test(k)) ? keys.sort((a, b) => Number(a) - Number(b)) : keys;
}

export function templateVariables(components: TemplateComponent[]): TemplateVariables {
  const header = components.find((c) => c.type === 'HEADER');
  const body = components.find((c) => c.type === 'BODY');
  const buttons = components.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  const bodyKeys = placeholderKeys(body?.text);
  const headerKeys = header?.format === 'TEXT' ? placeholderKeys(header.text) : [];
  return {
    header: header ? { format: header.format ?? 'TEXT', keys: headerKeys } : null,
    body: bodyKeys,
    buttons: buttons
      .map((b, index) => ({ index, text: b.text, keys: b.type === 'URL' ? placeholderKeys(b.url) : [] }))
      .filter((b) => b.keys.length > 0),
    named: [...bodyKeys, ...headerKeys].some((k) => !/^\d+$/.test(k)),
  };
}

export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, key: string) => values[key] ?? whole);
}

/** Teks template yang sudah diisi (header + body + footer) untuk disimpan/ditampilkan. */
export function renderTemplateText(components: TemplateComponent[], params: TemplateParams): string {
  const header = components.find((c) => c.type === 'HEADER');
  const body = components.find((c) => c.type === 'BODY');
  const footer = components.find((c) => c.type === 'FOOTER');
  return [
    header?.format === 'TEXT' && header.text ? `*${fillPlaceholders(header.text, params.header ?? {})}*` : null,
    body?.text ? fillPlaceholders(body.text, params.body ?? {}) : null,
    footer?.text ? `_${footer.text}_` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export const templateParams = z.object({
  header: z.record(z.string(), z.string().trim().min(1).max(60)).optional(),
  body: z.record(z.string(), z.string().trim().min(1, 'Variabel tidak boleh kosong').max(1024)).optional(),
  buttons: z.record(z.string(), z.string().trim().min(1).max(200)).optional(),
  /** Media header (gambar/video/dokumen) yang diunggah lewat POST /api/media. */
  headerMediaId: z.string().regex(/^\d+$/).optional(),
});
export type TemplateParams = z.infer<typeof templateParams>;

export const startConversationBody = z.object({
  phone: z.string().trim().min(8, 'Nomor tidak valid').max(24),
  templateId: z.string().regex(/^\d+$/),
  params: templateParams.default({}),
  clientRef: z.string().trim().min(8).max(64),
});

/** Ubah nomor yang diketik (08…, +62 …, 8…) menjadi format WhatsApp (628…). null jika tidak valid. */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export const CATEGORY_LABEL: Record<string, { label: string; hint: string }> = {
  MARKETING: { label: 'Marketing', hint: 'Tarif tertinggi (±Rp586/pesan)' },
  UTILITY: { label: 'Utility', hint: '±Rp357/pesan' },
  AUTHENTICATION: { label: 'Authentication', hint: '±Rp357/pesan' },
};
