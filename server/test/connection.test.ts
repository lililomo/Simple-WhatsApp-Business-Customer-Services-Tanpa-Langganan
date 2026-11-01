import { afterEach, describe, expect, it } from 'vitest';
import { waAccounts } from '../src/db/schema';
import { decrypt } from '../src/lib/crypto';
import { GraphClient, GraphError } from '../src/meta/graph-client';
import type { AppInstance } from '../src/types';
import { buildTestApp, loginAs, ORIGIN, seedUser, testConfig } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph, metaError } from './helpers/graph';

const t = useTestDatabase();
let app: AppInstance;
afterEach(async () => {
  await app?.close();
});

const APP_ID = '111222333444';
const APP_SECRET = 'appsecret-0123456789abcdef';
const WABA = '555666777888';
const PHONE = '1149831774889027';
const TOKEN = 'EAAGtokenrahasia1234567890WXYZ';

function happyGraph(extra: Record<string, Parameters<typeof fakeGraph>[0][string]> = {}) {
  return fakeGraph({
    [`GET ${APP_ID}`]: (c) => (c.auth === `Bearer ${APP_ID}|${APP_SECRET}` ? { json: { id: APP_ID, name: 'WA Inbox' } } : metaError(190, 'bad secret')),
    [`GET ${WABA}`]: () => ({ json: { id: WABA, name: 'KPP Pratama', currency: 'IDR', timezone_id: '71' } }),
    [`GET ${WABA}/phone_numbers`]: () => ({
      json: {
        data: [
          {
            id: PHONE,
            display_phone_number: '+62 812-200-627',
            verified_name: 'KPP Pratama Banyuwangi',
            quality_rating: 'GREEN',
            code_verification_status: 'VERIFIED',
            platform_type: 'CLOUD_API',
            status: 'CONNECTED',
          },
        ],
      },
    }),
    ...extra,
  });
}

const creds = { appId: APP_ID, appSecret: APP_SECRET, wabaId: WABA, accessToken: TOKEN };

async function adminApp(fetchFn: typeof fetch) {
  app = await buildTestApp(t.get(), {}, fetchFn);
  await seedUser(t.get());
  return loginAs(app, 'admin@kpp.test');
}

describe('GraphClient', () => {
  it('retries GET on 5xx but never retries POST', async () => {
    let gets = 0;
    let posts = 0;
    const g = fakeGraph({
      'GET x': () => (++gets < 2 ? metaError(1, 'temporary', 500) : { json: { ok: true } }),
      'POST y': () => {
        posts++;
        return metaError(131000, 'temporary', 500);
      },
    });
    const client = new GraphClient('tok', { version: 'v26.0', fetch: g.fetch });
    await expect(client.get('x')).resolves.toEqual({ ok: true });
    expect(gets).toBe(2);
    await expect(client.post('y', {})).rejects.toBeInstanceOf(GraphError);
    expect(posts).toBe(1);
  });

  it('maps Meta error codes to Indonesian messages', async () => {
    const g = fakeGraph({ 'GET me': () => metaError(190, 'Error validating access token') });
    const err = await new GraphClient('tok', { version: 'v26.0', fetch: g.fetch }).get('me').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect((err as GraphError).code).toBe(190);
    expect((err as GraphError).message).toMatch(/Token Meta tidak valid/);
  });
});

