/**
 * Data emoji dari emojibase (dimuat hanya saat panel emoji pertama kali dibuka). Label/tag Inggris dan Melayu
 * dipakai untuk pencarian, karena kosakata Melayu dekat dengan bahasa Indonesia ("kucing", "hati", "senyum").
 */
export interface EmojiItem {
  emoji: string;
  label: string;
  /** Teks pencarian (huruf kecil): label + tag Inggris dan Melayu. */
  search: string;
  group: number;
}

export interface EmojiCategory {
  id: string;
  label: string;
  groups: number[];
}

// Urutan dan nama kategori mengikuti WhatsApp. Grup emojibase: 0 smileys, 1 orang, 3 hewan, 4 makanan,
// 5 tempat, 6 aktivitas, 7 objek, 8 simbol, 9 bendera (2 = komponen, tidak ditampilkan).
export const EMOJI_CATEGORIES: EmojiCategory[] = [
  { id: 'smileys', label: 'Smiley & orang', groups: [0, 1] },
  { id: 'animals', label: 'Hewan & alam', groups: [3] },
  { id: 'food', label: 'Makanan & minuman', groups: [4] },
  { id: 'activity', label: 'Aktivitas', groups: [6] },
  { id: 'travel', label: 'Perjalanan & tempat', groups: [5] },
  { id: 'objects', label: 'Objek', groups: [7] },
  { id: 'symbols', label: 'Simbol', groups: [8] },
  { id: 'flags', label: 'Bendera', groups: [9] },
];

// Emoji yang lebih baru dari ini belum tentu tampil di Windows 10/11 (muncul kotak kosong).
const MAX_VERSION = 15;

interface RawEmoji {
  label: string;
  hexcode: string;
  emoji: string;
  tags?: string[];
  group?: number;
  order?: number;
  version?: number;
}

interface RawCompact {
  hexcode: string;
  label: string;
  tags?: string[];
}

let cache: Promise<EmojiItem[]> | null = null;

export function loadEmojis(): Promise<EmojiItem[]> {
  cache ??= (async () => {
    const [en, ms] = await Promise.all([
      import('emojibase-data/en/data.json').then((m) => m.default as unknown as RawEmoji[]),
      import('emojibase-data/ms/compact.json').then((m) => m.default as unknown as RawCompact[]),
    ]);
    const malay = new Map(ms.map((e) => [e.hexcode, e]));
    return en
      .filter((e) => e.group !== undefined && e.group !== 2 && (e.version ?? 0) <= MAX_VERSION)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => {
        const m = malay.get(e.hexcode);
        return {
          emoji: e.emoji,
          label: m?.label ?? e.label,
          search: [e.label, ...(e.tags ?? []), m?.label ?? '', ...(m?.tags ?? [])].join(' ').toLowerCase(),
          group: e.group!,
        };
      });
  })();
  return cache;
}

/** Semua emoji di dalam teks (dipakai untuk mencatat riwayat emoji saat pesan dikirim). */
export function extractEmojis(text: string): string[] {
  return text.match(/\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic}️?)*|\p{Regional_Indicator}{2}/gu) ?? [];
}
