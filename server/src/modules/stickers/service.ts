import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, ne, sql } from 'drizzle-orm';
import { STICKER_MAX_BYTES, STICKER_SIZE, type StickerDTO } from '@wa/shared';
import { media, messages, stickers } from '../../db/schema';
import { sha256Hex } from '../../lib/crypto';
import { AppError, notFound } from '../../lib/errors';
import type { AppDeps } from '../../types';
import { accountGraph, metaToAppError, noteTokenError, requireAccount } from '../connection/service';
import { mediaAbsolutePath } from '../media/service';
import type { OutboundSpec } from '../messages/service';

export type StickerRow = typeof stickers.$inferSelect;

// Media yang diunggah ke Meta berlaku 30 hari; unggah ulang sebelum itu.
const WA_MEDIA_TTL_MS = 25 * 24 * 60 * 60 * 1000;

export function stickerDTO(s: StickerRow): StickerDTO {
  return {
    id: String(s.id),
    url: `/api/stickers/${s.id}/file`,
    animated: s.animated,
    usageCount: s.usageCount,
    lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
  };
}

/** Baca ukuran dan status animasi dari header WebP (RIFF/VP8/VP8L/VP8X); null bila bukan WebP. */
export function parseWebp(data: Buffer): { width: number; height: number; animated: boolean } | null {
  if (data.length < 30 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = data.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      animated: (data[20]! & 0x02) !== 0,
      width: 1 + data.readUIntLE(24, 3),
      height: 1 + data.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ') {
    return { animated: false, width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = data.readUInt32LE(21);
    return { animated: false, width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return null;
}

/** Validasi sesuai aturan stiker WhatsApp lalu simpan ke koleksi bersama (duplikat dikenali dari isinya). */
export async function createSticker(deps: AppDeps, data: Buffer, userId: number | null): Promise<StickerRow> {
  const info = parseWebp(data);
  if (!info) throw new AppError(400, 'sticker_invalid', 'Stiker harus berformat WebP.');
  if (info.width !== STICKER_SIZE || info.height !== STICKER_SIZE) {
    throw new AppError(400, 'sticker_invalid', `Stiker harus berukuran ${STICKER_SIZE}×${STICKER_SIZE} piksel.`);
  }
  const max = info.animated ? STICKER_MAX_BYTES.animated : STICKER_MAX_BYTES.static;
  if (data.length > max) {
    throw new AppError(400, 'sticker_too_large', `Stiker ${info.animated ? 'animasi' : 'statis'} maksimal ${max / 1024} KB.`);
  }

  const { db } = deps.database;
  const sha = sha256Hex(data);
  const [existing] = await db.select().from(stickers).where(eq(stickers.sha256, sha)).limit(1);
  if (existing) return existing;

  const storagePath = path.posix.join('stickers', `${sha}.webp`);
  const abs = mediaAbsolutePath(deps.config, storagePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  const [res] = await db.insert(stickers).values({ sha256: sha, storagePath, fileSize: data.length, animated: info.animated, createdBy: userId });
  const [row] = await db.select().from(stickers).where(eq(stickers.id, res.insertId));
  return row!;
}

/** Simpan stiker dari pesan (mis. stiker kiriman warga) ke koleksi. */
export async function stickerFromMessage(deps: AppDeps, messageId: number, userId: number): Promise<StickerRow> {
  const { db } = deps.database;
  const [row] = await db
    .select({ type: messages.type, media })
    .from(messages)
    .innerJoin(media, eq(media.id, messages.mediaId))
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!row || row.type !== 'sticker') throw notFound('Stiker');
  if (row.media.status !== 'ready' || !row.media.storagePath) throw new AppError(409, 'media_unavailable', 'File stiker belum tersedia.');
  const data = await readFile(mediaAbsolutePath(deps.config, row.media.storagePath));
  return createSticker(deps, data, userId);
}

/** ID media Meta untuk stiker; diunggah ulang bila belum ada atau hampir kedaluwarsa. */
async function ensureUploaded(deps: AppDeps, sticker: StickerRow): Promise<string> {
  if (sticker.waMediaId && sticker.waMediaUploadedAt && Date.now() - sticker.waMediaUploadedAt.getTime() < WA_MEDIA_TTL_MS) {
    return sticker.waMediaId;
  }
  const account = await requireAccount(deps);
  const data = await readFile(mediaAbsolutePath(deps.config, sticker.storagePath));
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/webp');
  form.append('file', new Blob([new Uint8Array(data)], { type: 'image/webp' }), 'sticker.webp');
  let waMediaId: string;
  try {
    waMediaId = (await accountGraph(deps, account).post<{ id: string }>(`${account.phoneNumberId}/media`, form)).id;
  } catch (err) {
    await noteTokenError(deps, account, err);
    throw metaToAppError(err);
  }
  await deps.database.db.update(stickers).set({ waMediaId, waMediaUploadedAt: new Date() }).where(eq(stickers.id, sticker.id));
  return waMediaId;
}

/** Bentuk pesan stiker. Baris media memakai file koleksi yang sama agar gelembung chat bisa menampilkannya. */
export async function stickerSpec(deps: AppDeps, stickerId: number): Promise<OutboundSpec> {
  const { db } = deps.database;
  const [sticker] = await db.select().from(stickers).where(eq(stickers.id, stickerId)).limit(1);
  if (!sticker) throw notFound('Stiker');
  const waMediaId = await ensureUploaded(deps, sticker);
  const [res] = await db.insert(media).values({
    waMediaId,
    direction: 'out',
    mimeType: 'image/webp',
    fileName: 'stiker.webp',
    fileSize: sticker.fileSize,
    sha256: sticker.sha256,
    storagePath: sticker.storagePath,
    status: 'ready',
  });
  await db
    .update(stickers)
    .set({ usageCount: sql`${stickers.usageCount} + 1`, lastUsedAt: new Date() })
    .where(eq(stickers.id, sticker.id));
  deps.bus.emit({ type: 'library.updated', resource: 'stickers' });
  return {
    type: 'sticker',
    text: null,
    mediaId: res.insertId,
    graph: { type: 'sticker', sticker: { id: waMediaId } },
    requiresWindow: true,
  };
}

/** Hapus dari koleksi. File tetap disimpan bila masih dipakai pesan yang pernah terkirim. */
export async function deleteSticker(deps: AppDeps, stickerId: number): Promise<void> {
  const { db } = deps.database;
  const [sticker] = await db.select().from(stickers).where(eq(stickers.id, stickerId)).limit(1);
  if (!sticker) throw notFound('Stiker');
  await db.delete(stickers).where(eq(stickers.id, sticker.id));
  const [used] = await db
    .select({ id: media.id })
    .from(media)
    .where(and(eq(media.storagePath, sticker.storagePath), ne(media.status, 'expired')))
    .limit(1);
  if (!used) await unlink(mediaAbsolutePath(deps.config, sticker.storagePath)).catch(() => undefined);
}
