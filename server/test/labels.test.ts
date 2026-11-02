import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ConversationDTO, LabelDTO, LabelWithUsageDTO } from '@wa/shared';
import { contactLabels, conversations, messages } from '../src/db/schema';
import type { BusEvent } from '../src/lib/bus';
import { WebhookWorker } from '../src/modules/processor/worker';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph } from './helpers/graph';
import { inbound, PHONE_ID, sign } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
let cookie: string;
afterEach(async () => {
  await app?.close();
});

const graph = fakeGraph({ [`POST ${PHONE_ID}/messages`]: () => ({ json: { success: true } }) });

async function setup() {
  app = await buildTestApp(t.get(), {}, graph.fetch);
  await seedAccount(t.get());
  await seedUser(t.get(), 'agent', 'petugas@kpp.test');
  cookie = await loginAs(app, 'petugas@kpp.test');
}

async function receive(payload: unknown) {
  const body = JSON.stringify(payload);
  await app.inject({
    method: 'POST',
    url: '/webhooks/meta',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) },
    payload: body,
  });
  await new WebhookWorker(app.deps, { error: () => {}, warn: () => {} }).runOnce();
}

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN },
    ...(payload ? { payload: payload as object } : {}),
  });

async function createLabel(name: string, color: string): Promise<LabelDTO> {
  const res = await call('POST', '/api/labels', { name, color });
  expect(res.statusCode).toBe(201);
  return res.json().label;
}

async function sendOut(conversationId: number, extra: Partial<typeof messages.$inferInsert> = {}) {
  await t
    .get()
    .db.insert(messages)
    .values({ conversationId, direction: 'out', type: 'text', status: 'sent', text: 'balasan', ...extra });
}

