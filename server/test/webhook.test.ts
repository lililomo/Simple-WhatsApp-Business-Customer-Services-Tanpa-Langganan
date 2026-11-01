import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import type { RealtimeEvent } from '@wa/shared';
import { contacts, conversations, media, messages, templates, waAccounts, webhookEvents } from '../src/db/schema';
import type { BusEvent } from '../src/lib/bus';
import { loadMessage } from '../src/modules/conversations/dto';
import { WebhookWorker } from '../src/modules/processor/worker';
import type { AppInstance } from '../src/types';
import { APP_SECRET, VERIFY_TOKEN, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph } from './helpers/graph';
import { CUSTOMER, inbound, newWamid, sign, statusUpdate, templateStatusUpdate } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
let worker: WebhookWorker;
let events: BusEvent[];
let storageDir: string;

const IMAGE_BYTES = Buffer.from('ffd8ffe000104a464946', 'hex');
const graph = fakeGraph({
  'GET media-image-1': () => ({ json: { url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg' } }),
  'GET https://lookaside.fbsbx.com/whatsapp_business/attachments/': () => ({ body: IMAGE_BYTES, contentType: 'image/jpeg' }),
  'GET media-doc-1': () => ({ status: 404, json: { error: { code: 100, message: 'media expired' } } }),
});

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), 'wa-inbox-test-'));
});
afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
});

async function setup() {
  app = await buildTestApp(t.get(), { STORAGE_DIR: storageDir }, graph.fetch);
  await seedAccount(t.get());
  worker = new WebhookWorker(app.deps, { error: () => {}, warn: () => {} });
  events = [];
  app.deps.bus.on((e) => events.push(e));
}
afterEach(async () => {
  await app?.close();
});

async function post(payload: unknown, secret = APP_SECRET) {
  const body = JSON.stringify(payload);
  return app.inject({
    method: 'POST',
    url: '/webhooks/meta',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, secret) },
    payload: body,
  });
}

async function deliver(payload: unknown) {
  const res = await post(payload);
  expect(res.statusCode).toBe(200);
  await worker.runOnce();
}

const realtime = () => events.filter((e): e is RealtimeEvent => e.type !== 'webhook.stored');

describe('webhook verification', () => {
  it('echoes the challenge only for the right verify token', async () => {
    await setup();
    const ok = await app.inject({ url: `/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444` });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe('1158201444');
    const bad = await app.inject({ url: '/webhooks/meta?hub.mode=subscribe&hub.verify_token=salah&hub.challenge=1' });
    expect(bad.statusCode).toBe(403);
  });
});

