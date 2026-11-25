import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { z } from 'zod';
import { kbListQuery, kbNoteBody, kbUpdateBody, type KbListDTO } from '@wa/shared';
import { AppError, notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireUser, requireUserHook } from '../auth/plugin';
import { mediaAbsolutePath } from '../media/service';
import {
  createNote,
  fileTooLarge,
  getDocument,
  KB_MAX_FILE_BYTES,
  listKnowledge,
  reprocessDocument,
  restoreDocument,
  trashDocument,
  updateDocument,
  uploadDocument,
} from './service';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const downloadQuery = z.object({ download: z.string().optional() });
// Jenis yang aman dibuka langsung di browser; selain itu selalu diunduh sebagai lampiran.
const INLINE = /^(image\/(jpeg|png)|application\/pdf|text\/plain)$/;

/** Pustaka: berkas dan catatan rujukan bersama. Semua petugas boleh mengunggah, mengubah, dan menghapus. */
export async function knowledgeRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);

  app.get('/', { schema: { querystring: kbListQuery } }, async (req): Promise<KbListDTO> => listKnowledge(deps, req.query));

  // Unggah berkas: multipart dengan satu field "file". Isinya diproses di latar oleh KnowledgeWorker.
  app.post('/', async (req, reply) => {
    requireUser(req);
    const file = await req.file({ limits: { fileSize: KB_MAX_FILE_BYTES } }).catch(() => undefined);
    if (!file) throw new AppError(400, 'file_required', 'Pilih berkas yang akan diunggah.');
    const data = await file.toBuffer().catch((err: { code?: string }) => {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw fileTooLarge();
      throw err;
    });
    const { document, restored } = await uploadDocument(deps, { data, fileName: file.filename ?? '' }, req.user.id);
    await audit(db, {
      actorUserId: req.user.id,
      // Berkas yang sama masih ada di tempat sampah: baris lamanya dipulihkan, bukan dibuat baru.
      action: restored ? 'knowledge.restore' : 'knowledge.upload',
      targetType: 'knowledge',
      targetId: document.id,
      meta: { title: document.title, fileName: document.fileName, fileSize: document.fileSize, ...(restored ? { via: 'upload' } : {}) },
      ip: req.ip,
    });
    return reply.status(201).send({ document });
  });

  app.post('/notes', { schema: { body: kbNoteBody } }, async (req, reply) => {
    requireUser(req);
    const document = await createNote(deps, req.body, req.user.id);
    await audit(db, {
      actorUserId: req.user.id,
      action: 'knowledge.note',
      targetType: 'knowledge',
      targetId: document.id,
      meta: { title: document.title },
      ip: req.ip,
    });
    return reply.status(201).send({ document });
  });

  app.patch('/:id', { schema: { params: idParams, body: kbUpdateBody } }, async (req) => {
    requireUser(req);
    const document = await updateDocument(deps, req.params.id, req.body);
    await audit(db, {
      actorUserId: req.user.id,
      action: 'knowledge.update',
      targetType: 'knowledge',
      targetId: document.id,
      meta: req.body,
      ip: req.ip,
    });
    return { document };
  });

  // Hapus = pindah ke tempat sampah; berkas dan isinya baru dibuang housekeeping setelah 30 hari.
  app.delete('/:id', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const row = await trashDocument(deps, req.params.id, req.user.id);
    if (row) {
      await audit(db, {
        actorUserId: req.user.id,
        action: 'knowledge.delete',
        targetType: 'knowledge',
        targetId: row.id,
        meta: { title: row.title },
        ip: req.ip,
      });
    }
    return { ok: true };
  });

  app.post('/:id/restore', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const document = await restoreDocument(deps, req.params.id);
    await audit(db, {
      actorUserId: req.user.id,
      action: 'knowledge.restore',
      targetType: 'knowledge',
      targetId: document.id,
      meta: { title: document.title },
      ip: req.ip,
    });
    return { document };
  });

  app.post('/:id/reprocess', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const document = await reprocessDocument(deps, req.params.id);
    await audit(db, {
      actorUserId: req.user.id,
      action: 'knowledge.reprocess',
      targetType: 'knowledge',
      targetId: document.id,
      meta: { title: document.title },
      ip: req.ip,
    });
    return { document };
  });

  // Berkas asli. `?download=1` memaksa unduh; tanpa itu PDF, gambar, dan teks polos dibuka di browser.
  app.get('/:id/file', { schema: { params: idParams, querystring: downloadQuery } }, async (req, reply) => {
    const row = await getDocument(db, req.params.id);
    if (row.kind !== 'file' || !row.storagePath) throw notFound('Berkas');
    const file = mediaAbsolutePath(deps.config, row.storagePath);
    const info = await stat(file).catch(() => null);
    if (!info) throw new AppError(404, 'file_missing', 'Berkas aslinya sudah tidak ada di server.');
    const mime = row.mimeType ?? 'application/octet-stream';
    const name = row.fileName ?? row.storagePath.split('/').pop()!;
    return (
      reply
        .header('content-type', mime.startsWith('text/') ? `${mime}; charset=utf-8` : mime)
        .header('content-length', info.size)
        .header('cache-control', 'private, max-age=3600')
        // Isi berkas unggahan tidak pernah dijalankan sebagai halaman di origin aplikasi.
        .header('content-security-policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'")
        .header(
          'content-disposition',
          `${INLINE.test(mime) && !req.query.download ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        )
        .send(createReadStream(file))
    );
  });
}
