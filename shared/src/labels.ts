import { z } from 'zod';

export interface LabelDTO {
  id: string;
  name: string;
  /** Warna latar "#RRGGBB". */
  color: string;
}

export interface LabelWithUsageDTO extends LabelDTO {
  /** Jumlah kontak yang memakai label ini. */
  contactCount: number;
}

export const LABEL_NAME_MAX = 40;

/** Pilihan warna siap pakai di pengaturan label; warna lain bisa dipilih bebas. */
export const LABEL_COLORS = [
  '#2563EB', // biru
  '#16A34A', // hijau
  '#DC2626', // merah
  '#EA580C', // oranye
  '#CA8A04', // kuning tua
  '#9333EA', // ungu
  '#DB2777', // merah muda
  '#0891B2', // sian
  '#0D9488', // hijau toska
  '#4F46E5', // nila
  '#92400E', // cokelat
  '#475569', // abu-abu
] as const;

export const labelBody = z.object({
  name: z.string().trim().min(1, 'Nama label wajib diisi.').max(LABEL_NAME_MAX),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Warna harus berformat #RRGGBB.')
    .transform((c) => c.toUpperCase()),
});
export type LabelBody = z.infer<typeof labelBody>;

/** Warna teks yang tetap terbaca di atas warna label (luminans relatif WCAG). */
export function labelTextColor(hex: string): string {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  // Titik potong kontras sama terhadap putih dan navy gelap tema (#131B44).
  return luminance > 0.2 ? '#131B44' : '#FFFFFF';
}
