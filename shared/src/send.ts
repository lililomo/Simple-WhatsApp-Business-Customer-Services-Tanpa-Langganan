import { z } from 'zod';
import { templateParams } from './templates';

export const TEXT_MAX = 4096;
export const CAPTION_MAX = 1024;

const clientRef = z.string().trim().min(8).max(64);
const replyTo = z.string().regex(/^\d+$/).optional();

export const sendMessageBody = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().trim().min(1, 'Pesan kosong').max(TEXT_MAX, `Pesan maksimal ${TEXT_MAX} karakter`),
    replyTo,
    clientRef,
  }),
  z.object({
    type: z.literal('media'),
    mediaId: z.string().regex(/^\d+$/),
    caption: z.string().trim().max(CAPTION_MAX, `Keterangan maksimal ${CAPTION_MAX} karakter`).optional(),
    replyTo,
    clientRef,
  }),
  z.object({
    type: z.literal('template'),
    templateId: z.string().regex(/^\d+$/),
    params: templateParams.default({}),
    clientRef,
  }),
  z.object({
    type: z.literal('sticker'),
    stickerId: z.string().regex(/^\d+$/),
    replyTo,
    clientRef,
  }),
]);
export type SendMessageBody = z.infer<typeof sendMessageBody>;

export type OutboundMediaKind = 'image' | 'video' | 'audio' | 'document';

/** Batas Meta untuk media keluar (dokumentasi Cloud API "Supported media types"). */
export const MEDIA_LIMITS: Record<OutboundMediaKind, { mimes: string[] | null; maxBytes: number; label: string }> = {
  image: { mimes: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024, label: 'Gambar (JPG/PNG, maks 5 MB)' },
  video: { mimes: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024, label: 'Video (MP4/3GP, maks 16 MB)' },
  audio: {
    mimes: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
    maxBytes: 16 * 1024 * 1024,
    label: 'Audio (AAC/AMR/MP3/M4A/OGG, maks 16 MB)',
  },
  document: { mimes: null, maxBytes: 100 * 1024 * 1024, label: 'Dokumen (maks 100 MB)' },
};

/** Tentukan cara kirim berdasarkan MIME: gambar/video/audio yang didukung, selain itu dokumen. */
export function mediaKindFor(mime: string): OutboundMediaKind {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  for (const kind of ['image', 'video', 'audio'] as const) {
    if (MEDIA_LIMITS[kind].mimes!.includes(base)) return kind;
  }
  return 'document';
}

/**
 * Deretan 15–16 digit (boleh dengan titik/strip) seperti NIK atau NPWP; dipakai untuk mengingatkan petugas
 * sebelum mengirim. Nomor HP (10–13 digit) sengaja tidak ditandai karena sering muncul di percakapan.
 */
export function looksLikeSensitiveNumber(text: string): boolean {
  return /(?<![\d.-])\d(?:[.-]?\d){14,15}(?![\d])/.test(text);
}

/** Jenis dokumen yang diterima WhatsApp Cloud API. */
export const DOCUMENT_MIMES = [
  'text/plain',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
