import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_BUSINESS_HOURS, describeSchedule, type BusinessHoursSettings } from '@wa/shared';
import { holidays, messages } from '../src/db/schema';
import { evaluate, localParts } from '../src/modules/business-hours/schedule';
import { describeClosed, offHoursBlock } from '../src/modules/business-hours/service';
import { WebhookWorker } from '../src/modules/processor/worker';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph } from './helpers/graph';
import { CUSTOMER, inbound, PHONE_ID, sign } from './fixtures/meta';

// 2026-11-02 adalah hari Senin.
const wib = (local: string) => new Date(`${local}+07:00`);
const S = DEFAULT_BUSINESS_HOURS;

describe('schedule', () => {
  it('reads local WIB date, weekday and time', () => {
    expect(localParts(new Date('2026-11-01T17:30:00Z'))).toEqual({ day: '2026-11-02', weekday: 'mon', time: '00:30' });
  });

  it('applies working days, hours and holidays', () => {
    expect(evaluate(S, [], wib('2026-11-02T08:00')).open).toBe(true);
    expect(evaluate(S, [], wib('2026-11-02T16:00'))).toMatchObject({ open: false, reason: 'outside_hours' });
    expect(evaluate(S, [], wib('2026-11-02T07:29'))).toMatchObject({ open: false, reason: 'outside_hours' });
    expect(evaluate(S, [], wib('2026-11-07T09:00'))).toMatchObject({ open: false, reason: 'day_off' });

    const natal = [{ date: '2026-12-25', name: 'Hari Raya Natal', type: 'National Holiday' }];
    expect(evaluate(S, natal, wib('2026-12-25T09:00'))).toMatchObject({ open: false, reason: 'holiday', holidayName: 'Hari Raya Natal' });
    expect(evaluate({ ...S, holidaysAreWorkdays: true }, natal, wib('2026-12-25T09:00')).open).toBe(true);

    const cuti = [{ date: '2026-12-24', name: 'Cuti Bersama Natal', type: 'Joint Holiday' }];
    expect(evaluate(S, cuti, wib('2026-12-24T09:00')).open).toBe(false);
    expect(evaluate({ ...S, jointHolidaysAreHolidays: false }, cuti, wib('2026-12-24T09:00')).open).toBe(true);
    expect(evaluate(S, [{ date: '2026-04-21', name: 'Hari Kartini', type: 'Observance' }], wib('2026-04-21T09:00')).open).toBe(true);
  });

  it('describes the schedule for {jam_kerja}', () => {
    expect(describeSchedule(S.days)).toBe('Senin–Kamis 07.30–16.00, Jumat 07.30–16.30');
  });

  it('groups a whole night into one off-hours period and explains why it is closed', () => {
    const block = (iso: string) => offHoursBlock(S, localParts(wib(iso)));
    expect(block('2026-11-02T17:00')).toBe('2026-11-02');
    expect(block('2026-11-03T05:00')).toBe('2026-11-02');
    expect(block('2026-11-07T05:00')).toBe('2026-11-07'); // Sabtu: hari libur, dihitung per tanggal
    expect(describeClosed({ open: false, reason: 'holiday', holidayName: 'Maulid Nabi (belum pasti)', localTime: '' }, 'mon')).toBe('hari ini *libur Maulid Nabi*');
    expect(describeClosed({ open: false, reason: 'day_off', holidayName: null, localTime: '' }, 'sun')).toBe('hari ini *hari libur akhir pekan*');
    expect(describeClosed({ open: false, reason: 'outside_hours', holidayName: null, localTime: '' }, 'mon')).toBe('saat ini *di luar jam layanan*');
  });
});

const t = useTestDatabase();
let app: AppInstance;
afterEach(async () => {
  await app?.close();
});

let holidayApi: { status: number; body: (year: string) => unknown } = { status: 200, body: () => ({ is_success: true, data: [] }) };
const graph = fakeGraph({
  [`POST ${PHONE_ID}/messages`]: () => ({ json: { messages: [{ id: `wamid.AUTO${Date.now()}${Math.random()}` }] } }),
  'GET https://use.api.co.id/holidays/indonesia/': (c) => ({ status: holidayApi.status, json: holidayApi.body(c.query.year!) }),
});

async function setup(settings: Partial<BusinessHoursSettings> = {}) {
  app = await buildTestApp(t.get(), {}, graph.fetch);
  await seedAccount(t.get());
  await seedUser(t.get(), 'admin');
  await seedUser(t.get(), 'agent');
  graph.calls.length = 0;
  const admin = await loginAs(app, 'admin@kpp.test');
  const res = await app.inject({
    method: 'PUT',
    url: '/api/business-hours',
    headers: { cookie: admin, origin: ORIGIN },
    payload: { ...S, ...settings },
  });
  expect(res.statusCode).toBe(200);
  return { admin, agent: await loginAs(app, 'agent@kpp.test') };
}

