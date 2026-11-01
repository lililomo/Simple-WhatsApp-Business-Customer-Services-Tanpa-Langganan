import { afterEach, describe, expect, it } from 'vitest';
import { messagePricing } from '../src/db/schema';
import { WebhookWorker } from '../src/modules/processor/worker';
import { resetUsageCache } from '../src/modules/usage/service';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph, metaError } from './helpers/graph';
import { sign, statusUpdate, WABA_ID } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
afterEach(async () => {
  await app?.close();
  resetUsageCache();
});

let analytics: () => { status?: number; json?: unknown } = () => ({ json: {} });
const graph = fakeGraph({
  [`GET ${WABA_ID}`]: (c) =>
    c.query.fields === 'service_pricing_policy'
      ? { json: { service_pricing_policy: 'PAID_EXEMPT', id: WABA_ID } }
      : analytics(),
});

async function setup() {
  app = await buildTestApp(t.get(), {}, graph.fetch);
  await seedAccount(t.get());
  await seedUser(t.get(), 'agent');
  return loginAs(app, 'agent@kpp.test');
}

async function webhook(payload: unknown) {
  const body = JSON.stringify(payload);
  await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) }, payload: body });
  await new WebhookWorker(app.deps, { error: () => {}, warn: () => {} }).runOnce();
}

describe('free service message quota', () => {
  it('counts delivered service messages from every app on the number, once each', async () => {
    const cookie = await setup();
    analytics = () => metaError(100, 'Unsupported get request');
    // Pesan dari aplikasi lain (mis. Kirimdev): wamid tidak dikenal WA Inbox, tetapi pricing-nya tetap dicatat.
    await webhook(statusUpdate('wamid.KIRIMDEV1', 'sent', { category: 'service', billable: false }));
    await webhook(statusUpdate('wamid.KIRIMDEV1', 'delivered', { category: 'service', billable: false }));
    await webhook(statusUpdate('wamid.KIRIMDEV1', 'read', { category: 'service', billable: false }));
    await webhook(statusUpdate('wamid.SERVICE2', 'delivered', { category: 'service', billable: true }));
    await webhook(statusUpdate('wamid.TEMPLATE1', 'delivered', { category: 'utility' }));
    await webhook(statusUpdate('wamid.BELUMSAMPAI', 'sent', { category: 'service', billable: false }));
    expect(await t.get().db.$count(messagePricing)).toBe(4);

    const res = await app.inject({ url: '/api/usage', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      freeLimit: 1000,
      used: 2,
      remaining: 998,
      local: { service: 2, serviceBillable: 1, templates: 1 },
      meta: null,
      servicePricingPolicy: 'PAID_EXEMPT',
    });
    expect(res.json().metaError).toBeTruthy();
  });

  it('uses the larger of the live count and the Meta report', async () => {
    const cookie = await setup();
    analytics = () => ({
      json: {
        id: WABA_ID,
        currency: 'IDR',
        pricing_analytics: {
          data: [
            {
              data_points: [
                { start: 1, end: 2, pricing_category: 'SERVICE', pricing_type: 'FREE_CUSTOMER_SERVICE', volume: 990, cost: 0 },
                { start: 2, end: 3, pricing_category: 'SERVICE', pricing_type: 'REGULAR', volume: 15, cost: 1500 },
                { start: 2, end: 3, pricing_category: 'UTILITY', pricing_type: 'REGULAR', volume: 3, cost: 1071 },
              ],
            },
          ],
        },
      },
    });
    await webhook(statusUpdate('wamid.A', 'delivered', { category: 'service', billable: false }));
    const res = await app.inject({ url: '/api/usage', headers: { cookie } });
    expect(res.json()).toMatchObject({
      used: 1005,
      remaining: 0,
      local: { service: 1 },
      meta: { service: 1005, serviceBillable: 15, templates: 3, cost: 2571, currency: 'IDR' },
      metaError: null,
    });
    const call = graph.calls.find((c) => c.query.fields?.startsWith('currency,pricing_analytics'));
    expect(call?.query.fields).toMatch(/^currency,pricing_analytics\.start\(\d+\)\.end\(\d+\)\.granularity\(DAILY\)\.dimensions\(PRICING_CATEGORY,PRICING_TYPE\)$/);
    expect((await app.inject({ url: '/api/usage' })).statusCode).toBe(401);
  });
});
