import { asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { quickReplyBody, type QuickReplyDTO } from '@wa/shared';
import { quickReplies } from '../../db/schema';
import { AppError, isDuplicateKey, notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireUser, requireUserHook } from '../auth/plugin';

const idParams = z.object({ id: z.coerce.number().int().positive() });

type QuickReplyRow = typeof quickReplies.$inferSelect;

function toDTO(r: QuickReplyRow): QuickReplyDTO {
  return {
    id: String(r.id),
    title: r.title,
    shortcut: r.shortcut,
    body: r.body,
    usageCount: r.usageCount,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

const shortcutTaken = (err: unknown) =>
  isDuplicateKey(err) ? new AppError(409, 'shortcut_taken', 'Pintasan itu sudah dipakai balasan cepat lain.') : err;

/** Balasan cepat bersama: semua petugas bisa memakai dan mengelolanya. */
export async function quickReplyRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);
  const changed = () => deps.bus.emit({ type: 'library.updated', resource: 'quick-replies' });

  app.get('/', async () => {
    const rows = await db.select().from(quickReplies).orderBy(desc(quickReplies.usageCount), asc(quickReplies.title));
    return { quickReplies: rows.map(toDTO) };
  });

  app.post('/', { schema: { body: quickReplyBody } }, async (req, reply) => {
    requireUser(req);
    const { title, shortcut, body } = req.body;
    const [res] = await db
      .insert(quickReplies)
      .values({ title, shortcut: shortcut ?? null, body, createdBy: req.user.id, updatedBy: req.user.id })
      .catch((err: unknown) => {
        throw shortcutTaken(err);
      });
    await audit(db, { actorUserId: req.user.id, action: 'quick_reply.create', targetType: 'quick_reply', targetId: res.insertId, ip: req.ip });
    changed();
    const [row] = await db.select().from(quickReplies).where(eq(quickReplies.id, res.insertId));
    return reply.status(201).send({ quickReply: toDTO(row!) });
  });

  app.put('/:id', { schema: { params: idParams, body: quickReplyBody } }, async (req) => {
    requireUser(req);
    const { title, shortcut, body } = req.body;
    const [res] = await db
      .update(quickReplies)
      .set({ title, shortcut: shortcut ?? null, body, updatedBy: req.user.id })
      .where(eq(quickReplies.id, req.params.id))
      .catch((err: unknown) => {
        throw shortcutTaken(err);
      });
    if (res.affectedRows === 0) throw notFound('Balasan cepat');
    await audit(db, { actorUserId: req.user.id, action: 'quick_reply.update', targetType: 'quick_reply', targetId: req.params.id, ip: req.ip });
    changed();
    const [row] = await db.select().from(quickReplies).where(eq(quickReplies.id, req.params.id));
    return { quickReply: toDTO(row!) };
  });

  app.delete('/:id', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const [res] = await db.delete(quickReplies).where(eq(quickReplies.id, req.params.id));
    if (res.affectedRows === 0) throw notFound('Balasan cepat');
    await audit(db, { actorUserId: req.user.id, action: 'quick_reply.delete', targetType: 'quick_reply', targetId: req.params.id, ip: req.ip });
    changed();
    return { ok: true };
  });

  // Dipanggil saat balasan cepat disisipkan ke kotak balas; dipakai untuk mengurutkan yang paling sering dipakai.
  app.post('/:id/use', { schema: { params: idParams } }, async (req) => {
    await db
      .update(quickReplies)
      .set({ usageCount: sql`${quickReplies.usageCount} + 1`, lastUsedAt: new Date(), updatedAt: sql`${quickReplies.updatedAt}` })
      .where(eq(quickReplies.id, req.params.id));
    return { ok: true };
  });
}
