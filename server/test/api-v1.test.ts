import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { apiKeys, contacts, messages, outboundWebhookDeliveries, outboundWebhooks, templates, waAccounts } from '../src/db/schema';
import { WebhookWorker } from '../src/modules/processor/worker';
import { WebhookDispatcher } from '../src/modules/webhook-out/dispatcher';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph } from './helpers/graph';
import { CUSTOMER, inbound, PHONE_ID, sign } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
let adminCookie: string;
afterEach(async () => {
  await app?.close();
});

const received: { headers: Record<string, string>; body: string }[] = [];
let hookStatus = 200;
const graph = fakeGraph({
  [`POST ${PHONE_ID}/messages`]: () => ({ json: { messages: [{ id: `wamid.API${Date.now()}` }] } }),
  'POST https://sistem-lain.test/wa-hook': (c) => {
    received.push({ headers: {}, body: JSON.stringify(c.body) });
    return { status: hookStatus, json: { ok: hookStatus === 200 } };
  },
});
// fetch untuk webhook keluar juga perlu header; bungkus fakeGraph untuk mencatatnya.
const fetchWithHeaders: typeof fetch = async (input, init) => {
  const res = await graph.fetch(input, init);
  if (String(input).startsWith('https://sistem-lain.test')) {
    received.at(-1)!.headers = init?.headers as Record<string, string>;
    received.at(-1)!.body = String(init?.body);
  }
  return res;
};

async function setup(overrides: Record<string, string> = {}) {
  app = await buildTestApp(t.get(), overrides, fetchWithHeaders);
  await seedAccount(t.get());
  await seedUser(t.get());
  adminCookie = await loginAs(app, 'admin@kpp.test');
  received.length = 0;
  hookStatus = 200;
  graph.calls.length = 0;
}

async function createKey(scopes: string[], name = 'SIDJP') {
  const res = await app.inject({ method: 'POST', url: '/api/api-keys', headers: { cookie: adminCookie, origin: ORIGIN }, payload: { name, scopes } });
  expect(res.statusCode).toBe(201);
  return res.json() as { apiKey: { id: string; prefix: string }; key: string };
}

async function receiveFromCustomer(text = 'Halo') {
  const body = JSON.stringify(inbound.text(text));
  await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) }, payload: body });
  await new WebhookWorker(app.deps, { error: () => {}, warn: () => {} }).runOnce();
}

