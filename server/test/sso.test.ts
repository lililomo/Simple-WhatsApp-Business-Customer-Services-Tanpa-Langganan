import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { SsoTicketPayload } from '@wa/shared';
import { messages, sessions, users } from '../src/db/schema';
import { portalSignature, signTicket } from '../src/modules/sso/signing';
import { upsertContact, upsertConversation } from '../src/modules/processor/handlers';
import type { AppInstance } from '../src/types';
import { seedAccount } from './helpers/account';
import { buildTestApp, cookieFrom, ORIGIN } from './helpers/app';
import { useTestDatabase } from './helpers/db';

const SECRET = 'rahasia-sso-portal-uji-0123456789abcdef';
const t = useTestDatabase();
let app: AppInstance;
afterEach(async () => {
  await app?.close();
});

const now = () => Math.floor(Date.now() / 1000);
function ticket(over: Partial<SsoTicketPayload> = {}) {
  return signTicket(SECRET, {
    v: 1,
    jti: randomUUID().replace(/-/g, ''),
    nip: '810450539',
    nama: 'Budi Pegawai',
    seksi: 'Seksi Pelayanan',
    jabatan: 'Pelaksana',
    peran: 'agent',
    iat: now(),
    exp: now() + 60,
    sesiBerakhir: now() + 3600,
    ...over,
  });
}

async function setup() {
  app = await buildTestApp(t.get(), { PORTAL_SSO_SECRET: SECRET });
}

const sso = (tk: string) =>
  app.inject({ method: 'POST', url: '/sso/portal', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: new URLSearchParams({ ticket: tk }).toString() });

function signed(method: 'GET' | 'POST', url: string, body = '') {
  const ts = String(now());
  return app.inject({
    method,
    url,
    headers: { 'content-type': 'application/json', 'x-portal-timestamp': ts, 'x-portal-signature': portalSignature(SECRET, ts, method, url, body) },
    ...(body ? { payload: body } : {}),
  });
}

describe('SSO from kppbwi.app', () => {
  it('signs the employee in with a portal ticket, capped at the portal session end', async () => {
    await setup();
    const res = await sso(ticket());
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/chats');
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie: cookieFrom(res) } });
    expect(me.json().user).toMatchObject({ nip: '810450539', name: 'Budi Pegawai', seksi: 'Seksi Pelayanan', role: 'agent', authSource: 'portal', email: null });
    const [session] = await t.get().db.select().from(sessions);
    expect(session!.expiresAt.getTime()).toBeLessThanOrEqual((now() + 3601) * 1000);
    expect(session!.maxExpiresAt).not.toBeNull();
  });

  it('rejects reused, expired and tampered tickets', async () => {
    await setup();
    const tk = ticket();
    expect((await sso(tk)).statusCode).toBe(303);
    const replay = await sso(tk);
    expect(replay.statusCode).toBe(401);
    expect(replay.body).toContain('sudah dipakai');
    expect((await sso(ticket({ iat: now() - 300, exp: now() - 10 }))).statusCode).toBe(401);
    expect((await sso(ticket({ sesiBerakhir: now() - 1 }))).statusCode).toBe(401);
    const [body, sig] = ticket().split('.');
    expect((await sso(`${body}x.${sig}`)).statusCode).toBe(401);
    const forged = signTicket('kunci-lain-yang-salah-0123456789abcdef', JSON.parse(Buffer.from(body!, 'base64url').toString()));
    expect((await sso(forged)).statusCode).toBe(401);
  });

  it('updates the role on the next sign-in and blocks password login for portal accounts', async () => {
    await setup();
    await sso(ticket());
    const again = await sso(ticket({ peran: 'admin', nama: 'Budi P.' }));
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie: cookieFrom(again) } });
    expect(me.json().user).toMatchObject({ role: 'admin', name: 'Budi P.' });
    expect(await t.get().db.$count(users)).toBe(1);
    const pw = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin: ORIGIN }, payload: { email: '', password: 'apa-saja-12345' } });
    expect(pw.statusCode).toBe(400);
  });

  it('ends sessions when the portal logs the employee out or revokes access', async () => {
    await setup();
    const cookie = cookieFrom(await sso(ticket()));
    expect((await app.inject({ method: 'POST', url: '/sso/revoke', headers: { 'content-type': 'application/json' }, payload: '{"nip":"810450539"}' })).statusCode).toBe(401);
    const out = await signed('POST', '/sso/revoke', JSON.stringify({ nip: '810450539' }));
    expect(out.json()).toMatchObject({ ok: true, sessions: 1 });
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);

    await sso(ticket());
    await signed('POST', '/sso/revoke', JSON.stringify({ nip: '810450539', nonaktifkan: true }));
    const [u] = await t.get().db.select().from(users).where(eq(users.nip, '810450539'));
    expect(u!.isActive).toBe(false);
    // Portal memberi akses lagi → aktif kembali.
    expect((await sso(ticket())).statusCode).toBe(303);
  });
});

