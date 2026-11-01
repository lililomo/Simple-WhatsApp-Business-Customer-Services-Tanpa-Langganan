import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ConversationDTO, MessageDTO } from '@wa/shared';
import { conversations } from '../src/db/schema';
import { WebhookWorker } from '../src/modules/processor/worker';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph } from './helpers/graph';
import { inbound, newWamid, PHONE_ID, sign } from './fixtures/meta';

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
  graph.calls.length = 0;
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

const get = async <T>(url: string) => (await app.inject({ url, headers: { cookie } })).json() as T;

describe('conversation list', () => {
  it('orders by latest message, filters, searches and paginates', async () => {
    await setup();
    const base = Date.now() - 3 * 24 * 3600_000;
    await receive(inbound.text('Pesan lama dari Andi', { from: '6281111111111', name: 'Andi', at: new Date(base) }));
    await receive(inbound.text('Tanya NPWP dong', { from: '6282222222222', name: 'Bunga', at: new Date(Date.now() - 3600_000) }));
    await receive(inbound.text('Halo KPP', { from: '6283333333333', name: 'Citra', at: new Date(Date.now() - 60_000) }));

    const all = await get<{ conversations: ConversationDTO[] }>('/api/conversations');
    expect(all.conversations.map((c) => c.contact.name)).toEqual(['Citra', 'Bunga', 'Andi']);

    const open = await get<{ conversations: ConversationDTO[] }>('/api/conversations?filter=open');
    expect(open.conversations.map((c) => c.contact.name)).toEqual(['Citra', 'Bunga']);

    const byText = await get<{ conversations: ConversationDTO[] }>('/api/conversations?q=npwp');
    expect(byText.conversations.map((c) => c.contact.name)).toEqual(['Bunga']);
    const byNumber = await get<{ conversations: ConversationDTO[] }>('/api/conversations?q=0811111');
    expect(byNumber.conversations.map((c) => c.contact.name)).toEqual(['Andi']);

    const page1 = await get<{ conversations: ConversationDTO[]; nextCursor: string }>('/api/conversations?limit=2');
    expect(page1.conversations).toHaveLength(2);
    const page2 = await get<{ conversations: ConversationDTO[]; nextCursor: string | null }>(
      `/api/conversations?limit=2&cursor=${page1.nextCursor}`,
    );
    expect(page2.conversations.map((c) => c.contact.name)).toEqual(['Andi']);
    expect(page2.nextCursor).toBeNull();

    const summary = await get<{ unreadConversations: number; unreadMessages: number }>('/api/conversations/summary');
    expect(summary).toEqual({ unreadConversations: 3, unreadMessages: 3 });
  });
});

describe('messages and read state', () => {
  it('pages messages oldest-first and hides reactions', async () => {
    await setup();
    const first = newWamid();
    await receive(inbound.text('satu', { id: first }));
    await receive(inbound.text('dua'));
    await receive(inbound.text('tiga'));
    await receive(inbound.reaction(first, '❤️'));
    const [conv] = await t.get().db.select().from(conversations);

    const latest = await get<{ messages: MessageDTO[]; hasMore: boolean }>(`/api/conversations/${conv!.id}/messages?limit=2`);
    expect(latest.messages.map((m) => m.text)).toEqual(['dua', 'tiga']);
    expect(latest.hasMore).toBe(true);
    const older = await get<{ messages: MessageDTO[]; hasMore: boolean }>(
      `/api/conversations/${conv!.id}/messages?limit=2&before=${latest.messages[0]!.id}`,
    );
    expect(older.messages.map((m) => [m.text, m.reactionEmoji])).toEqual([['satu', '❤️']]);
    expect(older.hasMore).toBe(false);
  });

  it('marks a conversation read and sends one read receipt to Meta', async () => {
    await setup();
    const last = newWamid();
    await receive(inbound.text('a'));
    await receive(inbound.text('b', { id: last }));
    const [conv] = await t.get().db.select().from(conversations);
    expect(conv!.unreadCount).toBe(2);

    const res = await app.inject({ method: 'POST', url: `/api/conversations/${conv!.id}/read`, headers: { cookie, origin: ORIGIN } });
    expect(res.statusCode).toBe(200);
    const [after] = await t.get().db.select().from(conversations).where(eq(conversations.id, conv!.id));
    expect(after!.unreadCount).toBe(0);
    const receipts = graph.calls.filter((c) => c.path === `${PHONE_ID}/messages`);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.body).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: last });

    // Sudah terbaca: tidak mengirim receipt lagi.
    await app.inject({ method: 'POST', url: `/api/conversations/${conv!.id}/read`, headers: { cookie, origin: ORIGIN } });
    expect(graph.calls.filter((c) => c.path === `${PHONE_ID}/messages`)).toHaveLength(1);
  });

  it('renames a contact for all agents', async () => {
    await setup();
    await receive(inbound.text('halo', { name: 'budi123' }));
    const [conv] = await t.get().db.select().from(conversations);
    const events: string[] = [];
    app.deps.bus.on((e) => events.push(e.type));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/contacts/${conv!.contactId}`,
      headers: { cookie, origin: ORIGIN },
      payload: { displayName: 'Budi (PT Maju Jaya)' },
    });
    expect(res.json().contact).toMatchObject({ name: 'Budi (PT Maju Jaya)', profileName: 'budi123' });
    expect(events).toContain('conversation.updated');
  });
});

describe('realtime stream', () => {
  it('streams bus events to a logged-in browser', async () => {
    await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const unauth = await fetch(`http://127.0.0.1:${port}/api/events`);
    expect(unauth.status).toBe(401);

    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie }, signal: ctrl.signal });
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain('event: hello');

    app.deps.bus.emit({ type: 'connection.updated' });
    app.deps.bus.emit({ type: 'webhook.stored' });
    while (!text.includes('connection.updated')) text += decoder.decode((await reader.read()).value);
    expect(text).toContain('event: connection.updated');
    expect(text).not.toContain('webhook.stored');
    ctrl.abort();
  });
});
