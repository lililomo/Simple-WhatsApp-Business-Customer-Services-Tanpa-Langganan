import { z } from 'zod';
import { TEXT_MAX } from './send';

/** Balasan cepat lokal: teks siap pakai yang disisipkan ke kotak balas (bukan template Meta). */
export const quickReplyBody = z.object({
  title: z.string().trim().min(1, 'Judul wajib diisi').max(100),
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{1,40}$/, 'Pintasan hanya huruf, angka, - dan _ (tanpa spasi)')
    .nullish()
    .or(z.literal('').transform(() => null)),
  body: z.string().trim().min(1, 'Isi wajib diisi').max(TEXT_MAX),
});
export type QuickReplyBody = z.infer<typeof quickReplyBody>;

export interface QuickReplyDTO {
  id: string;
  title: string;
  shortcut: string | null;
  body: string;
  usageCount: number;
  lastUsedAt: string | null;
  updatedAt: string;
}

/** Variabel yang bisa dipakai di balasan cepat dan balasan otomatis. */
export const TEXT_VARIABLES = [
  { key: 'salam', label: 'Selamat pagi/siang/sore/malam (WIB)' },
  { key: 'nama', label: 'Nama kontak' },
  { key: 'petugas', label: 'Nama petugas yang membalas' },
] as const;

/** Salam sesuai jam di WIB. */
export function greetingFor(date: Date, timeZone = 'Asia/Jakarta'): string {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(date));
  if (hour < 11) return 'Selamat pagi';
  if (hour < 15) return 'Selamat siang';
  if (hour < 18) return 'Selamat sore';
  return 'Selamat malam';
}

/** Ganti {salam}, {nama}, {petugas}, dst. Variabel yang tidak diketahui dibiarkan apa adanya. */
export function fillVariables(text: string, values: Record<string, string | null | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => values[key.toLowerCase()] ?? match);
}

/** Batas Meta untuk stiker: WebP 512×512, statis maks 100 KB, animasi maks 500 KB. */
export const STICKER_SIZE = 512;
export const STICKER_MAX_BYTES = { static: 100 * 1024, animated: 500 * 1024 };

export interface StickerDTO {
  id: string;
  url: string;
  animated: boolean;
  usageCount: number;
  lastUsedAt: string | null;
}

/** Riwayat emoji bersama: daftar emoji, paling baru/sering di depan. */
export interface RecentEmojiDTO {
  emojis: string[];
}

export const emojiUsageBody = z.object({ emojis: z.array(z.string().min(1).max(32)).min(1).max(50) });

/** Emoji ⇄ kode titik heksadesimal ("👍" ⇄ "1f44d"); dipakai sebagai kunci penyimpanan. */
export function emojiToCode(emoji: string): string {
  return [...emoji].map((c) => c.codePointAt(0)!.toString(16)).join('-');
}

export function codeToEmoji(code: string): string {
  return String.fromCodePoint(...code.split('-').map((h) => parseInt(h, 16)));
}
