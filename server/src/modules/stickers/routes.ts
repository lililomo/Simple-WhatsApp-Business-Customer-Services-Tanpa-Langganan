import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { codeToEmoji, emojiToCode, emojiUsageBody } from '@wa/shared';
import { emojiUsage, stickers } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireUser, requireUserHook } from '../auth/plugin';
import { mediaAbsolutePath } from '../media/service';
import { createSticker, deleteSticker, stickerDTO, stickerFromMessage } from './service';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const RECENT_EMOJI = 32;

/** Koleksi stiker bersama. */
export async function stickerRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);
  const changed = () => deps.bus.emit({ type: 'library.updated', resource: 'stickers' });

  app.get('/', async () => {
    const rows = await db.select().from(stickers).orderBy(desc(stickers.id));
    return { stickers: rows.map(stickerDTO) };
  });

  // Unggah stiker buatan sendiri: WebP 512×512 hasil crop di browser.
  app.post('/', async (req, reply) => {
    requireUser(req);
    const file = await req.file().catch(() => undefined);
    if (!file) throw new AppError(400, 'file_required', 'Pilih gambar untuk stiker.');
    const row = await createSticker(deps, await file.toBuffer(), req.user.id);
    await audit(db, { actorUserId: req.user.id, action: 'sticker.create', targetType: 'sticker', targetId: row.id, ip: req.ip });
    changed();
    return reply.status(201).send({ sticker: stickerDTO(row) });
  });

  app.post('/from-message/:id', { schema: { params: idParams } }, async (req, reply) => {
    requireUser(req);
    const row = await stickerFromMessage(deps, req.params.id, req.user.id);
    changed();
    return reply.status(201).send({ sticker: stickerDTO(row) });
  });

  app.delete('/:id', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    await deleteSticker(deps, req.params.id);
    await audit(db, { actorUserId: req.user.id, action: 'sticker.delete', targetType: 'sticker', targetId: req.params.id, ip: req.ip });
    changed();
    return { ok: true };
  });

  app.get('/:id/file', { schema: { params: idParams } }, async (req, reply) => {
    const [row] = await db.select().from(stickers).where(eq(stickers.id, req.params.id)).limit(1);
    if (!row) throw notFound('Stiker');
    const file = mediaAbsolutePath(deps.config, row.storagePath);
    const info = await stat(file).catch(() => null);
    if (!info) throw new AppError(404, 'media_missing', 'File stiker sudah tidak ada di server.');
    return reply
      .header('content-type', 'image/webp')
      .header('content-length', info.size)
      // Nama file = hash isinya, jadi aman di-cache lama.
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-security-policy', "sandbox; default-src 'none'")
      .send(createReadStream(file));
  });
}

/** Riwayat emoji bersama semua petugas. */
export async function emojiRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);

  app.get('/recent', async () => {
    // Urutan: yang terakhir dipakai, dengan frekuensi sebagai penentu bila waktunya berdekatan.
    const rows = await db.select().from(emojiUsage).orderBy(desc(emojiUsage.lastUsedAt), desc(emojiUsage.usageCount)).limit(RECENT_EMOJI);
    return { emojis: rows.map((r) => codeToEmoji(r.code)) };
  });

  app.post('/usage', { schema: { body: emojiUsageBody } }, async (req) => {
    const now = new Date();
    for (const emoji of new Set(req.body.emojis)) {
      const code = emojiToCode(emoji);
      if (code.length > 64) continue;
      await db
        .insert(emojiUsage)
        .values({ code, usageCount: 1, lastUsedAt: now })
        .onDuplicateKeyUpdate({ set: { usageCount: sql`${emojiUsage.usageCount} + 1`, lastUsedAt: now } });
    }
    deps.bus.emit({ type: 'library.updated', resource: 'emoji' });
    return { ok: true };
  });
}
