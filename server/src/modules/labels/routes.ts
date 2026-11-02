import { asc, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { labelBody, type LabelWithUsageDTO } from '@wa/shared';
import { contactLabels, labels } from '../../db/schema';
import { AppError, isDuplicateKey, notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireUser, requireUserHook } from '../auth/plugin';
import { labelDTO } from './service';

const idParams = z.object({ id: z.coerce.number().int().positive() });

/** Batas wajar agar menu label tetap ringkas. */
const MAX_LABELS = 50;

const nameTaken = (err: unknown) =>
  isDuplicateKey(err) ? new AppError(409, 'label_taken', 'Nama label itu sudah dipakai.') : err;

/** Jenis label bersama: semua petugas bisa menambah, mengubah nama/warna, dan menghapusnya. */
export async function labelRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);
  // Nama/warna label tampil di daftar chat, jadi browser juga memuat ulang percakapan (lihat useRealtime).
  const changed = () => deps.bus.emit({ type: 'library.updated', resource: 'labels' });

  app.get('/', async (): Promise<{ labels: LabelWithUsageDTO[] }> => {
    const rows = await db
      .select({ label: labels, contactCount: count(contactLabels.contactId) })
      .from(labels)
      .leftJoin(contactLabels, eq(contactLabels.labelId, labels.id))
      .groupBy(labels.id)
      .orderBy(asc(labels.id));
    return { labels: rows.map((r) => ({ ...labelDTO(r.label), contactCount: Number(r.contactCount) })) };
  });

  app.post('/', { schema: { body: labelBody } }, async (req, reply) => {
    requireUser(req);
    if ((await db.$count(labels)) >= MAX_LABELS) {
      throw new AppError(
        409,
        'label_limit',
        `Maksimal ${MAX_LABELS} label. Hapus label yang tidak dipakai lagi.`,
      );
    }
    const [res] = await db
      .insert(labels)
      .values({ ...req.body, createdBy: req.user.id, updatedBy: req.user.id })
      .catch((err: unknown) => {
        throw nameTaken(err);
      });
    await audit(db, {
      actorUserId: req.user.id,
      action: 'label.create',
      targetType: 'label',
      targetId: res.insertId,
      meta: req.body,
      ip: req.ip,
    });
    changed();
    const [row] = await db.select().from(labels).where(eq(labels.id, res.insertId));
    return reply.status(201).send({ label: labelDTO(row!) });
  });

  app.put('/:id', { schema: { params: idParams, body: labelBody } }, async (req) => {
    requireUser(req);
    const [res] = await db
      .update(labels)
      .set({ ...req.body, updatedBy: req.user.id })
      .where(eq(labels.id, req.params.id))
      .catch((err: unknown) => {
        throw nameTaken(err);
      });
    if (res.affectedRows === 0) throw notFound('Label');
    await audit(db, {
      actorUserId: req.user.id,
      action: 'label.update',
      targetType: 'label',
      targetId: req.params.id,
      meta: req.body,
      ip: req.ip,
    });
    changed();
    const [row] = await db.select().from(labels).where(eq(labels.id, req.params.id));
    return { label: labelDTO(row!) };
  });

  app.delete('/:id', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const [row] = await db.select().from(labels).where(eq(labels.id, req.params.id));
    if (!row) throw notFound('Label');
    // contact_labels ikut terhapus (ON DELETE CASCADE).
    await db.delete(labels).where(eq(labels.id, row.id));
    await audit(db, {
      actorUserId: req.user.id,
      action: 'label.delete',
      targetType: 'label',
      targetId: row.id,
      meta: { name: row.name },
      ip: req.ip,
    });
    changed();
    return { ok: true };
  });
}
