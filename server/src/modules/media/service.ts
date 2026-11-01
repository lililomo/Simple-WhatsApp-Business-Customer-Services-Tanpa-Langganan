import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { DOCUMENT_MIMES, MEDIA_LIMITS, mediaKindFor } from '@wa/shared';
import { media } from '../../db/schema';
import { sha256Hex } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import type { Config } from '../../config';
import type { AppDeps } from '../../types';
import { accountGraph, metaToAppError, noteTokenError, type WaAccount } from '../connection/service';
import type { MediaRow } from '../conversations/dto';

const EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

export function baseMime(mime: string | null | undefined): string | null {
  return mime ? mime.split(';')[0]!.trim().toLowerCase() : null;
}

export function extensionFor(mime: string | null | undefined, fileName?: string | null): string {
  const fromName = fileName ? path.extname(fileName).toLowerCase() : '';
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return EXT[baseMime(mime) ?? ''] ?? '.bin';
}

export function mediaAbsolutePath(config: Config, storagePath: string): string {
  return path.resolve(config.STORAGE_DIR, storagePath);
}

/** Simpan isi file media ke STORAGE_DIR/media/YYYY/MM/<sha256><ext>; kembalikan path relatif. */
export async function storeMediaFile(config: Config, data: Buffer, mime: string | null, fileName?: string | null) {
  const sha = sha256Hex(data);
  const now = new Date();
  const rel = path.posix.join(
    'media',
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    `${sha}${extensionFor(mime, fileName)}`,
  );
  const abs = mediaAbsolutePath(config, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return { storagePath: rel, sha256: sha, fileSize: data.length };
}

/**
 * Validasi file sesuai batas Meta, simpan salinan lokal, lalu unggah ke Meta (POST /{phone}/media).
 * Mengembalikan baris media keluar yang siap dikirim.
 */
export async function uploadOutboundMedia(
  deps: AppDeps,
  account: WaAccount,
  file: { data: Buffer; mime: string; fileName: string },
): Promise<MediaRow> {
  const mime = baseMime(file.mime) ?? 'application/octet-stream';
  const kind = mediaKindFor(mime);
  if (kind === 'document' && !DOCUMENT_MIMES.includes(mime)) {
    throw new AppError(400, 'unsupported_media', `Jenis file ${mime} tidak didukung WhatsApp. Kirim sebagai PDF, dokumen Office, atau gambar JPG/PNG.`);
  }
  const limit = MEDIA_LIMITS[kind];
  if (file.data.length > limit.maxBytes) {
    throw new AppError(400, 'media_too_large', `File terlalu besar. Batas WhatsApp: ${limit.label}.`);
  }
  if (file.data.length === 0) throw new AppError(400, 'media_empty', 'File kosong.');

  const stored = await storeMediaFile(deps.config, file.data, mime, file.fileName);
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([new Uint8Array(file.data)], { type: mime }), file.fileName);
  let waMediaId: string;
  try {
    const res = await accountGraph(deps, account).post<{ id: string }>(`${account.phoneNumberId}/media`, form);
    waMediaId = res.id;
  } catch (err) {
    await noteTokenError(deps, account, err);
    throw metaToAppError(err);
  }
  const { db } = deps.database;
  const [res] = await db.insert(media).values({
    waMediaId,
    direction: 'out',
    mimeType: mime,
    fileName: file.fileName.slice(0, 255),
    status: 'ready',
    ...stored,
  });
  const [row] = await db.select().from(media).where(eq(media.id, res.insertId));
  return row!;
}

/** Unduh media masuk dari Meta. URL dari Meta hanya berlaku beberapa menit, jadi dijalankan segera. */
export async function downloadInboundMedia(deps: AppDeps, account: WaAccount, row: MediaRow): Promise<MediaRow> {
  const { db } = deps.database;
  try {
    if (!row.waMediaId) throw new Error('ID media Meta kosong');
    const graph = accountGraph(deps, account);
    const info = await graph.get<{ url: string; mime_type?: string }>(row.waMediaId);
    const { data, contentType } = await graph.download(info.url);
    const mime = baseMime(info.mime_type ?? row.mimeType ?? contentType);
    const stored = await storeMediaFile(deps.config, data, mime, row.fileName);
    await db
      .update(media)
      .set({ status: 'ready', mimeType: mime, error: null, ...stored })
      .where(eq(media.id, row.id));
  } catch (err) {
    await noteTokenError(deps, account, err);
    const message = err instanceof Error ? metaToAppError(err).message : 'Gagal mengunduh media';
    await db.update(media).set({ status: 'failed', error: message }).where(eq(media.id, row.id));
  }
  const [updated] = await db.select().from(media).where(eq(media.id, row.id));
  return updated!;
}
