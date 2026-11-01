import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { looksLikeSensitiveNumber } from '@wa/shared';
import { conversations, media, messages, waAccounts } from '../src/db/schema';
import { WebhookWorker } from '../src/modules/processor/worker';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph, metaError, type GraphCall } from './helpers/graph';
import { CUSTOMER, inbound, newWamid, PHONE_ID, sign } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
let cookie: string;
let storageDir: string;
let sendReply: (c: GraphCall) => { status?: number; json?: unknown } = () => ({ json: { messages: [{ id: 'wamid.OUT1' }] } });
const graph = fakeGraph({
  [`POST ${PHONE_ID}/messages`]: (c) => sendReply(c),
  [`POST ${PHONE_ID}/media`]: () => ({ json: { id: 'meta-media-777' } }),
});

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), 'wa-send-test-'));
});
afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
});
afterEach(async () => {
  await app?.close();
  sendReply = () => ({ json: { messages: [{ id: 'wamid.OUT1' }] } });
});

async function setup(opts: { inboundAt?: Date } = {}) {
  app = await buildTestApp(t.get(), { STORAGE_DIR: storageDir }, graph.fetch);
  await seedAccount(t.get());
  await seedUser(t.get(), 'agent', 'petugas@kpp.test');
  cookie = await loginAs(app, 'petugas@kpp.test');
  const wamid = newWamid();
  const body = JSON.stringify(inbound.text('Mau tanya', { id: wamid, at: opts.inboundAt }));
  await app.inject({ method: 'POST', url: '/webhooks/meta', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) }, payload: body });
  await new WebhookWorker(app.deps, { error: () => {}, warn: () => {} }).runOnce();
  const [conv] = await t.get().db.select().from(conversations);
  const [inMsg] = await t.get().db.select().from(messages);
  graph.calls.length = 0;
  return { convId: conv!.id, inboundId: inMsg!.id, inboundWamid: wamid };
}

const send = (convId: number, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: `/api/conversations/${convId}/messages`, headers: { cookie, origin: ORIGIN }, payload });

describe('sending replies', () => {
  it('sends a text reply with context and records who sent it', async () => {
    const { convId, inboundId, inboundWamid } = await setup();
    const res = await send(convId, { type: 'text', text: 'Silakan, *Bapak*. Ada yang bisa dibantu?', replyTo: String(inboundId), clientRef: 'ref-00000001' });
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatchObject({ status: 'accepted', wamid: 'wamid.OUT1', direction: 'out', sentBy: { type: 'user', name: 'Petugas' }, clientRef: 'ref-00000001' });
    expect(res.json().message.replyTo).toMatchObject({ wamid: inboundWamid, preview: 'Mau tanya' });

    const call = graph.calls.find((c) => c.path === `${PHONE_ID}/messages`)!;
    expect(call.body).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: CUSTOMER,
      context: { message_id: inboundWamid },
      type: 'text',
      text: { body: 'Silakan, *Bapak*. Ada yang bisa dibantu?', preview_url: false },
    });
    const [conv] = await t.get().db.select().from(conversations);
    expect(conv).toMatchObject({ lastMessageDirection: 'out', lastMessagePreview: 'Silakan, *Bapak*. Ada yang bisa dibantu?', unreadCount: 1 });
  });

  it('does not send twice for the same clientRef', async () => {
    const { convId } = await setup();
    await send(convId, { type: 'text', text: 'halo', clientRef: 'ref-dupe-0001' });
    await send(convId, { type: 'text', text: 'halo', clientRef: 'ref-dupe-0001' });
    expect(graph.calls.filter((c) => c.path === `${PHONE_ID}/messages`)).toHaveLength(1);
    expect(await t.get().db.$count(messages, eq(messages.direction, 'out'))).toBe(1);
  });

  it('refuses free-form messages outside the 24-hour window without calling Meta', async () => {
    const { convId } = await setup({ inboundAt: new Date(Date.now() - 25 * 3600_000) });
    const res = await send(convId, { type: 'text', text: 'halo', clientRef: 'ref-window-01' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('window_closed');
    expect(graph.calls).toHaveLength(0);
  });

  it('keeps a Meta rejection as a failed message with an explanation, and can retry', async () => {
    const { convId } = await setup();
    sendReply = () => metaError(131047, 'Re-engagement message');
    const res = await send(convId, { type: 'text', text: 'halo', clientRef: 'ref-fail-0001' });
    expect(res.statusCode).toBe(201);
    expect(res.json().message).toMatchObject({ status: 'failed', error: { code: 131047, message: expect.stringMatching(/24 jam/) } });

    sendReply = () => ({ json: { messages: [{ id: 'wamid.RETRY' }] } });
    const retry = await app.inject({ method: 'POST', url: `/api/messages/${res.json().message.id}/retry`, headers: { cookie, origin: ORIGIN } });
    expect(retry.json().message).toMatchObject({ status: 'accepted', wamid: 'wamid.RETRY', error: null });
  });

  it('flags the account when Meta rejects the token', async () => {
    const { convId } = await setup();
    sendReply = () => metaError(190, 'Error validating access token');
    await send(convId, { type: 'text', text: 'halo', clientRef: 'ref-token-001' });
    const [account] = await t.get().db.select().from(waAccounts);
    expect(account!.status).toBe('error');
  });
});

