import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { KB_EXTENSIONS, KB_MAX_FILE_MB } from '@wa/shared';

const MB = 1024 * 1024;
export const TAG_MAX_LENGTH = 40;
export const TAGS_MAX = 10;

const decimal = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 1 });

/** Ukuran berkas ringkas: "320 KB", "1,4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${decimal(bytes / MB)} MB`;
}

/** Angka MB untuk baris kuota ("12,3 MB dari 1.024 MB"). */
export function formatMb(bytes: number): string {
  return decimal(bytes / MB);
}

/** Jenis berkas yang bisa dibaca, untuk pesan ke petugas: "PDF, DOCX, …". */
export const KB_TYPES_LABEL = KB_EXTENSIONS.filter((e) => e !== 'jpeg')
  .map((e) => e.toUpperCase())
  .join(', ');

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Cek di browser sebelum mengunggah. Mengembalikan pesan penolakan, atau null bila berkas boleh diunggah. */
export function checkFile(file: { name: string; size: number }): string | null {
  const ext = fileExtension(file.name);
  if (!(KB_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Jenis berkas ${ext ? `.${ext}` : 'ini'} tidak didukung. Yang bisa dibaca: ${KB_TYPES_LABEL}.`;
  }
  if (file.size === 0) return 'Berkas kosong.';
  if (file.size > KB_MAX_FILE_MB * MB) {
    return `Ukuran ${formatBytes(file.size)} melebihi batas ${KB_MAX_FILE_MB} MB per berkas.`;
  }
  return null;
}

/** Tanggal hari ini di WIB sebagai "YYYY-MM-DD" (kedaluwarsa dihitung server dengan zona waktu kantor). */
export function todayWib(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Dokumen masih dipakai sampai akhir tanggal `validUntil`; lewat setelah hari itu berganti. */
export function isExpired(validUntil: string | null, today = todayWib()): boolean {
  return validUntil !== null && validUntil < today;
}

/** "2026-12-31" → "31 Des 2026". */
export function formatDay(date: string): string {
  return format(new Date(`${date}T00:00:00`), 'd MMM yyyy', { locale: id });
}

/** Pecah teks berpemisah koma menjadi tag. */
export function splitTags(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim().slice(0, TAG_MAX_LENGTH).trim())
    .filter(Boolean);
}

/** Gabungkan tag baru ke daftar: tanpa kembaran (huruf besar/kecil diabaikan), maksimal TAGS_MAX. */
export function addTags(current: string[], incoming: string[]): string[] {
  const out = [...current];
  for (const tag of incoming) {
    if (out.length >= TAGS_MAX) break;
    if (!out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}
