import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import {
  AOS_MODELS,
  aosProvider,
  assistantSettings,
  type AosEffort,
  type AosProvider,
  type AssistantSettings,
} from '@wa/shared';

export const PROVIDERS: readonly AosProvider[] = aosProvider.options;
export const PROVIDER_NAME: Record<AosProvider, string> = {
  subscription: 'Langganan Claude',
  api: 'API Claude',
};
export const EFFORT_LABEL: Record<AosEffort, string> = {
  low: 'Rendah',
  medium: 'Sedang',
  high: 'Tinggi',
  xhigh: 'Sangat tinggi',
  max: 'Maksimal',
};

/** Urutan yang selalu memuat kedua jalur tanpa kembaran: pertama = utama, kedua = cadangan (sama seperti server). */
export function fullOrder(order: readonly AosProvider[]): AosProvider[] {
  return [...new Set([...order, ...PROVIDERS])];
}

export function normalizeSettings(settings: AssistantSettings): AssistantSettings {
  return { ...settings, order: fullOrder(settings.order) };
}

/** Perbandingan isi untuk nilai sederhana (objek, array, angka, teks); dipakai untuk tahu formulir berubah atau tidak. */
export function isEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.hasOwn(b, key) &&
      isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Pesan Indonesia per isian; pesan bawaan zod berbahasa Inggris. */
const FIELD_PROBLEM: Record<string, string> = {
  'answer.model': 'Pilih model jawaban.',
  'triage.model': 'Pilih model deteksi awal.',
  'triage.debounceSec': 'Jeda deteksi awal: isi bilangan bulat 2 sampai 60 detik.',
  'sources.domains': 'Daftar situs maksimal 40.',
  'sources.maxSearches': 'Maksimal pencarian internet: isi bilangan bulat 1 sampai 10.',
  'privacy.contextMessages': 'Jumlah pesan yang dibaca: isi bilangan bulat 5 sampai 100.',
  'style.officeProfile': 'Profil kantor maksimal 4.000 huruf.',
  'style.instructions': 'Instruksi tambahan maksimal 4.000 huruf.',
  'budget.monthlyUsd': 'Anggaran bulanan: isi angka 0 sampai 100.000.',
};

/** Periksa formulir dengan skema bersama. `data` adalah bentuk yang dikirim ke server bila tidak ada masalah. */
export function checkSettings(form: AssistantSettings): {
  data: AssistantSettings | null;
  problems: string[];
} {
  const parsed = assistantSettings.safeParse(form);
  if (parsed.success) return { data: parsed.data, problems: [] };
  const problems = parsed.error.issues.map((issue) => {
    const path = issue.path.join('.');
    if (issue.path[0] === 'sources' && issue.path[1] === 'domains' && typeof issue.path[2] === 'number') {
      return `Situs "${form.sources.domains[issue.path[2]] ?? ''}": ${issue.message}.`;
    }
    return FIELD_PROBLEM[path] ?? `Isian ${path} tidak valid.`;
  });
  return { data: null, problems: [...new Set(problems)] };
}

/**
 * Rapikan nama situs yang diketik admin (alamat lengkap boleh ditempel; protokol dan path dibuang), lalu periksa
 * dengan aturan yang sama dengan skema bersama.
 */
export function cleanDomain(input: string): { ok: true; value: string } | { ok: false; message: string } {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '');
  const parsed = assistantSettings.safeParse({ sources: { domains: [host] } });
  const value = parsed.success ? parsed.data.sources.domains[0] : undefined;
  return value ? { ok: true, value } : { ok: false, message: 'Tulis nama situs saja, mis. pajak.go.id' };
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Biaya dalam USD dengan dua desimal: "$12.34". */
export function formatUsd(amount: number): string {
  return usd.format(amount);
}

export function formatCount(n: number): string {
  return n.toLocaleString('id-ID');
}

/** Lama proses: "850 md" atau "12,3 dtk". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} md`;
  return `${(ms / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`;
}

export function modelLabel(modelId: string): string {
  return AOS_MODELS.find((m) => m.id === modelId)?.label ?? modelId;
}

/** Pilihan model untuk <select>; model tersimpan yang tidak ada di daftar tetap ditampilkan agar tidak berubah diam-diam. */
export function modelOptions(current: string): { value: string; label: string }[] {
  const options = AOS_MODELS.map((m) => ({ value: m.id as string, label: m.label as string }));
  return options.some((o) => o.value === current)
    ? options
    : [...options, { value: current, label: current }];
}

/** Bulan berjalan menurut WIB sebagai "YYYY-MM". */
export function currentMonthWib(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}`;
}

/** "2026-11" → "November 2026". */
export function formatMonth(month: string): string {
  return format(new Date(`${month}-01T00:00:00`), 'MMMM yyyy', { locale: id });
}