describe('labels', () => {
  it('manages shared labels and tags contacts with them', async () => {
    await setup();
    const events: BusEvent[] = [];
    app.deps.bus.on((e) => events.push(e));

    const pelayanan = await createLabel('Pelayanan', '#2563eb');
    expect(pelayanan).toMatchObject({ name: 'Pelayanan', color: '#2563EB' });
    expect(events).toContainEqual({ type: 'library.updated', resource: 'labels' });
    const penyuluh = await createLabel('Penyuluh', '#16A34A');
    expect((await call('POST', '/api/labels', { name: 'pelayanan', color: '#000000' })).statusCode).toBe(409);
    expect((await call('POST', '/api/labels', { name: 'Merah', color: 'red' })).statusCode).toBe(400);
    expect((await call('POST', '/api/labels', { name: '  ', color: '#000000' })).statusCode).toBe(400);

    await receive(inbound.text('halo', { from: '6281111111111', name: 'Andi' }));
    await receive(inbound.text('permisi', { from: '6282222222222', name: 'Bunga' }));
    const [andi, bunga] = await t.get().db.select().from(conversations).orderBy(conversations.id);

    events.length = 0;
    const put = await call('PUT', `/api/conversations/${andi!.id}/labels/${penyuluh.id}`);
    expect(put.statusCode).toBe(200);
    expect(put.json().conversation.labels).toEqual([penyuluh]);
    // Idempoten; urutan label mengikuti urutan label dibuat.
    await call('PUT', `/api/conversations/${andi!.id}/labels/${penyuluh.id}`);
    const both = (await call('PUT', `/api/conversations/${andi!.id}/labels/${pelayanan.id}`)).json()
      .conversation as ConversationDTO;
    expect(both.labels.map((l) => l.name)).toEqual(['Pelayanan', 'Penyuluh']);
    expect(
      events.some((e) => e.type === 'conversation.updated' && e.conversation.id === String(andi!.id)),
    ).toBe(true);
    expect((await call('PUT', `/api/conversations/${andi!.id}/labels/999999`)).statusCode).toBe(404);

    const list = (await call('GET', '/api/conversations')).json().conversations as ConversationDTO[];
    expect(list.find((c) => c.contact.name === 'Andi')?.labels).toHaveLength(2);
    expect(list.find((c) => c.contact.name === 'Bunga')?.labels).toEqual([]);
    const filtered = (await call('GET', `/api/conversations?label=${pelayanan.id}`)).json()
      .conversations as ConversationDTO[];
    expect(filtered.map((c) => c.contact.name)).toEqual(['Andi']);
    expect(
      (await call('GET', `/api/conversations?label=${pelayanan.id}&filter=unread&q=and`)).json()
        .conversations,
    ).toHaveLength(1);

    const usage = (await call('GET', '/api/labels')).json().labels as LabelWithUsageDTO[];
    expect(usage.map((l) => [l.name, l.contactCount])).toEqual([
      ['Pelayanan', 1],
      ['Penyuluh', 1],
    ]);

    // Ubah nama/warna terlihat di percakapan.
    const renamed = await call('PUT', `/api/labels/${penyuluh.id}`, { name: 'Penyuluhan', color: '#9333EA' });
    expect(renamed.json().label).toMatchObject({ name: 'Penyuluhan', color: '#9333EA' });
    const after = (await call('GET', `/api/conversations/${andi!.id}`)).json()
      .conversation as ConversationDTO;
    expect(after.labels.map((l) => l.name)).toEqual(['Pelayanan', 'Penyuluhan']);

    const removed = await call('DELETE', `/api/conversations/${andi!.id}/labels/${pelayanan.id}`);
    expect(removed.json().conversation.labels.map((l: LabelDTO) => l.name)).toEqual(['Penyuluhan']);

    // Hapus label melepasnya dari semua kontak.
    await call('PUT', `/api/conversations/${bunga!.id}/labels/${penyuluh.id}`);
    expect((await call('DELETE', `/api/labels/${penyuluh.id}`)).statusCode).toBe(200);
    expect(await t.get().db.$count(contactLabels)).toBe(0);
    expect((await call('GET', `/api/conversations/${bunga!.id}`)).json().conversation.labels).toEqual([]);
    expect((await call('DELETE', `/api/labels/${penyuluh.id}`)).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/labels' })).statusCode).toBe(401);
  });
});

describe('mark as unread', () => {
  it('counts the messages from the other side since our last reply', async () => {
    await setup();
    await receive(inbound.text('satu'));
    await receive(inbound.text('dua'));
    const [conv] = await t.get().db.select().from(conversations);
    const unread = async () => {
      const res = await call('POST', `/api/conversations/${conv!.id}/unread`);
      expect(res.statusCode).toBe(200);
      return (res.json().conversation as ConversationDTO).unreadCount;
    };

    // Belum pernah dibalas: semua pesan masuk sejak awal.
    await call('POST', `/api/conversations/${conv!.id}/read`);
    expect(await unread()).toBe(2);

    // Balasan otomatis dan pesan gagal bukan balasan petugas.
    await sendOut(conv!.id, { sentBySystem: 'auto_reply' });
    await sendOut(conv!.id, { status: 'failed' });
    await receive(inbound.text('tiga'));
    expect(await unread()).toBe(3);

    await sendOut(conv!.id);
    await receive(inbound.text('empat'));
    await receive(inbound.text('lima'));
    const last = (
      await t
        .get()
        .db.select()
        .from(messages)
        .where(eq(messages.conversationId, conv!.id))
        .orderBy(messages.id)
    ).at(-1)!;
    await receive(inbound.reaction(last.wamid!, '👍'));
    expect(await unread()).toBe(2);

    // Pesan terakhir dari kita: tetap ditandai belum dibaca (1).
    await sendOut(conv!.id);
    expect(await unread()).toBe(1);
    const summary = (await call('GET', '/api/conversations/summary')).json();
    expect(summary).toEqual({ unreadConversations: 1, unreadMessages: 1 });

    expect((await call('POST', '/api/conversations/999999/unread')).statusCode).toBe(404);
  });
});
