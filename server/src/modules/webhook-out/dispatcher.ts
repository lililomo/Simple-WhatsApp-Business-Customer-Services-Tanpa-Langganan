import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { WebhookEventType } from '@wa/shared';
import { outboundWebhookDeliveries, outboundWebhooks } from '../../db/schema';
import type { BusEvent } from '../../lib/bus';
import { decrypt, hmacSha256Hex } from '../../lib/crypto';
import { ulid } from '../../lib/ids';
import type { AppDeps } from '../../types';

type Delivery = typeof outboundWebhookDeliveries.$inferSelect;

// Jeda retry setelah percobaan ke-1, 2, …; setelah semuanya habis status menjadi failed.
const RETRY_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000];
const MAX_ATTEMPTS = RETRY_MS.length + 1;
const AUTO_DISABLE_AFTER = 50;
const TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;
const POLL_MS = 5_000;

export function signPayload(secret: string, timestamp: number, body: string): string {
  return `sha256=${hmacSha256Hex(secret, `${timestamp}.${body}`)}`;
}

/** Mengubah event internal menjadi delivery webhook keluar, lalu mengirimnya dengan retry. */
export class WebhookDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = true;
  private unsubscribe: (() => void) | undefined;
  // Status terakhir yang sudah dikirim per pesan, agar message.status tidak terkirim ganda.
  private readonly lastStatus = new Map<string, string>();

  constructor(
    private readonly deps: AppDeps,
    private readonly log: Pick<FastifyBaseLogger, 'error' | 'warn'>,
  ) {}

  start(): void {
    this.stopped = false;
    this.unsubscribe = this.deps.bus.on((event) => {
      if (event.type === 'delivery.created') this.kick();
      else void this.enqueue(event).catch((err) => this.log.error({ err }, 'enqueue webhook failed'));
    });
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }

  private kick() {
    if (!this.running) this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    this.running = true;
    try {
      while (!this.stopped && (await this.runOnce()) > 0) {
        // lanjut selama masih ada antrean yang jatuh tempo
      }
    } catch (err) {
      this.log.error({ err }, 'webhook dispatcher error');
    } finally {
      this.running = false;
      this.schedule(POLL_MS);
    }
  }

  /** Simpan delivery untuk setiap webhook aktif yang berlangganan event ini. */
  async enqueue(event: BusEvent): Promise<number> {
    let type: WebhookEventType | null = null;
    let data: Record<string, unknown> = {};
    if (event.type === 'message.created') {
      type = event.message.direction === 'in' ? 'message.received' : 'message.sent';
      data = { message: event.message, conversation: event.conversation };
      this.remember(event.message.id, event.message.status);
    } else if (event.type === 'message.updated' && event.message.direction === 'out') {
      if (this.lastStatus.get(event.message.id) === event.message.status) return 0;
      this.remember(event.message.id, event.message.status);
      type = 'message.status';
      data = { message: event.message };
    }
    if (!type) return 0;
    return this.createDeliveries(type, data);
  }

  async createDeliveries(type: string, data: Record<string, unknown>, onlyWebhookId?: number): Promise<number> {
    const { db } = this.deps.database;
    const hooks = await db.select().from(outboundWebhooks).where(eq(outboundWebhooks.isActive, true));
    const targets = hooks.filter((h) => (onlyWebhookId ? h.id === onlyWebhookId : h.events.includes(type)));
    if (targets.length === 0) return 0;
    const eventId = ulid();
    const payload = JSON.stringify({ id: eventId, type, createdAt: new Date().toISOString(), data });
    const now = new Date();
    await db.insert(outboundWebhookDeliveries).values(
      targets.map((h) => ({ webhookId: h.id, eventId, eventType: type, payload, nextAttemptAt: now })),
    );
    this.kick();
    return targets.length;
  }

  private remember(messageId: string, status: string) {
    this.lastStatus.set(messageId, status);
    if (this.lastStatus.size > 5000) this.lastStatus.delete(this.lastStatus.keys().next().value!);
  }

  /** Kirim satu batch delivery yang jatuh tempo; mengembalikan jumlahnya. Dipakai juga oleh test. */
  async runOnce(): Promise<number> {
    const { db } = this.deps.database;
    const batch = await db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .select({ id: outboundWebhookDeliveries.id })
        .from(outboundWebhookDeliveries)
        .where(and(eq(outboundWebhookDeliveries.status, 'pending'), lte(outboundWebhookDeliveries.nextAttemptAt, now)))
        .orderBy(asc(outboundWebhookDeliveries.id))
        .limit(20)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      // Lease: geser jadwal agar proses lain tidak mengambil delivery yang sedang dikirim.
      await tx
        .update(outboundWebhookDeliveries)
        .set({ nextAttemptAt: new Date(now.getTime() + LEASE_MS) })
        .where(inArray(outboundWebhookDeliveries.id, ids));
      return tx.select().from(outboundWebhookDeliveries).where(inArray(outboundWebhookDeliveries.id, ids));
    });
    for (const d of batch) await this.deliver(d);
    return batch.length;
  }

  private async deliver(d: Delivery) {
    const { db } = this.deps.database;
    const [hook] = await db.select().from(outboundWebhooks).where(eq(outboundWebhooks.id, d.webhookId)).limit(1);
    if (!hook?.isActive) {
      await db
        .update(outboundWebhookDeliveries)
        .set({ status: 'failed', responseSnippet: 'Webhook nonaktif atau dihapus' })
        .where(eq(outboundWebhookDeliveries.id, d.id));
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = decrypt(hook.secretEnc, this.deps.config.appKey);
    let code: number | null = null;
    let snippet: string;
    try {
      const res = await (this.deps.fetch ?? fetch)(hook.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'WA-Inbox-Webhook/1',
          'x-wainbox-event': d.eventType,
          'x-wainbox-delivery': String(d.id),
          'x-wainbox-timestamp': String(timestamp),
          'x-wainbox-signature': signPayload(secret, timestamp, d.payload),
        },
        body: d.payload,
      });
      code = res.status;
      snippet = (await res.text().catch(() => '')).slice(0, 500);
    } catch (err) {
      snippet = err instanceof Error && err.name === 'TimeoutError' ? 'Timeout 10 detik' : String(err instanceof Error ? err.message : err);
    }

    const attempts = d.attempts + 1;
    if (code !== null && code >= 200 && code < 300) {
      await db
        .update(outboundWebhookDeliveries)
        .set({ status: 'success', attempts, responseCode: code, responseSnippet: snippet, deliveredAt: new Date() })
        .where(eq(outboundWebhookDeliveries.id, d.id));
      if (hook.failureCount > 0) await db.update(outboundWebhooks).set({ failureCount: 0 }).where(eq(outboundWebhooks.id, hook.id));
      return;
    }

    const exhausted = attempts >= MAX_ATTEMPTS;
    await db
      .update(outboundWebhookDeliveries)
      .set({
        status: exhausted ? 'failed' : 'pending',
        attempts,
        responseCode: code,
        responseSnippet: snippet.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + (RETRY_MS[attempts - 1] ?? RETRY_MS.at(-1)!)),
      })
      .where(eq(outboundWebhookDeliveries.id, d.id));
    if (exhausted) {
      await db
        .update(outboundWebhooks)
        .set({
          failureCount: sql`${outboundWebhooks.failureCount} + 1`,
          isActive: sql`CASE WHEN ${outboundWebhooks.failureCount} + 1 >= ${AUTO_DISABLE_AFTER} THEN FALSE ELSE ${outboundWebhooks.isActive} END`,
        })
        .where(eq(outboundWebhooks.id, hook.id));
    }
  }
}
