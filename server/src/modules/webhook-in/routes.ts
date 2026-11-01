import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { waAccounts, webhookEvents } from '../../db/schema';
import { decrypt, hmacSha256Hex, safeEqual } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { SlidingCounter } from '../../lib/sliding-counter';
import type { AppInstance } from '../../types';

// Ukuran payload webhook maksimum dari Meta.
export const WEBHOOK_BODY_LIMIT = 3 * 1024 * 1024;
const INVALID_LIMIT_PER_MIN = 30;

const verifyQuery = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().optional(),
});

/** Penerima webhook Meta. Didaftarkan dengan prefix /webhooks; parser body di sini hanya berlaku untuk route ini. */
export async function webhookInRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  const invalidByIp = new SlidingCounter(60_000);

  // Signature dihitung atas byte mentah, jadi body tidak boleh di-parse sebagai JSON terlebih dahulu.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, body, done) => done(null, body));

  app.get('/meta', { schema: { querystring: verifyQuery } }, async (req, reply) => {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token && challenge) {
      const accounts = await db.select({ verifyToken: waAccounts.verifyToken }).from(waAccounts);
      if (accounts.some((a) => safeEqual(a.verifyToken, token))) {
        return reply.type('text/plain').send(challenge);
      }
    }
    req.log.warn({ mode }, 'webhook verification rejected');
    return reply.status(403).type('text/plain').send('Forbidden');
  });

  app.post('/meta', async (req, reply) => {
    const raw = req.body as Buffer;
    const header = String(req.headers['x-hub-signature-256'] ?? '');
    const accounts = await db.select({ id: waAccounts.id, appSecretEnc: waAccounts.appSecretEnc }).from(waAccounts);
    const matched = header.startsWith('sha256=')
      ? accounts.find((a) => safeEqual(header.slice(7), hmacSha256Hex(decrypt(a.appSecretEnc, deps.config.appKey), raw)))
      : undefined;

    if (!matched) {
      // Endpoint ini publik: payload bersignature salah tidak pernah disimpan agar disk tidak bisa dibanjiri.
      const recent = invalidByIp.hit(req.ip);
      req.log.warn({ ip: req.ip, bytes: raw?.length ?? 0 }, 'webhook signature invalid');
      if (recent > INVALID_LIMIT_PER_MIN) throw new AppError(429, 'rate_limited', 'Terlalu banyak permintaan.');
      throw new AppError(401, 'invalid_signature', 'Signature tidak valid.');
    }

    const now = new Date();
    await db.insert(webhookEvents).values({
      receivedAt: now,
      payload: raw.toString('utf8'),
      status: 'pending',
      nextAttemptAt: now,
    });
    await db.update(waAccounts).set({ lastWebhookAt: now }).where(eq(waAccounts.id, matched.id));
    deps.bus.emit({ type: 'webhook.stored' });
    return reply.status(200).send({ ok: true });
  });
}
