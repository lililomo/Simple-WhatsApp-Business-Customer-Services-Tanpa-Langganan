import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { webhookEvents } from '../../db/schema';
import { notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireAdminHook, requireUser } from '../auth/plugin';

const listQuery = z.object({ status: z.enum(['pending', 'processing', 'done', 'failed']).default('failed') });
const idParams = z.object({ id: z.coerce.number().int().positive() });

export async function adminRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireAdminHook);

  app.get('/webhook-events', { schema: { querystring: listQuery } }, async (req) => {
    const rows = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.status, req.query.status))
      .orderBy(desc(webhookEvents.id))
      .limit(50);
    return {
      events: rows.map((r) => ({
        id: String(r.id),
        receivedAt: r.receivedAt.toISOString(),
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        payloadPreview: r.payload.slice(0, 500),
      })),
    };
  });

  app.post('/webhook-events/:id/replay', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const [row] = await db.select({ id: webhookEvents.id }).from(webhookEvents).where(eq(webhookEvents.id, req.params.id));
    if (!row) throw notFound('Event webhook');
    await db
      .update(webhookEvents)
      .set({ status: 'pending', attempts: 0, error: null, leaseUntil: null, nextAttemptAt: new Date() })
      .where(eq(webhookEvents.id, row.id));
    await audit(db, { actorUserId: req.user.id, action: 'webhook_event.replay', targetType: 'webhook_event', targetId: row.id, ip: req.ip });
    deps.bus.emit({ type: 'webhook.stored' });
    return { ok: true };
  });
}
