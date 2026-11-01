import { afterEach, describe, expect, it } from 'vitest';
import { pushSubscriptions } from '../src/db/schema';
import { PushNotifier, type PushSender } from '../src/modules/push/service';
import { WebhookWorker } from '../src/modules/processor/worker';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { inbound, sign } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
afterEach(async () => {
  await app?.close();
});

const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/abc${n}`, keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` } });

async function setup() {
  app = await buildTestApp(t.get());
  await seedAccount(t.get());
  await seedUser(t.get(), 'agent');
  return loginAs(app, 'agent@kpp.test');
}

describe('web push', () => {
  it('serves a stable VAPID public key', async () => {
    const cookie = await setup();
    const a = await app.inject({ url: '/api/push/key', headers: { cookie } });
    const b = await app.inject({ url: '/api/push/key', headers: { cookie } });
    expect(a.json().publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(b.json().publicKey).toBe(a.json().publicKey);
  });

  it('notifies subscribed browsers of inbound messages and drops gone subscriptions', async () => {
    const cookie = await setup();
    for (const n of [1, 2]) {
      const res = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie, origin: ORIGIN }, payload: sub(n) });
      expect(res.statusCode).toBe(200);
    }
    const delivered: { endpoint: string; payload: unknown }[] = [];
    const sender: PushSender = async (s, payload) => {
      if (s.endpoint.endsWith('abc2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      delivered.push({ endpoint: s.endpoint, payload: JSON.parse(payload) });
    };
    const notifier = new PushNotifier(app.deps, sender);
    notifier.start();

    const body = JSON.stringify(inbound.text('Mau tanya SPT'));
    await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) }, payload: body });
    await new WebhookWorker(app.deps, { error: () => {}, warn: () => {} }).runOnce();
    await new Promise((r) => setTimeout(r, 200));
    notifier.stop();

    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.payload).toMatchObject({ title: 'Budi Santoso', body: 'Mau tanya SPT', url: expect.stringMatching(/^\/chats\/\d+$/) });
    expect(await t.get().db.$count(pushSubscriptions)).toBe(1);
  });

  it('removes the subscription when the user logs out', async () => {
    const cookie = await setup();
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: { cookie, origin: ORIGIN }, payload: sub(1) });
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, origin: ORIGIN } });
    expect(await t.get().db.$count(pushSubscriptions)).toBe(0);
  });
});