const v1 = (key: string, method: 'GET' | 'POST', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${key}`, ...headers }, ...(payload ? { payload: payload as object } : {}) });

describe('API keys', () => {
  it('shows the key once, stores only a hash, and stops working when revoked', async () => {
    await setup();
    const { apiKey, key } = await createKey(['conversations:read']);
    expect(key).toMatch(/^wai_[0-9A-Za-z]{40}$/);
    expect(apiKey.prefix).toBe(key.slice(0, 12));
    const [row] = await t.get().db.select().from(apiKeys);
    expect(row!.keyHash).not.toContain(key.slice(4));
    const list = await app.inject({ url: '/api/api-keys', headers: { cookie: adminCookie } });
    expect(JSON.stringify(list.json())).not.toContain(key);

    expect((await v1(key, 'GET', '/conversations')).statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/api-keys/${apiKey.id}`, headers: { cookie: adminCookie, origin: ORIGIN } });
    const revoked = await v1(key, 'GET', '/conversations');
    expect(revoked.statusCode).toBe(401);
    expect(revoked.json().error.code).toBe('invalid_api_key');
  });

  it('rejects missing keys, enforces scopes, and does not accept session cookies', async () => {
    await setup();
    const { key } = await createKey(['conversations:read']);
    expect((await app.inject({ url: '/api/v1/conversations' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/conversations', headers: { cookie: adminCookie } })).statusCode).toBe(401);
    const noScope = await v1(key, 'GET', '/templates');
    expect(noScope.statusCode).toBe(403);
    expect(noScope.json().error.code).toBe('insufficient_scope');
  });
});

describe('POST /api/v1/messages', () => {
  it('sends a text inside the window and labels it with the API key', async () => {
    await setup();
    await receiveFromCustomer();
    const { key } = await createKey(['messages:send', 'messages:read']);
    const res = await v1(key, 'POST', '/messages', { to: '0812-3456-7890', type: 'text', text: 'Permohonan Anda sudah kami terima.', clientRef: 'TIKET-001' });
    expect(res.statusCode).toBe(202);
    expect(res.json().data).toMatchObject({ status: 'accepted', clientRef: 'TIKET-001' });
    const detail = await v1(key, 'GET', `/messages/${res.json().data.id}`);
    expect(detail.json().data.sentBy).toEqual({ type: 'api', id: expect.any(String), name: 'SIDJP' });
    expect(CUSTOMER).toBe('6281234567890');
  });

  it('returns window_closed for free-form text to a number without an open window', async () => {
    await setup();
    const { key } = await createKey(['messages:send']);
    const res = await v1(key, 'POST', '/messages', { to: '081111111111', type: 'text', text: 'halo' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('window_closed');
    // Tidak meninggalkan kontak/percakapan kosong untuk nomor yang ditolak.
    expect(await t.get().db.$count(contacts)).toBe(0);
  });

  it('sends a template by name to a new number', async () => {
    await setup();
    const [account] = await t.get().db.select().from(waAccounts);
    await t.get().db.insert(templates).values({
      waAccountId: account!.id, metaTemplateId: '1', name: 'notifikasi_berkas', language: 'id', category: 'UTILITY', status: 'APPROVED',
      components: [{ type: 'BODY', text: 'Berkas {{1}} sudah selesai diproses.' }], syncedAt: new Date(),
    });
    const { key } = await createKey(['messages:send']);
    const res = await v1(key, 'POST', '/messages', { to: '+62 811 2222 3333', type: 'template', template: { name: 'notifikasi_berkas', params: { body: { '1': 'PBB-2025' } } } });
    expect(res.statusCode).toBe(202);
    const [msg] = await t.get().db.select().from(messages).where(eq(messages.id, Number(res.json().data.id)));
    expect(msg!.text).toBe('Berkas PBB-2025 sudah selesai diproses.');
  });

  it('replays the stored response for a repeated Idempotency-Key and rejects a different body', async () => {
    await setup();
    await receiveFromCustomer();
    const { key } = await createKey(['messages:send']);
    const body = { to: CUSTOMER, type: 'text', text: 'Satu kali saja' };
    const first = await v1(key, 'POST', '/messages', body, { 'idempotency-key': 'abc-123' });
    const second = await v1(key, 'POST', '/messages', body, { 'idempotency-key': 'abc-123' });
    expect(second.statusCode).toBe(202);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json()).toEqual(first.json());
    expect(graph.calls.filter((c) => c.path === `${PHONE_ID}/messages`)).toHaveLength(1);
    const conflict = await v1(key, 'POST', '/messages', { ...body, text: 'Beda' }, { 'idempotency-key': 'abc-123' });
    expect(conflict.statusCode).toBe(409);
    graph.calls.length = 0;
  });

  it('rate limits per API key', async () => {
    await setup({ API_RATE_LIMIT_PER_MIN: '3' });
    const { key } = await createKey(['conversations:read']);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await v1(key, 'GET', '/conversations')).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});

describe('read endpoints and docs', () => {
  it('lists conversations, messages and contacts', async () => {
    await setup();
    await receiveFromCustomer('Tanya PBB');
    const { key } = await createKey(['conversations:read', 'messages:read']);
    const convs = await v1(key, 'GET', '/conversations');
    expect(convs.json().data[0].contact.waId).toBe(CUSTOMER);
    const msgs = await v1(key, 'GET', `/conversations/${convs.json().data[0].id}/messages`);
    expect(msgs.json().data.map((m: { text: string }) => m.text)).toEqual(['Tanya PBB']);
    const contact = await v1(key, 'GET', '/contacts/081234567890');
    expect(contact.json().data).toMatchObject({ waId: CUSTOMER, conversationId: convs.json().data[0].id });
  });

  it('serves OpenAPI docs to admins only, covering only API v1', async () => {
    await setup();
    expect((await app.inject({ url: '/api/docs/json' })).statusCode).toBe(401);
    const spec = await app.inject({ url: '/api/docs/json', headers: { cookie: adminCookie } });
    expect(spec.statusCode).toBe(200);
    const paths = Object.keys(spec.json().paths);
    expect(paths).toContain('/api/v1/messages');
    expect(paths.every((p) => p.startsWith('/api/v1/'))).toBe(true);
  });
});

describe('outbound webhooks', () => {
  async function createHook(events: string[]) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/outbound-webhooks',
      headers: { cookie: adminCookie, origin: ORIGIN },
      payload: { name: 'Sistem antrean', url: 'https://sistem-lain.test/wa-hook', events },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { webhook: { id: string }; secret: string };
  }

  it('delivers signed message.received events', async () => {
    await setup();
    const { secret } = await createHook(['message.received']);
    const dispatcher = new WebhookDispatcher(app.deps, { error: () => {}, warn: () => {} });
    app.deps.bus.on((e) => void dispatcher.enqueue(e));
    await receiveFromCustomer('Mau antre');
    await new Promise((r) => setTimeout(r, 300));
    expect(await dispatcher.runOnce()).toBe(1);

    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(headers['x-wainbox-event']).toBe('message.received');
    const expected = `sha256=${createHmac('sha256', secret).update(`${headers['x-wainbox-timestamp']}.${body}`).digest('hex')}`;
    expect(headers['x-wainbox-signature']).toBe(expected);
    expect(JSON.parse(body)).toMatchObject({ type: 'message.received', data: { message: { text: 'Mau antre' } } });
    const [delivery] = await t.get().db.select().from(outboundWebhookDeliveries);
    expect(delivery).toMatchObject({ status: 'success', attempts: 1, responseCode: 200 });
  });

  it('retries failed deliveries with backoff', async () => {
    await setup();
    await createHook(['message.received']);
    hookStatus = 500;
    const dispatcher = new WebhookDispatcher(app.deps, { error: () => {}, warn: () => {} });
    app.deps.bus.on((e) => void dispatcher.enqueue(e));
    await receiveFromCustomer();
    await new Promise((r) => setTimeout(r, 300));
    await dispatcher.runOnce();
    const [delivery] = await t.get().db.select().from(outboundWebhookDeliveries);
    expect(delivery).toMatchObject({ status: 'pending', attempts: 1, responseCode: 500 });
    expect(delivery!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    const [hook] = await t.get().db.select().from(outboundWebhooks);
    expect(hook!.isActive).toBe(true);
  });
});
