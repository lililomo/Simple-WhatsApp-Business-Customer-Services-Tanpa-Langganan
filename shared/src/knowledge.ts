import { z } from 'zod';

/** Pustaka AOS: berkas dan catatan rujukan bersama yang dibaca AOS. Lihat SPEC §19. */

export const KB_MAX_FILE_MB = 25;
export const KB_QUOTA_MB = 1024;
/** Jenis berkas yang isinya bisa dibaca. */
export const KB_EXTENSIONS = ['pdf', 'docx', 'pptx', 'txt', 'md', 'csv', 'jpg', 'jpeg', 'png'] as const;
export const KB_ACCEPT = KB_EXTENSIONS.map((e) => `.${e}`).join(',');

export type KbStatus = 'processing' | 'ready' | 'failed';

export interface KbDocumentDTO {
  id: string;
  kind: 'file' | 'note';
  title: string;
  description: string | null;
  tags: string[];
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  status: KbStatus;
  error: string | null;
  pageCount: number | null;
  charCount: number | null;
  summary: string | null;
  /** Dipakai AOS atau tidak. */
  isActive: boolean;
  /** Ditandai sebagai sumber resmi (diutamakan AOS). */
  isOfficial: boolean;
  /** Tanggal kedaluwarsa "YYYY-MM-DD"; setelah lewat tidak dipakai AOS. */
  validUntil: string | null;
  uploadedBy: { id: string; name: string } | null;
  createdAt: string;
  deletedAt: string | null;
  deletedBy: { id: string; name: string } | null;
  /** Alamat unduh berkas asli; null untuk catatan. */
  fileUrl: string | null;
}

export interface KbListDTO {
  documents: KbDocumentDTO[];
  /** Semua tag yang dipakai, untuk saringan. */
  tags: string[];
  totalBytes: number;
  quotaBytes: number;
}

const tags = z.array(z.string().trim().min(1).max(40)).max(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal: YYYY-MM-DD');

export const kbListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  tag: z.string().trim().max(40).optional(),
  /** "1" = tampilkan tempat sampah. */
  trash: z.enum(['0', '1']).optional(),
});

export const kbNoteBody = z.object({
  title: z.string().trim().min(1, 'Judul wajib diisi').max(190),
  text: z.string().trim().min(1, 'Isi catatan wajib diisi').max(100_000),
  tags: tags.default([]),
});

export const kbUpdateBody = z.object({
  title: z.string().trim().min(1).max(190).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  tags: tags.optional(),
  isActive: z.boolean().optional(),
  isOfficial: z.boolean().optional(),
  validUntil: date.nullable().optional(),
});

/** Satu hasil pencarian Pustaka (dipakai alat cari_pustaka dan pratinjau di web). */
export interface KbSearchHit {
  documentId: string;
  title: string;
  page: number | null;
  heading: string | null;
  snippet: string;
  isOfficial: boolean;
}