const closedEveryDay = Object.fromEntries(Object.entries(S.days).map(([d, s]) => [d, { ...s, active: false }])) as BusinessHoursSettings['days'];
const openAllDay = Object.fromEntries(Object.entries(S.days).map(([d]) => [d, { active: true, start: '00:00', end: '23:59' }])) as BusinessHoursSettings['days'];

async function receive(text: string, from = CUSTOMER) {
  const body = JSON.stringify(inbound.text(text, { from }));
  await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) }, payload: body });
  await new WebhookWorker(app.deps, { error: () => {}, warn: () => {} }).runOnce();
}

const autoReplies = () => t.get().db.select().from(messages).where(eq(messages.sentBySystem, 'auto_reply'));

describe('auto reply', () => {
  it('replies once per day per number outside business hours, filling variables', async () => {
    await setup({ days: closedEveryDay, autoReply: { enabled: true, mode: 'daily', message: '{salam} {nama}. Jam layanan: {jam_kerja}.' } });
    await receive('Halo');
    await receive('Masih di sana?');
    await receive('Halo juga', '6281111111111');
    const rows = await autoReplies();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.text).toMatch(/^Selamat (pagi|siang|sore|malam) Budi Santoso\. Jam layanan: tidak ada jadwal\.$/);
    const sent = graph.calls.filter((c) => c.path === `${PHONE_ID}/messages`);
    expect(sent).toHaveLength(2);
  });

  it('in "every" mode answers each message but merges bursts within a minute', async () => {
    await setup({ days: closedEveryDay, autoReply: { enabled: true, mode: 'every', message: 'Di luar jam kerja.' } });
    await receive('Satu');
    await receive('Dua');
    expect(await autoReplies()).toHaveLength(1);
  });

  it('does not reply inside business hours', async () => {
    await setup({ days: openAllDay, autoReply: { enabled: true, mode: 'every', message: 'x' } });
    await receive('Halo');
    expect(await autoReplies()).toHaveLength(0);
  });

  it('does not reply when disabled', async () => {
    await setup({ days: closedEveryDay, autoReply: { enabled: false, mode: 'every', message: 'x' } });
    await receive('Halo');
    expect(await autoReplies()).toHaveLength(0);
  });

  it('shows the auto reply as sent by "Balasan otomatis"', async () => {
    const { agent } = await setup({ days: closedEveryDay, autoReply: { enabled: true, mode: 'daily', message: 'Otomatis' } });
    await receive('Halo');
    const [row] = await autoReplies();
    const list = await app.inject({ url: `/api/conversations/${row!.conversationId}/messages`, headers: { cookie: agent } });
    const auto = list.json().messages.find((m: { text: string }) => m.text === 'Otomatis');
    expect(auto.sentBy).toEqual({ type: 'system', id: 'auto_reply', name: 'Balasan otomatis' });
  });
});

describe('business hours settings', () => {
  it('lets agents read the status but only admins change it', async () => {
    const { agent } = await setup();
    const res = await app.inject({ url: '/api/business-hours', headers: { cookie: agent } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ holidayApiKeySet: false, status: { open: expect.any(Boolean) } });
    const put = await app.inject({ method: 'PUT', url: '/api/business-hours', headers: { cookie: agent, origin: ORIGIN }, payload: S });
    expect(put.statusCode).toBe(403);
  });

  it('stores the holiday API key encrypted and syncs holidays', async () => {
    const { admin } = await setup();
    const year = new Date().getFullYear();
    holidayApi = {
      status: 200,
      body: (y) => ({
        is_success: true,
        data: [
          { date: `${y}-12-25`, name: 'Hari Raya Natal', type: 'National Holiday' },
          { date: `${y}-12-24`, name: 'Cuti Bersama Natal', type: 'Joint Holiday' },
        ],
        paging: { page: 1, total_page: 1 },
      }),
    };
    const res = await app.inject({
      method: 'PUT',
      url: '/api/business-hours',
      headers: { cookie: admin, origin: ORIGIN },
      payload: { ...S, holidayApiKey: 'kunci-rahasia-api' },
    });
    expect(res.json()).toMatchObject({ holidayApiKeySet: true, holidayError: null });
    expect(JSON.stringify(res.json())).not.toContain('kunci-rahasia-api');
    const call = graph.calls.find((c) => c.path.includes('holidays'));
    expect(call?.query).toMatchObject({ year: String(year), page: '1' });
    expect(await t.get().db.$count(holidays)).toBe(4); // tahun ini dan tahun depan

    holidayApi = { status: 401, body: () => ({ is_success: false, message: 'Unauthorized' }) };
    const failed = await app.inject({ method: 'POST', url: '/api/business-hours/sync-holidays', headers: { cookie: admin, origin: ORIGIN } });
    expect(failed.json()).toMatchObject({ error: 'API key api.co.id ditolak.' });
    expect(await t.get().db.$count(holidays)).toBe(4);
  });
});
