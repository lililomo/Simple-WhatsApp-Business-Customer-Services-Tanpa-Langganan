import { and, asc, eq, inArray, lt, lte, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { webhookEvents } from '../../db/schema';
import type { AppDeps } from '../../types';
import { processPayload, RetryLater } from './handlers';

type WebhookEvent = typeof webhookEvents.$inferSelect;

const BATCH = 20;
const LEASE_MS = 60_000;
const POLL_MS = 2_000;
const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [10_000, 60_000, 300_000, 1_800_000, 7_200_000, 7_200_000, 7_200_000];

/**
 * Memproses webhook_events di proses yang sama dengan server: ambil batch dengan lease
 * (SELECT … FOR UPDATE SKIP LOCKED), proses berurutan, retry dengan backoff.
 */
export class WebhookWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private wakeRequested = false;
  private stopped = true;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly deps: AppDeps,
    private readonly log: Pick<FastifyBaseLogger, 'error' | 'warn'>,
  ) {}

  start(): void {
    this.stopped = false;
    this.unsubscribe = this.deps.bus.on((e) => {
      if (e.type === 'webhook.stored') this.kick();
    });
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    clearTimeout(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }

  kick(): void {
    if (this.running) this.wakeRequested = true;
    else this.schedule(0);
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
        // terus selama masih ada antrean
      }
    } catch (err) {
      this.log.error({ err }, 'webhook worker error');
    } finally {
      this.running = false;
      const wake = this.wakeRequested;
      this.wakeRequested = false;
      this.schedule(wake ? 0 : POLL_MS);
    }
  }

  /** Proses satu batch; mengembalikan jumlah event yang diambil. Dipakai juga oleh test. */
  async runOnce(): Promise<number> {
    const batch = await this.claimBatch();
    for (const event of batch) await this.processOne(event);
    return batch.length;
  }

  private claimBatch(): Promise<WebhookEvent[]> {
    const { db } = this.deps.database;
    return db.transaction(async (tx) => {
      const now = new Date();
      const rows = await tx
        .select({ id: webhookEvents.id })
        .from(webhookEvents)
        .where(
          or(
            and(eq(webhookEvents.status, 'pending'), lte(webhookEvents.nextAttemptAt, now)),
            and(eq(webhookEvents.status, 'processing'), lt(webhookEvents.leaseUntil, now)),
          ),
        )
        .orderBy(asc(webhookEvents.id))
        .limit(BATCH)
        .for('update', { skipLocked: true });
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await tx
        .update(webhookEvents)
        .set({ status: 'processing', leaseUntil: new Date(now.getTime() + LEASE_MS) })
        .where(inArray(webhookEvents.id, ids));
      return tx.select().from(webhookEvents).where(inArray(webhookEvents.id, ids)).orderBy(asc(webhookEvents.id));
    });
  }

  private async processOne(event: WebhookEvent) {
    const { db } = this.deps.database;
    try {
      const payload = JSON.parse(event.payload);
      await processPayload(this.deps, payload, event.receivedAt);
      await db
        .update(webhookEvents)
        .set({ status: 'done', processedAt: new Date(), error: null, leaseUntil: null })
        .where(eq(webhookEvents.id, event.id));
    } catch (err) {
      const attempts = event.attempts + 1;
      const permanent = err instanceof SyntaxError || attempts >= MAX_ATTEMPTS;
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof RetryLater)) this.log.warn({ err, eventId: event.id, attempts }, 'webhook event failed');
      await db
        .update(webhookEvents)
        .set({
          status: permanent ? 'failed' : 'pending',
          attempts,
          error: message.slice(0, 2000),
          leaseUntil: null,
          nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS.at(-1)!)),
        })
        .where(eq(webhookEvents.id, event.id));
    }
  }
}