describe('connection API', () => {
  it('validates credentials and lists phone numbers', async () => {
    const g = happyGraph();
    const cookie = await adminApp(g.fetch);
    const res = await app.inject({ method: 'POST', url: '/api/connection/validate', headers: { cookie, origin: ORIGIN }, payload: creds });
    expect(res.statusCode).toBe(200);
    expect(res.json().phoneNumbers[0]).toMatchObject({ id: PHONE, platformType: 'CLOUD_API' });
    expect(res.json().waba.name).toBe('KPP Pratama');
  });

  it('rejects a wrong App Secret with a clear message', async () => {
    const g = happyGraph();
    const cookie = await adminApp(g.fetch);
    const res = await app.inject({
      method: 'POST',
      url: '/api/connection/validate',
      headers: { cookie, origin: ORIGIN },
      payload: { ...creds, appSecret: 'secret-yang-salah-123' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toBe('App ID atau App Secret salah.');
  });

  it('reports an invalid token from Meta', async () => {
    const g = happyGraph({ [`GET ${WABA}`]: () => metaError(190, 'Invalid OAuth access token') });
    const cookie = await adminApp(g.fetch);
    const res = await app.inject({ method: 'POST', url: '/api/connection/validate', headers: { cookie, origin: ORIGIN }, payload: creds });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'meta_error', details: { metaCode: 190 } });
  });

  it('saves the connection encrypted and never returns the token', async () => {
    const g = happyGraph();
    const cookie = await adminApp(g.fetch);
    const save = await app.inject({
      method: 'PUT',
      url: '/api/connection',
      headers: { cookie, origin: ORIGIN },
      payload: { ...creds, phoneNumberId: PHONE },
    });
    expect(save.statusCode).toBe(200);
    const dto = save.json().connection;
    expect(dto).toMatchObject({ phoneNumberId: PHONE, tokenLast4: 'WXYZ', callbackUrl: `${ORIGIN}/webhooks/meta`, status: 'active' });
    expect(dto.verifyToken).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(JSON.stringify(save.json())).not.toContain(TOKEN);
    expect(JSON.stringify(save.json())).not.toContain(APP_SECRET);

    const [row] = await t.get().db.select().from(waAccounts);
    expect(row!.accessTokenEnc).not.toContain(TOKEN);
    expect(decrypt(row!.accessTokenEnc, testConfig().appKey)).toBe(TOKEN);

    // Perbarui tanpa mengisi ulang token/secret: nilai lama tetap dipakai, verify token tidak berubah.
    const update = await app.inject({
      method: 'PUT',
      url: '/api/connection',
      headers: { cookie, origin: ORIGIN },
      payload: { appId: APP_ID, wabaId: WABA, phoneNumberId: PHONE, label: 'Layanan KPP' },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().connection).toMatchObject({ label: 'Layanan KPP', verifyToken: dto.verifyToken });
    expect(await t.get().db.$count(waAccounts)).toBe(1);
  });

  it('rejects a phone number outside the WABA', async () => {
    const cookie = await adminApp(happyGraph().fetch);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/connection',
      headers: { cookie, origin: ORIGIN },
      payload: { ...creds, phoneNumberId: '999999' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('phone_not_in_waba');
  });

  it('checks the connection and subscribes the app to the WABA', async () => {
    const g = happyGraph({
      [`GET ${PHONE}`]: () => ({
        json: { id: PHONE, display_phone_number: '+62 812-200-627', platform_type: 'CLOUD_API', code_verification_status: 'VERIFIED', status: 'CONNECTED' },
      }),
      [`POST ${WABA}/subscribed_apps`]: () => ({ json: { success: true } }),
      [`GET ${WABA}/subscribed_apps`]: () => ({ json: { data: [{ whatsapp_business_api_data: { id: APP_ID, name: 'WA Inbox' } }] } }),
    });
    const cookie = await adminApp(g.fetch);
    await app.inject({ method: 'PUT', url: '/api/connection', headers: { cookie, origin: ORIGIN }, payload: { ...creds, phoneNumberId: PHONE } });
    const res = await app.inject({ method: 'POST', url: '/api/connection/check', headers: { cookie, origin: ORIGIN } });
    expect(res.statusCode).toBe(200);
    const items = Object.fromEntries((res.json().items as { key: string; ok: boolean }[]).map((i) => [i.key, i.ok]));
    expect(items).toEqual({ credentials: true, subscription: true, phone: true, webhook: false });
    expect(res.json().connection.subscribedAt).not.toBeNull();
    expect(g.calls.some((c) => c.method === 'POST' && c.path === `${WABA}/subscribed_apps`)).toBe(true);
  });

  it('marks the account as error when Meta rejects the token', async () => {
    let tokenValid = true;
    const g = happyGraph({ [`GET ${PHONE}`]: () => (tokenValid ? { json: { id: PHONE } } : metaError(190, 'expired')) });
    const cookie = await adminApp(g.fetch);
    await app.inject({ method: 'PUT', url: '/api/connection', headers: { cookie, origin: ORIGIN }, payload: { ...creds, phoneNumberId: PHONE } });
    tokenValid = false;
    const res = await app.inject({ method: 'POST', url: '/api/connection/check', headers: { cookie, origin: ORIGIN } });
    expect(res.json().items[0]).toMatchObject({ key: 'credentials', ok: false });
    expect(res.json().connection).toMatchObject({ status: 'error' });
    const status = await app.inject({ method: 'GET', url: '/api/connection/status', headers: { cookie } });
    expect(status.json()).toMatchObject({ connected: true, status: 'error' });
  });

  it('lets agents see only the status summary', async () => {
    app = await buildTestApp(t.get(), {}, happyGraph().fetch);
    await seedUser(t.get(), 'agent', 'petugas@kpp.test');
    const cookie = await loginAs(app, 'petugas@kpp.test');
    expect((await app.inject({ method: 'GET', url: '/api/connection', headers: { cookie } })).statusCode).toBe(403);
    const status = await app.inject({ method: 'GET', url: '/api/connection/status', headers: { cookie } });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ connected: false });
  });
});
