import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { outboundWebhookBody, type OutboundWebhookDTO, type WebhookDeliveryDTO, type WebhookEventType } from '@wa/shared';
import { outboundWebhookDeliveries, outboundWebhooks } from '../../db/schema';
import { encrypt, randomBase62 } from '../../lib/crypto';
import { ulid } from '../../lib/ids';
import { AppError, notFound } from '../../lib/errors';
import type { AppDeps, AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireAdminHook, requireUser } from '../auth/plugin';

type WebhookRow = typeof outboundWebhooks.$inferSelect;
type DeliveryRow = typeof outboundWebhookDeliveries.$inferSelect;

const idParams = z.object({ id: z.coerce.number().int().positive() });

function toDTO(h: WebhookRow): OutboundWebhookDTO {
  return {
    id: String(h.id),
    name: h.name,
    url: h.url,
    events: h.events as WebhookEventType[],
    isActive: h.isActive,
    failureCount: h.failureCount,
    createdAt: h.createdAt.toISOString(),
  };
}

function toDeliveryDTO(d: DeliveryRow): WebhookDeliveryDTO {
  return {
    id: String(d.id),
    eventId: d.eventId,
    eventType: d.eventType,
    status: d.status,
    attempts: d.attempts,
    responseCode: d.responseCode,
    responseSnippet: d.responseSnippet,
    nextAttemptAt: d.nextAttemptAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
  };
}

function assertUrl(deps: AppDeps, url: string) {
  // Produksi hanya HTTPS; HTTP hanya untuk uji lokal.
  if (deps.config.NODE_ENV === 'production' && !url.startsWith('https://')) {
    throw new AppError(400, 'https_required', 'URL webhook harus memakai HTTPS.');
  }
}

const newSecret = () => `whsec_${randomBase62(32)}`;

/** Kelola webhook keluar ke sistem lain (admin). */
export async function outboundWebhookRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preHandler', requireAdminHook);

  const find = async (id: number) => {
    const [row] = await db.select().from(outboundWebhooks).where(eq(outboundWebhooks.id, id)).limit(1);
    if (!row) throw notFound('Webhook');
    return row;
  };

  app.get('/', async () => ({ webhooks: (await db.select().from(outboundWebhooks).orderBy(desc(outboundWebhooks.id))).map(toDTO) }));

  app.post('/', { schema: { body: outboundWebhookBody } }, async (req, reply) => {
    requireUser(req);
    assertUrl(deps, req.body.url);
    const secret = newSecret();
    const [res] = await db.insert(outboundWebhooks).values({
      name: req.body.name,
      url: req.body.url,
      events: req.body.events,
      isActive: req.body.isActive ?? true,
      secretEnc: encrypt(secret, deps.config.appKey),
    });
    await audit(db, { actorUserId: req.user.id, action: 'outbound_webhook.create', targetType: 'outbound_webhook', targetId: res.insertId, meta: { url: req.body.url }, ip: req.ip });
    return reply.status(201).send({ webhook: toDTO(await find(res.insertId)), secret });
  });

  app.patch('/:id', { schema: { params: idParams, body: outboundWebhookBody.partial() } }, async (req) => {
    requireUser(req);
    const row = await find(req.params.id);
    if (req.body.url) assertUrl(deps, req.body.url);
    const reactivated = req.body.isActive === true && !row.isActive;
    await db
      .update(outboundWebhooks)
      .set({ ...req.body, ...(reactivated ? { failureCount: 0 } : {}) })
      .where(eq(outboundWebhooks.id, row.id));
    await audit(db, { actorUserId: req.user.id, action: 'outbound_webhook.update', targetType: 'outbound_webhook', targetId: row.id, meta: req.body, ip: req.ip });
    return { webhook: toDTO(await find(row.id)) };
  });

  app.delete('/:id', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const row = await find(req.params.id);
    await db.delete(outboundWebhooks).where(eq(outboundWebhooks.id, row.id));
    await audit(db, { actorUserId: req.user.id, action: 'outbound_webhook.delete', targetType: 'outbound_webhook', targetId: row.id, ip: req.ip });
    return { ok: true };
  });

  app.post('/:id/rotate-secret', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const row = await find(req.params.id);
    const secret = newSecret();
    await db.update(outboundWebhooks).set({ secretEnc: encrypt(secret, deps.config.appKey) }).where(eq(outboundWebhooks.id, row.id));
    await audit(db, { actorUserId: req.user.id, action: 'outbound_webhook.rotate_secret', targetType: 'outbound_webhook', targetId: row.id, ip: req.ip });
    return { secret };
  });

  app.post('/:id/test', { schema: { params: idParams } }, async (req) => {
    const row = await find(req.params.id);
    const eventId = ulid();
    await db.insert(outboundWebhookDeliveries).values({
      webhookId: row.id,
      eventId,
      eventType: 'ping',
      payload: JSON.stringify({ id: eventId, type: 'ping', createdAt: new Date().toISOString(), data: { message: 'Tes dari WA Inbox' } }),
      nextAttemptAt: new Date(),
    });
    deps.bus.emit({ type: 'delivery.created' });
    return { ok: true };
  });

  app.get('/:id/deliveries', { schema: { params: idParams } }, async (req) => {
    const rows = await db
      .select()
      .from(outboundWebhookDeliveries)
      .where(eq(outboundWebhookDeliveries.webhookId, req.params.id))
      .orderBy(desc(outboundWebhookDeliveries.id))
      .limit(50);
    return { deliveries: rows.map(toDeliveryDTO) };
  });

  app.post('/deliveries/:id/redeliver', { schema: { params: idParams } }, async (req) => {
    const [row] = await db.select().from(outboundWebhookDeliveries).where(eq(outboundWebhookDeliveries.id, req.params.id)).limit(1);
    if (!row) throw notFound('Delivery');
    await db
      .update(outboundWebhookDeliveries)
      .set({ status: 'pending', attempts: 0, nextAttemptAt: new Date() })
      .where(eq(outboundWebhookDeliveries.id, row.id));
    deps.bus.emit({ type: 'delivery.created' });
    return { ok: true };
  });
}