describe('monthly stats for the portal', () => {
  it('credits each customer turn to the first agent who answers', async () => {
    await setup();
    const account = await seedAccount(t.get());
    const db = t.get().db;
    await sso(ticket());
    const [agent] = await db.select().from(users);
    const contact = await upsertContact(app.deps, '6281234567890', 'Warga', null);
    const conv = await upsertConversation(app.deps, account.id, contact.id);
    const at = (iso: string) => new Date(`${iso}+07:00`);
    const msg = (direction: 'in' | 'out', when: string, extra: Partial<typeof messages.$inferInsert> = {}) => ({
      conversationId: conv.id,
      direction,
      type: 'text',
      status: direction === 'in' ? ('received' as const) : ('read' as const),
      text: 'x',
      waTimestamp: at(when),
      ...extra,
    });
    await db.insert(messages).values([
      // Giliran 1: dua pesan masuk, balasan otomatis (tidak dihitung), lalu petugas menjawab 10 menit kemudian.
      msg('in', '2026-10-05T19:00:00'),
      msg('in', '2026-10-05T19:01:00'),
      msg('out', '2026-10-05T19:01:05', { sentBySystem: 'auto_reply' }),
      msg('out', '2026-10-05T19:10:00', { sentByUserId: agent!.id }),
      msg('out', '2026-10-05T19:11:00', { sentByUserId: agent!.id, type: 'sticker' }),
      // Giliran 2: dijawab sistem lain lewat API.
      msg('in', '2026-10-06T09:00:00'),
      msg('out', '2026-10-06T09:05:00', { sentByApiKeyId: 99 }),
      // Giliran 3: belum dijawab.
      msg('in', '2026-10-30T15:00:00'),
      // Di luar bulan dan di luar jendela 3 hari: tidak dihitung, dan giliran 3 tetap belum terjawab.
      msg('out', '2026-11-05T08:00:00', { sentByUserId: agent!.id }),
    ]);

    const res = await signed('GET', '/sso/stats?month=2026-10');
    expect(res.statusCode).toBe(200);
    const stats = res.json();
    expect(stats.totals).toMatchObject({
      inboundMessages: 4,
      conversations: 1,
      questions: 3,
      questionsAnswered: 1,
      questionsAnsweredByApi: 1,
      questionsUnanswered: 1,
      autoReplies: 1,
      apiMessages: 1,
      agentMessages: 2,
      responseMedianSec: 600,
    });
    expect(stats.agents).toEqual([
      expect.objectContaining({ nip: '810450539', messagesSent: 2, questionsAnswered: 1, conversationsHandled: 1, stickersSent: 1, responseMedianSec: 600, activeDays: 1 }),
    ]);
    expect((await signed('GET', '/sso/stats?month=2026-13')).statusCode).toBe(400);
    expect((await app.inject({ url: '/sso/stats?month=2026-10' })).statusCode).toBe(401);
  });
});