describe('attachments', () => {
  async function upload(name: string, mime: string, bytes: Buffer) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), name);
    const encoded = new Response(form);
    return app.inject({
      method: 'POST',
      url: '/api/media',
      headers: { cookie, origin: ORIGIN, 'content-type': encoded.headers.get('content-type')! },
      payload: Buffer.from(await encoded.arrayBuffer()),
    });
  }

  it('uploads a PDF to Meta and sends it as a document with caption', async () => {
    const { convId } = await setup();
    const up = await upload('Formulir-NPWP.pdf', 'application/pdf', Buffer.from('%PDF-1.4 test'));
    expect(up.statusCode).toBe(201);
    const mediaId = up.json().media.id as string;
    const [row] = await t.get().db.select().from(media).where(eq(media.id, Number(mediaId)));
    expect(row).toMatchObject({ direction: 'out', status: 'ready', waMediaId: 'meta-media-777', mimeType: 'application/pdf' });

    const res = await send(convId, { type: 'media', mediaId, caption: 'Silakan diisi', clientRef: 'ref-media-001' });
    expect(res.json().message).toMatchObject({ type: 'document', status: 'accepted', text: 'Silakan diisi' });
    const call = graph.calls.find((c) => c.path === `${PHONE_ID}/messages`)!;
    expect(call.body).toMatchObject({ type: 'document', document: { id: 'meta-media-777', caption: 'Silakan diisi', filename: 'Formulir-NPWP.pdf' } });
  });

  it('rejects unsupported or oversized files before contacting Meta', async () => {
    await setup();
    const exe = await upload('setup.exe', 'application/x-msdownload', Buffer.from('MZ'));
    expect(exe.statusCode).toBe(400);
    expect(exe.json().error.code).toBe('unsupported_media');
    const bigImage = await upload('foto.jpg', 'image/jpeg', Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(bigImage.statusCode).toBe(400);
    expect(bigImage.json().error.code).toBe('media_too_large');
    expect(graph.calls.filter((c) => c.path === `${PHONE_ID}/media`)).toHaveLength(0);
  });
});

describe('sensitive number warning', () => {
  it('flags NIK/NPWP-like numbers but not phone numbers', () => {
    expect(looksLikeSensitiveNumber('NIK saya 3510123456789012')).toBe(true);
    expect(looksLikeSensitiveNumber('NPWP 01.234.567.8-901.000')).toBe(true);
    expect(looksLikeSensitiveNumber('hubungi 081234567890')).toBe(false);
    expect(looksLikeSensitiveNumber('tahun 2025 bulan 10')).toBe(false);
  });
});
