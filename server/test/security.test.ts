import { mkdtemp, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { idempotencyKeys, media, sessions, users, webhookEvents } from '../src/db/schema';
import { runHousekeeping } from '../src/modules/housekeeping/service';
import type { AppInstance } from '../src/types';
import { buildTestApp, loginAs, ORIGIN, seedUser, testConfig } from './helpers/app';
import { useTestDatabase } from './helpers/db';

const t = useTestDatabase();
let app: AppInstance;
afterEach(async () => {
  await app?.close();
});

// Route yang hanya boleh diakses admin (method, url).
const ADMIN_ONLY: [string, string][] = [
  ['GET', '/api/users'],
  ['POST', '/api/users'],
  ['PATCH', '/api/users/1'],
  ['GET', '/api/connection'],
  ['POST', '/api/connection/validate'],
  ['PUT', '/api/connection'],
  ['GET', '/api/connection/phone-numbers'],
  ['POST', '/api/connection/check'],
  ['POST', '/api/connection/register'],
  ['GET', '/api/admin/webhook-events'],
  ['POST', '/api/admin/webhook-events/1/replay'],
  ['GET', '/api/api-keys'],
  ['POST', '/api/api-keys'],
  ['DELETE', '/api/api-keys/1'],
  ['GET', '/api/outbound-webhooks'],
  ['POST', '/api/outbound-webhooks'],
  ['GET', '/api/outbound-webhooks/1/deliveries'],
  ['GET', '/api/docs/json'],
];

// Route untuk pengguna login (petugas maupun admin).
const SESSION_ROUTES: [string, string][] = [
  ['GET', '/api/conversations'],
  ['GET', '/api/conversations/summary'],
  ['GET', '/api/conversations/1/messages'],
  ['POST', '/api/conversations/1/messages'],
  ['POST', '/api/conversations/start'],
  ['GET', '/api/templates'],
  ['POST', '/api/templates/sync'],
  ['GET', '/api/media/1'],
  ['POST', '/api/media'],
  ['GET', '/api/connection/status'],
  ['PATCH', '/api/contacts/1'],
  ['POST', '/api/messages/1/retry'],
];

describe('authorization', () => {
  it('blocks agents from every admin route', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get(), 'agent', 'petugas@kpp.test');
    const cookie = await loginAs(app, 'petugas@kpp.test');
    for (const [method, url] of ADMIN_ONLY) {
      const res = await app.inject({ method: method as 'GET', url, headers: { cookie, origin: ORIGIN }, payload: method === 'GET' ? undefined : {} });
      expect([403], `${method} ${url} → ${res.statusCode}`).toContain(res.statusCode);
    }
  });

  it('requires a session for app routes and does not accept API keys there', async () => {
    app = await buildTestApp(t.get());
    for (const [method, url] of [...SESSION_ROUTES, ...ADMIN_ONLY]) {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: { authorization: 'Bearer wai_0123456789012345678901234567890123456789', origin: ORIGIN },
        payload: method === 'GET' ? undefined : {},
      });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('sets security headers and keeps cookies httpOnly', async () => {
    app = await buildTestApp(t.get(), { APP_URL: 'https://wa.kppbwi.app' });
    await seedUser(t.get());
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://wa.kppbwi.app' },
      payload: { email: 'admin@kpp.test', password: 'password-uji-123' },
    });
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly; Secure; SameSite=Lax/i);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('never returns password hashes', async () => {
    app = await buildTestApp(t.get());
    await seedUser(t.get());
    const cookie = await loginAs(app, 'admin@kpp.test');
    const res = await app.inject({ url: '/api/users', headers: { cookie } });
    expect(res.body).not.toMatch(/argon2|passwordHash|password_hash/);
  });
});

describe('housekeeping', () => {
  it('removes expired data and old media files but keeps recent ones', async () => {
    const storage = await mkdtemp(path.join(tmpdir(), 'wa-hk-'));
    try {
      const cfg = testConfig({ STORAGE_DIR: storage, MEDIA_RETENTION_DAYS: '30' });
      const database = t.get();
      const db = database.db;
      const admin = await seedUser(database);
      const old = new Date(Date.now() - 40 * 86_400_000);
      await db.insert(sessions).values([
        { userId: admin.id, tokenHash: 'a'.repeat(64), expiresAt: old },
        { userId: admin.id, tokenHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3600_000) },
      ]);
      await db.insert(webhookEvents).values([
        { receivedAt: old, payload: '{}', status: 'done', nextAttemptAt: old },
        { receivedAt: new Date(), payload: '{}', status: 'done', nextAttemptAt: new Date() },
      ]);
      await db.insert(idempotencyKeys).values({ apiKeyId: 1, idemKey: 'x', requestHash: 'c'.repeat(64), responseStatus: 202, response: {}, createdAt: old }).catch(() => undefined);
      await mkdir(path.join(storage, 'media'), { recursive: true });
      await writeFile(path.join(storage, 'media', 'lama.jpg'), 'x');
      await writeFile(path.join(storage, 'media', 'baru.jpg'), 'y');
      await db.insert(media).values([
        { direction: 'in', status: 'ready', storagePath: 'media/lama.jpg', createdAt: old },
        { direction: 'in', status: 'ready', storagePath: 'media/baru.jpg' },
      ]);

      const result = await runHousekeeping({ config: cfg, database, bus: undefined as never });
      expect(result).toMatchObject({ sessions: 1, webhookEvents: 1, mediaFiles: 1 });
      await expect(access(path.join(storage, 'media', 'lama.jpg'))).rejects.toThrow();
      await expect(access(path.join(storage, 'media', 'baru.jpg'))).resolves.toBeUndefined();
      const [expired] = await db.select().from(media).where(eq(media.status, 'expired'));
      expect(expired!.storagePath).toBeNull();
      expect(await db.$count(users)).toBe(1);
    } finally {
      await rm(storage, { recursive: true, force: true });
    }
  });
});