describe('webhook receive', () => {
  it('rejects bad signatures without storing the payload', async () => {
    await setup();
    const res = await post(inbound.text('halo'), 'secret-salah');
    expect(res.statusCode).toBe(401);
    const unsigned = await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json' }, payload: '{}' });
    expect(unsigned.statusCode).toBe(401);
    expect(await t.get().db.$count(webhookEvents)).toBe(0);
  });

  it('rejects bodies over 3 MB', async () => {
    await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/meta',
      headers: { 'content-type': 'application/json' },
      payload: 'x'.repeat(3 * 1024 * 1024 + 10),
    });
    expect(res.statusCode).toBe(413);
  });

  it('stores, acknowledges, then processes an inbound text message', async () => {
    await setup();
    const at = new Date(Date.now() - 60_000);
    const res = await post(inbound.text('Selamat pagi, mau tanya NPWP', { at }));
    expect(res.statusCode).toBe(200);
    expect(await t.get().db.$count(webhookEvents, eq(webhookEvents.status, 'pending'))).toBe(1);

    expect(await worker.runOnce()).toBe(1);
    const [event] = await t.get().db.select().from(webhookEvents);
    expect(event!.status).toBe('done');

    const [contact] = await t.get().db.select().from(contacts);
    expect(contact).toMatchObject({ waId: CUSTOMER, profileName: 'Budi Santoso' });
    const [conv] = await t.get().db.select().from(conversations);
    expect(conv!.unreadCount).toBe(1);
    expect(conv!.lastMessagePreview).toBe('Selamat pagi, mau tanya NPWP');
    expect(conv!.cswExpiresAt!.getTime()).toBe(Math.floor(at.getTime() / 1000) * 1000 + 24 * 3600 * 1000);
    const [msg] = await t.get().db.select().from(messages);
    expect(msg).toMatchObject({ direction: 'in', type: 'text', status: 'received', text: 'Selamat pagi, mau tanya NPWP' });

    const [account] = await t.get().db.select().from(waAccounts);
    expect(account!.lastWebhookAt).not.toBeNull();
    const created = realtime().find((e) => e.type === 'message.created');
    expect(created).toMatchObject({ message: { text: 'Selamat pagi, mau tanya NPWP' }, conversation: { unreadCount: 1, contact: { name: 'Budi Santoso' } } });
  });

  it('is idempotent when Meta redelivers the same message', async () => {
    await setup();
    const payload = inbound.text('halo', { id: newWamid() });
    await deliver(payload);
    await deliver(payload);
    expect(await t.get().db.$count(messages)).toBe(1);
    const [conv] = await t.get().db.select().from(conversations);
    expect(conv!.unreadCount).toBe(1);
  });

  it('downloads inbound media and serves it to logged-in users only', async () => {
    await setup();
    await deliver(inbound.image('Bukti setor'));
    const [row] = await t.get().db.select().from(media);
    expect(row).toMatchObject({ status: 'ready', mimeType: 'image/jpeg', fileSize: IMAGE_BYTES.length });
    expect(row!.storagePath).toMatch(/^media\/\d{4}\/\d{2}\/[0-9a-f]{64}\.jpg$/);
    const [conv] = await t.get().db.select().from(conversations);
    expect(conv!.lastMessagePreview).toBe('📷 Foto: Bukti setor');

    expect((await app.inject({ url: `/api/media/${row!.id}` })).statusCode).toBe(401);
    await seedUser(t.get(), 'agent', 'petugas@kpp.test');
    const cookie = await loginAs(app, 'petugas@kpp.test');
    const file = await app.inject({ url: `/api/media/${row!.id}`, headers: { cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['content-security-policy']).toMatch(/sandbox/);
    expect(file.rawPayload.equals(IMAGE_BYTES)).toBe(true);
    expect(realtime().filter((e) => e.type === 'message.updated')).toHaveLength(1);
  });

  it('marks media failed when Meta no longer has it', async () => {
    await setup();
    await deliver(inbound.document('SPT-2025.pdf'));
    const [row] = await t.get().db.select().from(media);
    expect(row).toMatchObject({ status: 'failed', fileName: 'SPT-2025.pdf' });
    const [conv] = await t.get().db.select().from(conversations);
    expect(conv!.lastMessagePreview).toBe('📄 Dokumen: SPT-2025.pdf');
  });

  it('extracts readable text from every inbound type', async () => {
    await setup();
    const cases: [unknown, string, string | null][] = [
      [inbound.location(), 'location', 'KPP Pratama Banyuwangi, Jl. Adi Sucipto'],
      [inbound.contacts(), 'contacts', 'Siti Aminah'],
      [inbound.buttonReply('Ya, lanjut'), 'interactive', 'Ya, lanjut'],
      [inbound.listReply('NPWP', 'Pendaftaran NPWP'), 'interactive', 'NPWP — Pendaftaran NPWP'],
      [inbound.templateButton('Hubungi petugas'), 'button', 'Hubungi petugas'],
      [inbound.unsupported(), 'unsupported', null],
    ];
    for (const [payload] of cases) await post(payload);
    await worker.runOnce();
    const rows = await t.get().db.select().from(messages).orderBy(asc(messages.id));
    expect(rows.map((r) => [r.type, r.text])).toEqual(cases.map(([, type, text]) => [type, text]));
    expect(rows.at(-1)!.errorCode).toBe(131051);
  });

  it('applies reactions to the target and keeps reply context', async () => {
    await setup();
    const first = newWamid();
    await deliver(inbound.text('Pertanyaan pertama', { id: first }));
    await deliver(inbound.text('Ini lanjutannya', { context: { from: CUSTOMER, id: first } }));
    await deliver(inbound.reaction(first, '👍'));

    const rows = await t.get().db.select().from(messages).orderBy(asc(messages.id));
    expect(rows[0]!.reactionEmoji).toBe('👍');
    const reply = await loadMessage(t.get().db, rows[1]!.id);
    expect(reply!.replyTo).toEqual({ wamid: first, preview: 'Pertanyaan pertama', direction: 'in' });
    const [conv] = await t.get().db.select().from(conversations);
    expect(conv!.unreadCount).toBe(2);
  });
});

