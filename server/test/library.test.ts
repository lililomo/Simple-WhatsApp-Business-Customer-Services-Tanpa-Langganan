import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { messages, stickers } from '../src/db/schema';
import { WebhookWorker } from '../src/modules/processor/worker';
import { parseWebp } from '../src/modules/stickers/service';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph } from './helpers/graph';
import { inbound, PHONE_ID, sign } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
afterEach(async () => {
  await app?.close();
});

let uploads = 0;
const graph = fakeGraph({
  [`POST ${PHONE_ID}/media`]: () => ({ json: { id: `wa-media-${++uploads}` } }),
  [`POST ${PHONE_ID}/messages`]: () => ({ json: { messages: [{ id: `wamid.OUT${Date.now()}${uploads}` }] } }),
});

async function setup() {
  app = await buildTestApp(t.get(), {}, graph.fetch);
  await seedAccount(t.get());
  await seedUser(t.get(), 'admin');
  await seedUser(t.get(), 'agent');
  graph.calls.length = 0;
  uploads = 0;
  return { admin: await loginAs(app, 'admin@kpp.test'), agent: await loginAs(app, 'agent@kpp.test') };
}

const req = (cookie: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload ? { payload } : {}) });

/** WebP palsu dengan header VP8X yang cukup untuk dibaca parseWebp. */
function fakeWebp(size = 512, opts: { animated?: boolean; bytes?: number; seed?: number } = {}) {
  const buf = Buffer.alloc(opts.bytes ?? 2000, opts.seed ?? 1);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(buf.length - 8, 4);
  buf.write('WEBPVP8X', 8, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf[20] = opts.animated ? 0x02 : 0;
  buf.writeUIntLE(size - 1, 24, 3);
  buf.writeUIntLE(size - 1, 27, 3);
  return buf;
}

function multipart(data: Buffer, name = 'stiker.webp') {
  const boundary = '----uji';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/webp\r\n\r\n`;
  return {
    payload: Buffer.concat([Buffer.from(head), data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function uploadSticker(cookie: string, data: Buffer) {
  const body = multipart(data);
  return app.inject({ method: 'POST', url: '/api/stickers', headers: { cookie, origin: ORIGIN, ...body.headers }, payload: body.payload });
}

async function openConversation() {
  const body = JSON.stringify(inbound.text('Halo'));
  await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) }, payload: body });
  await new WebhookWorker(app.deps, { error: () => {}, warn: () => {} }).runOnce();
  const [msg] = await t.get().db.select({ conversationId: messages.conversationId }).from(messages);
  return String(msg!.conversationId);
}

describe('quick replies', () => {
  it('lets any user create, use, edit and delete shared quick replies', async () => {
    const { admin, agent } = await setup();
    const created = await req(agent, 'POST', '/api/quick-replies', { title: 'Salam pembuka', shortcut: 'Salam', body: '{salam} {nama}, ada yang bisa kami bantu?' });
    expect(created.statusCode).toBe(201);
    const qr = created.json().quickReply;
    expect(qr.shortcut).toBe('salam');

    const dup = await req(admin, 'POST', '/api/quick-replies', { title: 'Lain', shortcut: 'salam', body: 'x' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('shortcut_taken');

    await req(admin, 'POST', `/api/quick-replies/${qr.id}/use`);
    const updated = await req(admin, 'PUT', `/api/quick-replies/${qr.id}`, { title: 'Salam', shortcut: '', body: 'Halo' });
    expect(updated.json().quickReply).toMatchObject({ shortcut: null, body: 'Halo', usageCount: 1 });

    const list = await req(agent, 'GET', '/api/quick-replies');
    expect(list.json().quickReplies).toHaveLength(1);
    expect((await req(agent, 'DELETE', `/api/quick-replies/${qr.id}`)).statusCode).toBe(200);
    expect((await req(agent, 'GET', '/api/quick-replies')).json().quickReplies).toHaveLength(0);
  });

  it('rejects shortcuts with spaces and requires login', async () => {
    const { agent } = await setup();
    expect((await req(agent, 'POST', '/api/quick-replies', { title: 'A', shortcut: 'dua kata', body: 'x' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/quick-replies' })).statusCode).toBe(401);
  });
});

describe('emoji history', () => {
  it('keeps one shared, most-recent-first list', async () => {
    const { admin, agent } = await setup();
    await req(admin, 'POST', '/api/emoji/usage', { emojis: ['👍', '🙏'] });
    await new Promise((r) => setTimeout(r, 5));
    await req(agent, 'POST', '/api/emoji/usage', { emojis: ['🇮🇩', '👍🏽'] });
    const recent = await req(admin, 'GET', '/api/emoji/recent');
    expect(recent.json().emojis.slice(0, 2).sort()).toEqual(['👍🏽', '🇮🇩'].sort());
    expect(recent.json().emojis).toHaveLength(4);
  });
});

describe('stickers', () => {
  it('parses WebP headers', () => {
    expect(parseWebp(fakeWebp(512))).toEqual({ width: 512, height: 512, animated: false });
    expect(parseWebp(fakeWebp(512, { animated: true }))?.animated).toBe(true);
    expect(parseWebp(Buffer.from('bukan webp sama sekali, hanya teks biasa.'))).toBeNull();
  });

  it('validates size and format, and de-duplicates by content', async () => {
    const { agent } = await setup();
    expect((await uploadSticker(agent, fakeWebp(256))).statusCode).toBe(400);
    expect((await uploadSticker(agent, fakeWebp(512, { bytes: 120 * 1024 }))).json().error.code).toBe('sticker_too_large');
    expect((await uploadSticker(agent, fakeWebp(512, { animated: true, bytes: 120 * 1024 }))).statusCode).toBe(201);
    const a = await uploadSticker(agent, fakeWebp(512, { seed: 7 }));
    const b = await uploadSticker(agent, fakeWebp(512, { seed: 7 }));
    expect(a.json().sticker.id).toBe(b.json().sticker.id);
    expect(await t.get().db.$count(stickers)).toBe(2);
    const file = await req(agent, 'GET', `/api/stickers/${a.json().sticker.id}/file`);
    expect(file.headers['content-type']).toBe('image/webp');
  });

  it('sends a sticker, uploading it to Meta only once', async () => {
    const { agent } = await setup();
    const conversationId = await openConversation();
    const sticker = (await uploadSticker(agent, fakeWebp(512))).json().sticker;
    for (const ref of ['stiker-kirim-1', 'stiker-kirim-2']) {
      const res = await req(agent, 'POST', `/api/conversations/${conversationId}/messages`, { type: 'sticker', stickerId: sticker.id, clientRef: ref });
      expect(res.statusCode).toBe(201);
      expect(res.json().message).toMatchObject({ type: 'sticker', status: 'accepted', media: { mimeType: 'image/webp' } });
    }
    expect(graph.calls.filter((c) => c.path === `${PHONE_ID}/media`)).toHaveLength(1);
    const sent = graph.calls.filter((c) => c.path === `${PHONE_ID}/messages`);
    expect(sent[0]!.body).toMatchObject({ type: 'sticker', sticker: { id: 'wa-media-1' } });
    const [row] = await t.get().db.select().from(stickers).where(eq(stickers.id, Number(sticker.id)));
    expect(row!.usageCount).toBe(2);
  });
});
