import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { media, messages } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import type { FastifyReply } from 'fastify';
import type { AppDeps, AppInstance } from '../../types';
import { requireUserHook } from '../auth/plugin';
import { requireAccount } from '../connection/service';
import { loadMessage, mediaDTO, type MediaRow } from '../conversations/dto';
import { downloadInboundMedia, mediaAbsolutePath, uploadOutboundMedia } from './service';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const downloadQuery = z.object({ download: z.string().optional() });
// Jenis yang aman ditampilkan langsung di browser; selain itu selalu diunduh sebagai lampiran.
const INLINE = /^(image\/(jpeg|png|webp|gif)|video\/(mp4|3gpp)|audio\/|application\/pdf$)/;

/** Kirim file media yang tersimpan; dipakai UI (sesi) dan API v1. */
export async function replyWithMedia(deps: AppDeps, reply: FastifyReply, row: MediaRow, forceDownload: boolean) {
  if (row.status !== 'ready' || !row.storagePath) {
    throw new AppError(404, 'media_unavailable', row.status === 'pending' ? 'Media masih diunduh.' : 'Media tidak tersedia.');
  }
  const file = mediaAbsolutePath(deps.config, row.storagePath);
  const info = await stat(file).catch(() => null);
  if (!info) throw new AppError(404, 'media_missing', 'File media sudah tidak ada di server.');
  const mime = row.mimeType ?? 'application/octet-stream';
  const name = row.fileName ?? row.storagePath.split('/').pop()!;
  reply
    .header('content-type', mime)
    .header('content-length', info.size)
    .header('cache-control', 'private, max-age=86400')
    // Isi media berasal dari pihak luar: jangan pernah dijalankan sebagai halaman di origin aplikasi.
    .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
    .header(
      'content-disposition',
      `${INLINE.test(mime) && !forceDownload ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  return reply.send(createReadStream(file));
}

export async function mediaRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preHandler', requireUserHook);

  app.get('/:id', { schema: { params: idParams, querystring: downloadQuery } }, async (req, reply) => {
    const [row] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);
    if (!row) throw notFound('Media');
    return replyWithMedia(deps, reply, row, !!req.query.download);
  });

  // Unggah lampiran untuk dikirim: multipart dengan satu field "file".
  app.post('/', async (req, reply) => {
    const file = await req.file().catch(() => undefined);
    if (!file) throw new AppError(400, 'file_required', 'Pilih file yang akan dikirim.');
    const data = await file.toBuffer().catch((err: { code?: string }) => {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(413, 'payload_too_large', `File melebihi ${deps.config.MAX_UPLOAD_MB} MB.`);
      throw err;
    });
    const row = await uploadOutboundMedia(deps, await requireAccount(deps), {
      data,
      mime: file.mimetype,
      fileName: file.filename || 'lampiran',
    });
    return reply.status(201).send({ media: mediaDTO(row) });
  });

  app.post('/:id/retry', { schema: { params: idParams } }, async (req) => {
    const [row] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);
    if (!row) throw notFound('Media');
    if (row.direction !== 'in') throw new AppError(400, 'not_inbound', 'Hanya media masuk yang bisa diunduh ulang.');
    const updated = await downloadInboundMedia(deps, await requireAccount(deps), row);
    const [msg] = await db.select({ id: messages.id }).from(messages).where(eq(messages.mediaId, row.id)).limit(1);
    if (msg) {
      const dto = await loadMessage(db, msg.id);
      if (dto) deps.bus.emit({ type: 'message.updated', message: dto });
    }
    return { media: mediaDTO(updated) };
  });
}