describe('status updates', () => {
  async function outbound(wamid: string) {
    await deliver(inbound.text('halo'));
    const [conv] = await t.get().db.select().from(conversations);
    await t.get().db.insert(messages).values({ conversationId: conv!.id, wamid, direction: 'out', type: 'text', status: 'accepted', text: 'Balasan' });
    const [row] = await t.get().db.select().from(messages).where(eq(messages.wamid, wamid));
    return row!;
  }

  it('only moves forward even when statuses arrive out of order', async () => {
    await setup();
    const wamid = newWamid();
    const msg = await outbound(wamid);
    await deliver(statusUpdate(wamid, 'sent', { category: 'service' }));
    await deliver(statusUpdate(wamid, 'read'));
    await deliver(statusUpdate(wamid, 'delivered'));
    await deliver(statusUpdate(wamid, 'failed', { errorCode: 131026 }));
    const [row] = await t.get().db.select().from(messages).where(eq(messages.id, msg.id));
    expect(row).toMatchObject({ status: 'read', pricingCategory: 'service', pricingBillable: true, errorCode: null });
    expect(row!.sentAt && row!.deliveredAt && row!.readAt).toBeTruthy();
  });

  it('records failures with an Indonesian explanation', async () => {
    await setup();
    const wamid = newWamid();
    const msg = await outbound(wamid);
    await deliver(statusUpdate(wamid, 'failed', { errorCode: 131047 }));
    const dto = await loadMessage(t.get().db, msg.id);
    expect(dto).toMatchObject({ status: 'failed', error: { code: 131047, message: 'Lebih dari 24 jam sejak pesan terakhir pelanggan. Kirim template.' } });
  });

  it('retries a status for an unknown message briefly, then gives up', async () => {
    await setup();
    await post(statusUpdate(newWamid(), 'delivered'));
    await worker.runOnce();
    const [event] = await t.get().db.select().from(webhookEvents);
    expect(event).toMatchObject({ status: 'pending', attempts: 1 });
    // Event lama (lebih dari 2 menit): dianggap pesan dari aplikasi lain dan diabaikan.
    await t.get().db
      .update(webhookEvents)
      .set({ receivedAt: new Date(Date.now() - 10 * 60_000), nextAttemptAt: new Date() })
      .where(eq(webhookEvents.id, event!.id));
    await worker.runOnce();
    const [after] = await t.get().db.select().from(webhookEvents);
    expect(after!.status).toBe('done');
  });
});

describe('other webhook fields and admin tools', () => {
  it('updates template status from Meta', async () => {
    await setup();
    const [account] = await t.get().db.select().from(waAccounts);
    await t.get().db.insert(templates).values({
      waAccountId: account!.id,
      metaTemplateId: '987654',
      name: 'penyampaian_spt',
      language: 'id',
      category: 'MARKETING',
      status: 'PENDING',
      components: [],
      syncedAt: new Date(),
    });
    await deliver(templateStatusUpdate('987654', 'penyampaian_spt', 'APPROVED'));
    const [tpl] = await t.get().db.select().from(templates);
    expect(tpl!.status).toBe('APPROVED');
  });

  it('marks malformed payloads failed and lets admins replay events', async () => {
    await setup();
    const body = '{"entry": [';
    await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) }, payload: body });
    await worker.runOnce();
    const [event] = await t.get().db.select().from(webhookEvents);
    expect(event!.status).toBe('failed');

    await seedUser(t.get());
    const cookie = await loginAs(app, 'admin@kpp.test');
    const list = await app.inject({ url: '/api/admin/webhook-events?status=failed', headers: { cookie } });
    expect(list.json().events).toHaveLength(1);
    const replay = await app.inject({ method: 'POST', url: `/api/admin/webhook-events/${event!.id}/replay`, headers: { cookie, origin: ORIGIN } });
    expect(replay.statusCode).toBe(200);
    const [after] = await t.get().db.select().from(webhookEvents);
    expect(after).toMatchObject({ status: 'pending', attempts: 0 });
  });
});
