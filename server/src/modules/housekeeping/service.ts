import { unlink } from 'node:fs/promises';
import { and, eq, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import { idempotencyKeys, media, outboundWebhookDeliveries, sessions, webhookEvents } from '../../db/schema';
import type { AppDeps } from '../../types';
import { mediaAbsolutePath } from '../media/service';

const DAY = 24 * 60 * 60 * 1000;

export interface HousekeepingResult {
  sessions: number;
  webhookEvents: number;
  deliveries: number;
  idempotencyKeys: number;
  mediaFiles: number;
}

/**
 * Bersih-bersih harian (cron aaPanel "WA Inbox – Housekeeping"): sesi kedaluwarsa, event webhook dan
 * delivery lama, idempotency key > 24 jam, serta file media yang melewati MEDIA_RETENTION_DAYS.
 */
export async function runHousekeeping(deps: AppDeps, now = new Date()): Promise<HousekeepingResult> {
  const { db } = deps.database;
  const ago = (days: number) => new Date(now.getTime() - days * DAY);

  const [s] = await db.delete(sessions).where(lt(sessions.expiresAt, now));
  const [w] = await db
    .delete(webhookEvents)
    .where(or(and(eq(webhookEvents.status, 'done'), lt(webhookEvents.receivedAt, ago(30))), and(eq(webhookEvents.status, 'failed'), lt(webhookEvents.receivedAt, ago(90)))));
  const [d] = await db
    .delete(outboundWebhookDeliveries)
    .where(and(ne(outboundWebhookDeliveries.status, 'pending'), lt(outboundWebhookDeliveries.createdAt, ago(30))));
  const [i] = await db.delete(idempotencyKeys).where(lt(idempotencyKeys.createdAt, ago(1)));

  let mediaFiles = 0;
  const retention = deps.config.MEDIA_RETENTION_DAYS;
  if (retention > 0) {
    const old = await db
      .select({ id: media.id, storagePath: media.storagePath })
      .from(media)
      .where(and(eq(media.status, 'ready'), isNotNull(media.storagePath), lt(media.createdAt, ago(retention))))
      .limit(5000);
    for (const m of old) {
      await unlink(mediaAbsolutePath(deps.config, m.storagePath!)).catch(() => undefined);
      mediaFiles++;
    }
    if (old.length) {
      await db.update(media).set({ status: 'expired', storagePath: null }).where(inArray(media.id, old.map((m) => m.id)));
    }
  }

  return {
    sessions: s.affectedRows,
    webhookEvents: w.affectedRows,
    deliveries: d.affectedRows,
    idempotencyKeys: i.affectedRows,
    mediaFiles,
  };
}
