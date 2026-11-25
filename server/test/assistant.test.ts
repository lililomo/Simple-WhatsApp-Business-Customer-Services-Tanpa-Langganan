import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  AosLoginStartDTO,
  AosMessageDTO,
  AosThreadDTO,
  AosUsageDTO,
  AssistantSettings,
  AssistantSettingsDTO,
  AssistantStatusDTO,
  ConversationDTO,
  RealtimeEvent,
} from '@wa/shared';
import { aiCalls, aiMessages, appSettings, auditLogs, labels, quickReplies } from '../src/db/schema';
import { EngineError, type Engine, type EngineCredential, type EngineRequest, type EngineResult } from '../src/modules/assistant/engine';
import { cancelSubscriptionLogin } from '../src/modules/assistant/login';
import { resolveSources, runtimeFor } from '../src/modules/assistant/service';
import { loadCredentials } from '../src/modules/assistant/settings';
import { AssistantWorker } from '../src/modules/assistant/worker';
import { createNote } from '../src/modules/knowledge/service';
import { WebhookWorker } from '../src/modules/processor/worker';
import type { AppInstance } from '../src/types';
import { APP_SECRET, seedAccount } from './helpers/account';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';
import { fakeGraph } from './helpers/graph';
import { inbound, PHONE_ID, sign } from './fixtures/meta';

const t = useTestDatabase();
let app: AppInstance;
let admin: string;
let agent: string;
let worker: AssistantWorker | undefined;
let events: RealtimeEvent[] = [];

const API_KEY = 'sk-ant-api03-kunci-uji-0123456789abcdefghij-WXYZ';
const SUB_TOKEN = 'sk-ant-oat01-token-uji-0123456789abcdefghij-QRST';

const graph = fakeGraph({ [`POST ${PHONE_ID}/messages`]: () => ({ json: { messages: [{ id: 'wamid.out' }] } }) });

/** Mesin tiruan: mencatat setiap panggilan dan menjawab lewat `respond`. */
const calls: { credential: EngineCredential; request: EngineRequest }[] = [];
let respond: (credential: EngineCredential, request: EngineRequest) => Promise<Partial<EngineResult>> | Partial<EngineResult>;
const fakeEngine: Engine = async (_deps, credential, request) => {
  calls.push({ credential, request });
  const result = await respond(credential, request);
  return { text: '', inputTokens: 1200, outputTokens: 300, costUsd: 0.02, libraryDocs: new Map(), webUrls: [], ...result };
};

/** Panggilan yang tidak pernah selesai sampai dibatalkan. */
const hang = (_credential: EngineCredential, request: EngineRequest) =>
  new Promise<Partial<EngineResult>>((_resolve, reject) => {
    request.signal?.addEventListener('abort', () => reject(new EngineError('cancelled', 'Dibatalkan.')));
  });

/**
 * CLI Claude tiruan. Meniru aslinya dalam tiga hal yang penting: menulis tautan login dengan kode kendali terminal;
 * menganggap potongan masukan yang panjang sebagai tempelan, sehingga Enter di dalamnya TIDAK dihitung sebagai
 * penekanan tombol (kode hanya mengisi kotak); dan baru memproses kode saat Enter datang sebagai masukan tersendiri.
 */
const FAKE_CLI = `
const out = (s) => process.stdout.write(s);
out('\x1b[2J\x1b[2GWelcome\x1b[10Gto\x1b[13GClaude\x1b[20GCode\\r\\n');
setTimeout(() => {
  const url = 'https://claude.ai/oauth/authorize?TiruanUntukTes_0123456789-AbCdEfGhIj';
  out('\x1b]8;id=1;' + url + '\x07\x1b[38;5;246m' + url + '\x1b[39m\x1b]8;;\x07\\r\\n\x1b[2GPaste\x1b[8Gcode\x1b[13Ghere\\r\\n');
}, 60);
let field = '';
const submit = () => {
  const code = field;
  field = '';
  if (!code) return;
  const [a, b] = code.split('#');
  if (!a || !b) return out("\\r\\n\x1b[2G\\u2718\x1b[4GThat doesn't look like the full code.\\r\\nCopy all of it, including the # in the middle.\\r\\n");
  out('\\r\\n\x1b[2G\\u273d\x1b[4GFinishing\x1b[14Gsign-i\x1b[22G\\u2026\\r\\n');
  setTimeout(() => {
    if (code === 'kode-benar-0123456789#state-tes') out('\\r\\nYour\x1b[6GOAuth\x1b[12Gtoken\\r\\n\\r\\n' + process.env.FAKE_TOKEN + '\\r\\n');
    else if (code.startsWith('akun-ditolak')) out("\\r\\n\x1b[2G\\u2718\x1b[4GThis account can't be used here.\\r\\n");
    else out("\\r\\n\x1b[2G\\u2718\x1b[4GOAuth\x1b[10Gerror:\x1b[17GThat code wasn't accepted. Sign in again to get a new code.\\r\\nPress Enter to retry\\r\\n");
  }, 80);
};
process.stdin.on('data', (chunk) => {
  const s = chunk.toString();
  if (s === '\\r' || s === '\\n') return submit();
  field += s.replace(/[\\r\\n]/g, '');
  out('\x1b[2G' + '*'.repeat(12) + field.slice(-6));
});
setInterval(() => {}, 1000);
`;

const isTriage = (request: EngineRequest) => request.system.includes('penyaring awal');

const ANSWER = `<draf>
Selamat siang, Bapak. Aktivasi EFIN bisa lewat *Coretax* atau datang ke KPP.
</draf>
<catatan>Cek dulu apakah NPWP sudah valid.</catatan>
<keyakinan>tinggi</keyakinan>
<sumber>
https://www.pajak.go.id/id/efin
https://situs-sembarang.example.com/efin
P999 hlm 2
</sumber>`;

afterEach(async () => {
  await worker?.stop();
  worker = undefined;
  await cancelSubscriptionLogin(app.deps);
  await runtimeFor(app.deps).idle();
  await app?.close();
});

async function setup() {
  app = await buildTestApp(t.get(), {}, graph.fetch);
  app.deps.aosEngine = fakeEngine;
  calls.length = 0;
  events = [];
  respond = () => ({ text: ANSWER });
  app.deps.bus.on((e) => {
    if (e.type.startsWith('assistant.') || e.type === 'conversation.updated') events.push(e as RealtimeEvent);
  });
  await seedAccount(t.get());
  await seedUser(t.get(), 'admin', 'admin@kpp.test');
  await seedUser(t.get(), 'agent', 'petugas@kpp.test');
  admin = await loginAs(app, 'admin@kpp.test');
  agent = await loginAs(app, 'petugas@kpp.test');
}

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
  app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload === undefined ? {} : { payload: payload as object }) });

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

async function conversation(): Promise<ConversationDTO> {
  const res = await call('GET', '/api/conversations', agent);
  return (res.json() as { conversations: ConversationDTO[] }).conversations[0]!;
}

/** Nyalakan AOS dengan jalur yang diminta. */
async function enable(patch: Partial<AssistantSettings> = {}, providers: ('api' | 'subscription')[] = ['api']) {
  for (const p of providers) {
    const res = await call('PUT', `/api/assistant/credentials/${p}`, admin, { secret: p === 'api' ? API_KEY : SUB_TOKEN });
    expect(res.statusCode).toBe(200);
  }
  const current = (await call('GET', '/api/assistant/settings', admin)).json() as AssistantSettingsDTO;
  const res = await call('PUT', '/api/assistant/settings', admin, { ...current.settings, enabled: true, ...patch });
  expect(res.statusCode).toBe(200);
  return res.json() as AssistantSettingsDTO;
}

const thread = async (id: string) => (await call('GET', `/api/conversations/${id}/assistant`, agent)).json() as AosThreadDTO;
const idle = () => runtimeFor(app.deps).idle();

async function askText(id: string, text = 'Buatkan jawaban soal EFIN') {
  const res = await call('POST', `/api/conversations/${id}/assistant/messages`, agent, { text });
  expect(res.statusCode).toBe(202);
  const created = (res.json() as { messages: AosMessageDTO[] }).messages;
  await idle();
  return created;
}

describe('settings and connection', () => {
  it('is off by default and only admins can configure it', async () => {
    await setup();
    expect((await call('GET', '/api/assistant/status', agent)).json()).toEqual({ ready: false, mode: 'offer' } satisfies AssistantStatusDTO);
    expect((await app.inject({ url: '/api/assistant/status' })).statusCode).toBe(401);
    expect((await call('GET', '/api/assistant/settings', agent)).statusCode).toBe(403);
    expect((await call('PUT', '/api/assistant/credentials/api', agent, { secret: API_KEY })).statusCode).toBe(403);

    const dto = (await call('GET', '/api/assistant/settings', admin)).json() as AssistantSettingsDTO;
    expect(dto.ready).toBe(false);
    expect(dto.settings.answer).toEqual({ model: 'claude-opus-5-5', effort: 'high' });
    expect(dto.providers.map((p) => [p.provider, p.connected])).toEqual([
      ['api', false],
      ['subscription', false],
    ]);
  });

  it('stores credentials encrypted and never returns them', async () => {
    await setup();
    const res = await call('PUT', '/api/assistant/credentials/api', admin, { secret: API_KEY });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(API_KEY);
    const api = (res.json() as AssistantSettingsDTO).providers.find((p) => p.provider === 'api')!;
    expect(api).toMatchObject({ connected: true, last4: 'WXYZ', state: 'unknown' });

    const [stored] = await t.get().db.select().from(appSettings).where(eq(appSettings.key, 'assistant_credentials'));
    expect(JSON.stringify(stored!.value)).not.toContain(API_KEY);

    // Token langganan ditempel di kartu API: ditolak dengan pesan yang jelas.
    const wrong = await call('PUT', '/api/assistant/credentials/api', admin, { secret: SUB_TOKEN });
    expect(wrong.statusCode).toBe(400);

    // Terhubung saja belum cukup: harus dinyalakan.
    expect(((await call('GET', '/api/assistant/status', agent)).json() as AssistantStatusDTO).ready).toBe(false);
    const enabled = await enable({}, []);
    expect(enabled.ready).toBe(true);

    const removed = (await call('DELETE', '/api/assistant/credentials/api', admin)).json() as AssistantSettingsDTO;
    expect(removed.ready).toBe(false);
  });

  it('tests one connection with the answer model', async () => {
    await setup();
    await enable({}, ['api', 'subscription']);
    respond = (credential) => {
      if (credential.provider === 'subscription') throw new EngineError('auth', 'Kredensial ditolak. Hubungkan ulang jalur ini.');
      return { text: 'siap' };
    };
    const ok = (await call('POST', '/api/assistant/credentials/api/test', admin)).json() as { ok: boolean; message: string };
    expect(ok.ok).toBe(true);
    expect(calls.at(-1)!.credential).toEqual({ provider: 'api', secret: API_KEY });
    expect(calls.at(-1)!.request.model).toBe('claude-opus-5-5');

    const bad = (await call('POST', '/api/assistant/credentials/subscription/test', admin)).json() as { ok: boolean; message: string };
    expect(bad).toMatchObject({ ok: false, message: 'Kredensial ditolak. Hubungkan ulang jalur ini.' });
    // Uji koneksi tidak pindah ke jalur lain.
    expect(calls).toHaveLength(2);
    const dto = (await call('GET', '/api/assistant/settings', admin)).json() as AssistantSettingsDTO;
    expect(dto.providers.find((p) => p.provider === 'subscription')!.state).toBe('rejected');
    expect(dto.providers.find((p) => p.provider === 'api')!.state).toBe('ok');
  });
});

describe('asking AOS', () => {
  it('refuses while AOS is off', async () => {
    await setup();
    await receive(inbound.text('Halo'));
    const conv = await conversation();
    const res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { text: 'Bantu jawab' });
    expect(res.statusCode).toBe(409);
    expect((await thread(conv.id)).messages).toEqual([]);
  });

  it('drafts an answer, masks personal data on the way out, and filters sources', async () => {
    await setup();
    await enable();
    await receive(inbound.text('Siang, NPWP saya 12.345.678.9-012.345, mau tanya cara aktivasi EFIN'));
    const conv = await conversation();
    respond = () => ({ text: ANSWER.replace('Bapak.', 'Bapak, NPWP [ID-1] sudah kami catat.'), libraryDocs: new Map() });

    const created = await askText(conv.id);
    expect(created.map((m) => [m.kind, m.status])).toEqual([
      ['user', 'done'],
      ['answer', 'pending'],
    ]);
    expect(created[0]!.author?.name).toBe('Petugas');

    const { request, credential } = calls[0]!;
    expect(credential.provider).toBe('api');
    expect(request).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', library: true });
    expect(request.web?.domains).toContain('pajak.go.id');
    // Yang dikirim ke Claude: penanda, bukan nomor aslinya.
    expect(request.prompt).toContain('[ID-1]');
    expect(request.prompt).not.toContain('12.345.678.9-012.345');
    expect(request.prompt).toContain('Buatkan jawaban soal EFIN');

    const th = await thread(conv.id);
    const answer = th.messages.at(-1)!;
    expect(answer).toMatchObject({ kind: 'answer', status: 'done', provider: 'api', model: 'claude-opus-5-5' });
    // Di layar petugas nomornya kembali.
    expect(answer.answer!.draft).toContain('NPWP 12.345.678.9-012.345 sudah kami catat');
    expect(answer.answer!.notes).toBe('Cek dulu apakah NPWP sudah valid.');
    expect(answer.answer!.confidence).toBe('tinggi');
    // Situs di luar daftar dan dokumen Pustaka yang tidak dibaca dibuang.
    expect(answer.answer!.sources).toEqual([{ type: 'web', title: 'pajak.go.id', url: 'https://www.pajak.go.id/id/efin' }]);

    const logged = await t.get().db.select().from(aiCalls);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ purpose: 'answer', provider: 'api', ok: true, inputTokens: 1200, outputTokens: 300, costMicroUsd: 20_000 });

    const types = events.map((e) => e.type);
    expect(types.filter((x) => x === 'assistant.updated').length).toBeGreaterThanOrEqual(4);
  });

  it('streams text and steps while the answer is being written', async () => {
    await setup();
    await enable();
    await receive(inbound.text('Email saya budi@contoh.id, tolong info EFIN'));
    const conv = await conversation();
    respond = async (_c, request) => {
      request.onStep?.('Mencari di Pustaka…');
      request.onText?.('<draf>Halo [EMAIL-1]');
      await new Promise((r) => setTimeout(r, 200));
      return { text: '<draf>Halo [EMAIL-1], berikut caranya.</draf><keyakinan>sedang</keyakinan>' };
    };
    await askText(conv.id);
    const delta = events.find((e) => e.type === 'assistant.delta');
    expect(delta).toMatchObject({ conversationId: conv.id, text: '<draf>Halo budi@contoh.id', steps: ['Mencari di Pustaka…'] });
    const answer = (await thread(conv.id)).messages.at(-1)!;
    expect(answer.steps).toEqual(['Mencari di Pustaka…']);
    expect(answer.answer).toMatchObject({ draft: 'Halo budi@contoh.id, berikut caranya.', confidence: 'sedang' });
  });

  it('keeps library sources only when the document was really read', async () => {
    await setup();
    const doc = await createNote(app.deps, { title: 'Panduan EFIN', text: 'EFIN diaktivasi lewat Coretax.', tags: [] }, null);
    const settings = (await enable()).settings;
    const sources = resolveSources(
      [`P${doc.id} hlm 3`, `- P${doc.id}`, 'P424242', 'https://ortax.org/aturan/1.', 'http://evil.example.org/x'],
      { libraryDocs: new Map([[Number(doc.id), 'Panduan EFIN']]) },
      settings,
    );
    expect(sources).toEqual([
      { type: 'library', title: 'Panduan EFIN', documentId: doc.id, page: 3 },
      { type: 'library', title: 'Panduan EFIN', documentId: doc.id, page: null },
      { type: 'web', title: 'ortax.org', url: 'https://ortax.org/aturan/1' },
    ]);
  });

  it('answers free-form requests without a draft section', async () => {
    await setup();
    await enable();
    await receive(inbound.text('Mau tanya soal SPT'));
    const conv = await conversation();
    respond = () => ({ text: '- WP menanyakan SPT.\n- Belum dijawab.' });
    const res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { action: 'summarize' });
    expect(res.statusCode).toBe(202);
    await idle();
    const th = await thread(conv.id);
    expect(th.messages[0]).toMatchObject({ kind: 'user', text: 'Ringkas chat ini' });
    expect(th.messages[1]).toMatchObject({ kind: 'answer', status: 'done', text: '- WP menanyakan SPT.\n- Belum dijawab.' });
    expect(th.messages[1]!.answer).toMatchObject({ draft: null, confidence: null });
    expect(calls[0]!.request.prompt).toContain('Ringkas percakapan WhatsApp ini');
  });

  it('rewrites an earlier draft and regenerates from the original request', async () => {
    await setup();
    await enable();
    await receive(inbound.text('Cara lapor SPT bagaimana?'));
    const conv = await conversation();
    const first = (await askText(conv.id, 'Jelaskan cara lapor SPT'))[1]!;

    let res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { action: 'shorten', targetId: first.id });
    expect(res.statusCode).toBe(202);
    await idle();
    expect(calls[1]!.request.prompt).toContain('Perpendek draf balasan berikut');
    expect(calls[1]!.request.prompt).toContain('Aktivasi EFIN bisa lewat');
    // Sesi sebelumnya ikut dikirim agar permintaan lanjutan nyambung.
    expect(calls[1]!.request.prompt).toContain('Petugas: Jelaskan cara lapor SPT');

    res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { action: 'regenerate', targetId: first.id });
    expect(res.statusCode).toBe(202);
    await idle();
    expect(calls[2]!.request.prompt).toContain('Jelaskan cara lapor SPT');
    expect(calls[2]!.request.prompt).toContain('Petugas meminta versi lain');

    res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { action: 'shorten' });
    expect(res.statusCode).toBe(400);
  });

  it('allows one answer at a time per conversation and supports cancelling', async () => {
    await setup();
    await enable();
    await receive(inbound.text('Tanya PPh final UMKM'));
    const conv = await conversation();
    respond = hang;
    const res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { text: 'Tolong jawab' });
    const answer = (res.json() as { messages: AosMessageDTO[] }).messages[1]!;
    await expect.poll(() => runtimeFor(app.deps).jobs.size).toBe(1);

    const second = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { text: 'Satu lagi' });
    expect(second.statusCode).toBe(409);

    const cancelled = await call('POST', `/api/assistant/messages/${answer.id}/cancel`, agent);
    expect(cancelled.statusCode).toBe(200);
    await idle();
    expect((await thread(conv.id)).messages.at(-1)).toMatchObject({ id: answer.id, status: 'cancelled', error: null });
    // Panggilan yang dibatalkan tidak dicatat sebagai kegagalan jalur.
    expect(await t.get().db.select().from(aiCalls)).toHaveLength(0);
  });
});

describe('two connections with priority order', () => {
  it('falls back to the backup when the main one hits its limit, then rests the main one', async () => {
    await setup();
    await enable({ order: ['subscription', 'api'] }, ['api', 'subscription']);
    await receive(inbound.text('Tanya tarif PPh 21'));
    const conv = await conversation();
    const resetsAt = new Date(Date.now() + 2 * 3600_000);
    respond = (credential) => {
      if (credential.provider === 'subscription') throw new EngineError('limit', 'Batas pemakaian jalur ini tercapai.', resetsAt);
      return { text: ANSWER };
    };

    await askText(conv.id);
    expect(calls.map((c) => c.credential.provider)).toEqual(['subscription', 'api']);
    expect(calls[0]!.credential.secret).toBe(SUB_TOKEN);
    expect((await thread(conv.id)).messages.at(-1)).toMatchObject({ status: 'done', provider: 'api' });

    const dto = (await call('GET', '/api/assistant/settings', admin)).json() as AssistantSettingsDTO;
    expect(dto.providers.map((p) => p.provider)).toEqual(['subscription', 'api']);
    expect(dto.providers[0]).toMatchObject({ state: 'cooldown', cooldownUntil: resetsAt.toISOString(), lastError: 'Batas pemakaian jalur ini tercapai.' });
    expect(dto.providers[1]).toMatchObject({ state: 'ok' });

    // Selama diistirahatkan, jalur utama dilewati.
    calls.length = 0;
    await askText(conv.id, 'Sekali lagi');
    expect(calls.map((c) => c.credential.provider)).toEqual(['api']);

    const logged = await t.get().db.select().from(aiCalls);
    expect(logged.map((l) => [l.provider, l.ok])).toEqual([
      ['subscription', false],
      ['api', true],
      ['api', true],
    ]);
  });

  it('works the other way round and reports when every connection fails', async () => {
    await setup();
    await enable({ order: ['api', 'subscription'] }, ['api', 'subscription']);
    await receive(inbound.text('Tanya e-Billing'));
    const conv = await conversation();
    respond = (credential) => {
      if (credential.provider === 'api') throw new EngineError('billing', 'Saldo atau tagihan jalur ini bermasalah.');
      return { text: ANSWER };
    };
    await askText(conv.id);
    expect(calls.map((c) => c.credential.provider)).toEqual(['api', 'subscription']);
    expect((await thread(conv.id)).messages.at(-1)).toMatchObject({ status: 'done', provider: 'subscription' });

    respond = () => {
      throw new EngineError('overloaded', 'Layanan Claude sedang penuh.');
    };
    await askText(conv.id, 'Coba lagi');
    expect((await thread(conv.id)).messages.at(-1)).toMatchObject({ status: 'error', error: 'Layanan Claude sedang penuh.' });
  });

  it('does not switch for errors that are not about the connection', async () => {
    await setup();
    await enable({ order: ['subscription', 'api'] }, ['api', 'subscription']);
    await receive(inbound.text('Tanya PBB'));
    const conv = await conversation();
    respond = () => {
      throw new EngineError('other', 'Model yang dipilih tidak tersedia di jalur ini.');
    };
    await askText(conv.id);
    expect(calls).toHaveLength(1);
    expect((await thread(conv.id)).messages.at(-1)).toMatchObject({ status: 'error', error: 'Model yang dipilih tidak tersedia di jalur ini.' });
  });
});

describe('first-pass detection', () => {
  const triage = (over: Record<string, unknown> = {}) => ({
    kategori: 'pertanyaan_prosedur',
    tindakan: 'tawarkan',
    ringkasan: 'WP menanyakan cara aktivasi EFIN.',
    opsi: [
      { label: 'Buatkan draf jawaban', instruksi: 'Siapkan draf balasan tentang cara aktivasi EFIN.' },
      { label: 'Tanyakan data yang kurang', instruksi: 'Siapkan pertanyaan klarifikasi untuk WP.' },
    ],
    topik: 'Aktivasi EFIN',
    label: 'Pelayanan',
    sensitif: false,
    butuh_data_internal: false,
    ...over,
  });

  async function start(patch: Partial<AssistantSettings> = {}) {
    await setup();
    await enable(patch);
    worker = new AssistantWorker(app.deps, { debounceMs: 0 });
    worker.start();
  }

  it('stays silent for greetings', async () => {
    await start();
    respond = () => ({ text: JSON.stringify(triage({ tindakan: 'diam', kategori: 'sapaan', ringkasan: '', opsi: [], topik: 'sapaan', label: null })) });
    await receive(inbound.text('Selamat pagi'));
    await worker!.drain();
    const conv = await conversation();
    expect(calls).toHaveLength(1);
    // Deteksi awal: model ringan, tanpa internet dan tanpa Pustaka.
    expect(calls[0]!.request.model).toBe('claude-haiku-5-5');
    expect(calls[0]!.request.web).toBeUndefined();
    expect(calls[0]!.request.library).toBeUndefined();
    expect(calls[0]!.request.prompt).toContain('WP [BARU]: Selamat pagi');
    expect((await thread(conv.id)).messages).toEqual([]);
    expect(conv.aosOffer).toBe(false);
  });

  it('offers help first, then drafts after the officer picks an option', async () => {
    await start();
    await t.get().db.insert(labels).values({ name: 'Pelayanan', color: '#2563eb' });
    respond = (_c, request) => (isTriage(request) ? { text: JSON.stringify(triage()) } : { text: ANSWER });
    await receive(inbound.text('Pak, cara aktivasi EFIN bagaimana ya?'));
    await worker!.drain();

    let conv = await conversation();
    expect(conv.aosOffer).toBe(true);
    let th = await thread(conv.id);
    expect(th.openOfferId).toBe(th.messages[0]!.id);
    const offer = th.messages[0]!;
    expect(offer).toMatchObject({ kind: 'offer', offerState: 'open', text: 'WP menanyakan cara aktivasi EFIN. Mau saya bantu?' });
    expect(offer.options!.map((o) => o.label)).toEqual(['Buatkan draf jawaban', 'Tanyakan data yang kurang', 'Pasang label Pelayanan']);
    expect(offer.options![0]!.primary).toBe(true);
    // Belum ada rekomendasi sebelum petugas memilih.
    expect(calls).toHaveLength(1);

    // Pilihan label: label terpasang, pilihannya hilang, tawaran tetap terbuka.
    let res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { offerId: offer.id, optionIndex: 2 });
    expect(res.statusCode).toBe(202);
    conv = await conversation();
    expect(conv.labels.map((l) => l.name)).toEqual(['Pelayanan']);
    expect(conv.aosOffer).toBe(true);
    expect((await thread(conv.id)).messages[0]!.options).toHaveLength(2);

    res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { offerId: offer.id, optionIndex: 0 });
    expect(res.statusCode).toBe(202);
    await idle();
    th = await thread(conv.id);
    expect(th.openOfferId).toBeNull();
    expect(th.messages.map((m) => [m.kind, m.status, m.offerState])).toEqual([
      ['offer', 'done', 'answered'],
      ['user', 'done', null],
      ['answer', 'done', null],
    ]);
    expect(th.messages[1]!.text).toBe('Buatkan draf jawaban');
    expect(calls[1]!.request.prompt).toContain('Siapkan draf balasan tentang cara aktivasi EFIN.');
    expect((await conversation()).aosOffer).toBe(false);

    // Tawaran yang sudah dijawab tidak bisa dipakai lagi.
    res = await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { offerId: offer.id, optionIndex: 1 });
    expect(res.statusCode).toBe(409);
  });

  it('replaces an unanswered offer with a newer one and lets the officer dismiss it', async () => {
    await start();
    respond = () => ({ text: JSON.stringify(triage({ label: null })) });
    await receive(inbound.text('Cara aktivasi EFIN bagaimana?'));
    await worker!.drain();
    await receive(inbound.text('Kalau lupa EFIN bagaimana?'));
    await worker!.drain();
    const conv = await conversation();
    let th = await thread(conv.id);
    expect(th.messages.map((m) => m.offerState)).toEqual(['dismissed', 'open']);

    const res = await call('POST', `/api/assistant/messages/${th.openOfferId}/dismiss`, agent);
    expect(res.statusCode).toBe(200);
    th = await thread(conv.id);
    expect(th.openOfferId).toBeNull();
    expect((await conversation()).aosOffer).toBe(false);
  });

  it('drafts right away in automatic mode when the question is clear', async () => {
    await start({ triage: { enabled: true, model: 'claude-haiku-5-5', mode: 'auto', debounceSec: 8 } });
    respond = (_c, request) => (isTriage(request) ? { text: JSON.stringify(triage({ tindakan: 'jawab', label: null })) } : { text: ANSWER });
    await receive(inbound.text('Syarat aktivasi EFIN apa saja?'));
    await worker!.drain();
    const conv = await conversation();
    const th = await thread(conv.id);
    expect(th.messages.map((m) => [m.kind, m.status])).toEqual([
      ['offer', 'done'],
      ['answer', 'done'],
    ]);
    expect(th.messages[0]!.text).toBe('WP menanyakan cara aktivasi EFIN. Saya siapkan rekomendasinya di bawah.');
    expect(th.messages[0]!.options!.map((o) => o.label)).toEqual(['Tanyakan data yang kurang']);
    expect(th.openOfferId).toBe(th.messages[0]!.id);

    // "Pakai" menutup tawaran dan tercatat.
    const used = await call('POST', `/api/assistant/messages/${th.messages[1]!.id}/used`, agent);
    expect((used.json() as { message: AosMessageDTO }).message.usedAt).not.toBeNull();
    expect((await thread(conv.id)).openOfferId).toBeNull();
  });

  it('does nothing in manual mode, for stickers, or when the officer already replied', async () => {
    await start({ triage: { enabled: true, model: 'claude-haiku-5-5', mode: 'manual', debounceSec: 8 } });
    await receive(inbound.text('Cara lapor SPT?'));
    await worker!.drain();
    expect(calls).toHaveLength(0);

    const current = (await call('GET', '/api/assistant/settings', admin)).json() as AssistantSettingsDTO;
    await call('PUT', '/api/assistant/settings', admin, { ...current.settings, triage: { ...current.settings.triage, mode: 'offer' } });
    await receive(inbound.sticker());
    await worker!.drain();
    expect(calls).toHaveLength(0);
  });

  it('tolerates extra text around the JSON and ignores unreadable results', async () => {
    await start();
    respond = () => ({ text: 'Maaf, saya tidak yakin.' });
    await receive(inbound.text('Halo'));
    await worker!.drain();
    expect((await thread((await conversation()).id)).messages).toHaveLength(0);
    respond = () => ({ text: `Berikut hasilnya: ${JSON.stringify(triage({ label: null }))} Semoga membantu.` });
    await receive(inbound.text('Cara aktivasi EFIN bagaimana?'));
    await worker!.drain();
    expect((await thread((await conversation()).id)).messages).toHaveLength(1);
  });

  it('closes offers nobody touched for half a day', async () => {
    await start();
    respond = () => ({ text: JSON.stringify(triage({ label: null })) });
    await receive(inbound.text('Cara aktivasi EFIN bagaimana?'));
    await worker!.drain();
    expect(await worker!.sweep()).toBe(0);
    expect(await worker!.sweep(new Date(Date.now() + 13 * 3600_000))).toBe(1);
    expect((await conversation()).aosOffer).toBe(false);
  });
});

describe('feedback, answer bank, new topic, usage', () => {
  it('records feedback and saves a good draft as a quick reply or a library note', async () => {
    await setup();
    await enable();
    await receive(inbound.text('NPWP saya 12.345.678.9-012.345, cara aktivasi EFIN?'));
    const conv = await conversation();
    respond = () => ({ text: '<draf>NPWP [ID-1]: aktivasi EFIN lewat Coretax.</draf><keyakinan>tinggi</keyakinan>' });
    const answer = (await askText(conv.id))[1]!;

    let res = await call('POST', `/api/assistant/messages/${answer.id}/feedback`, agent, { value: 1 });
    expect((res.json() as { message: AosMessageDTO }).message.feedback).toBe(1);
    res = await call('POST', `/api/assistant/messages/${answer.id}/feedback`, agent, { value: null });
    expect((res.json() as { message: AosMessageDTO }).message.feedback).toBeNull();

    res = await call('POST', `/api/assistant/messages/${answer.id}/save`, agent, { target: 'quick-reply', title: 'Aktivasi EFIN' });
    expect(res.statusCode).toBe(200);
    const [qr] = await t.get().db.select().from(quickReplies);
    // Data pribadi WP tidak ikut tersimpan.
    expect(qr).toMatchObject({ title: 'Aktivasi EFIN', body: 'NPWP [ID-1]: aktivasi EFIN lewat Coretax.' });

    res = await call('POST', `/api/assistant/messages/${answer.id}/save`, agent, { target: 'library', title: 'Aktivasi EFIN' });
    expect(res.statusCode).toBe(200);
    const saved = (res.json() as { message: AosMessageDTO }).message.savedDocumentId;
    expect(saved).not.toBeNull();
    const list = (await call('GET', '/api/knowledge', agent)).json() as { documents: { id: string; kind: string; tags: string[] }[] };
    expect(list.documents.find((d) => d.id === saved)).toMatchObject({ kind: 'note', tags: ['bank jawaban'] });
    res = await call('POST', `/api/assistant/messages/${answer.id}/save`, agent, { target: 'library', title: 'Aktivasi EFIN' });
    expect(res.statusCode).toBe(409);
  });

  it('starts a new topic: earlier chat and session are no longer sent', async () => {
    await setup();
    await enable();
    await receive(inbound.text('Pertanyaan lama soal PBB'));
    const conv = await conversation();
    await askText(conv.id, 'Jawab yang lama');

    const res = await call('POST', `/api/conversations/${conv.id}/assistant/reset`, agent);
    expect(res.statusCode).toBe(200);
    const th = res.json() as AosThreadDTO;
    expect(th.topicStartedAt).not.toBeNull();
    expect(th.messages).toHaveLength(2);
    expect(events.some((e) => e.type === 'assistant.thread')).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    await receive(inbound.text('Pertanyaan baru soal meterai'));
    calls.length = 0;
    await askText(conv.id, 'Jawab yang baru');
    expect(calls[0]!.request.prompt).toContain('Pertanyaan baru soal meterai');
    expect(calls[0]!.request.prompt).not.toContain('Pertanyaan lama soal PBB');
    expect(calls[0]!.request.prompt).not.toContain('Jawab yang lama');
  });

  it('reports usage, topics, and how often answers were used', async () => {
    await setup();
    await enable();
    worker = new AssistantWorker(app.deps, { debounceMs: 0 });
    worker.start();
    respond = (_c, request) =>
      isTriage(request)
        ? {
            text: JSON.stringify({ kategori: 'pertanyaan_prosedur', tindakan: 'tawarkan', ringkasan: 'WP tanya EFIN.', opsi: [], topik: 'Aktivasi EFIN', label: null, sensitif: false, butuh_data_internal: false }),
            costUsd: 0.001,
          }
        : { text: ANSWER };
    await receive(inbound.text('Cara aktivasi EFIN?'));
    await worker.drain();
    const conv = await conversation();
    const th = await thread(conv.id);
    await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { offerId: th.messages[0]!.id, optionIndex: 0 });
    await idle();
    const answer = (await thread(conv.id)).messages.at(-1)!;
    await call('POST', `/api/assistant/messages/${answer.id}/used`, agent);
    await call('POST', `/api/assistant/messages/${answer.id}/feedback`, agent, { value: 1 });

    expect((await call('GET', '/api/assistant/usage', agent)).statusCode).toBe(403);
    const usage = (await call('GET', '/api/assistant/usage', admin)).json() as AosUsageDTO;
    expect(usage.totals).toMatchObject({ calls: 2, inputTokens: 2400, outputTokens: 600 });
    expect(usage.totals.costUsd).toBeCloseTo(0.021);
    expect(usage.byProvider).toEqual([{ provider: 'api', calls: 2, costUsd: expect.closeTo(0.021), failed: 0 }]);
    expect(usage.byPurpose.map((p) => p.purpose).sort()).toEqual(['answer', 'triage']);
    expect(usage.byDay).toHaveLength(1);
    expect(usage.answers).toEqual({ made: 1, used: 1, up: 1, down: 0 });
    expect(usage.offers).toEqual({ made: 1, answered: 1, dismissed: 0 });
    expect(usage.topics).toEqual([{ topic: 'aktivasi efin', count: 1 }]);
    expect(usage.categories).toEqual([{ category: 'pertanyaan_prosedur', count: 1 }]);

    const other = (await call('GET', '/api/assistant/usage?month=2020-01', admin)).json() as AosUsageDTO;
    expect(other.totals.calls).toBe(0);
  });

  it('lets an admin try a question in the playground', async () => {
    await setup();
    await enable();
    const res = await call('POST', '/api/assistant/playground', admin, { text: 'Cara aktivasi EFIN?' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: 'api', model: 'claude-opus-5-5', answer: { confidence: 'tinggi' } });
    expect(calls[0]!.request.prompt).toContain('WP: Cara aktivasi EFIN?');
    expect((await call('POST', '/api/assistant/playground', agent, { text: 'x' })).statusCode).toBe(403);
  });

  it('marks answers left unfinished by a restart as failed', async () => {
    await setup();
    await enable();
    await receive(inbound.text('Tanya'));
    const conv = await conversation();
    respond = hang;
    await call('POST', `/api/conversations/${conv.id}/assistant/messages`, agent, { text: 'Jawab' });
    // Aplikasi "mati" di tengah jalan: pekerjaannya hilang, barisnya tertinggal berstatus sedang disusun.
    await expect
      .poll(async () => (await t.get().db.select().from(aiMessages).where(eq(aiMessages.kind, 'answer')))[0]?.status)
      .toBe('running');
    worker = new AssistantWorker(app.deps, { debounceMs: 0 });
    worker.start();
    await expect.poll(async () => (await thread(conv.id)).messages.at(-1)!.status).toBe('error');
    respond = () => ({ text: ANSWER });
    runtimeFor(app.deps).abortAll();
  });
});

describe('connecting the subscription by link', () => {
  const TOKEN = `sk-ant-oat01-${'t'.repeat(48)}-QwEr`;
  let cliPath: string;

  async function start() {
    await setup();
    cliPath = path.join(tmpdir(), `wa-inbox-fake-claude-${process.pid}.mjs`);
    writeFileSync(cliPath, FAKE_CLI);
    process.env.FAKE_TOKEN = TOKEN;
    app.deps.aosLoginCommand = () => ({ command: process.execPath, args: [cliPath] });
  }
  const begin = () => call('POST', '/api/assistant/credentials/subscription/login', admin);
  const sendCode = (code: string) => call('POST', '/api/assistant/credentials/subscription/login/code', admin, { code });

  it('hands out the Claude sign-in link and stores the token once the code is pasted', async () => {
    await start();
    expect((await call('POST', '/api/assistant/credentials/subscription/login', agent)).statusCode).toBe(403);

    const started = await begin();
    expect(started.statusCode).toBe(200);
    const { url, expiresAt } = started.json() as AosLoginStartDTO;
    expect(url).toBe('https://claude.ai/oauth/authorize?TiruanUntukTes_0123456789-AbCdEfGhIj');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);

    // Kode ditempel dengan spasi/baris baru yang ikut tersalin.
    const done = await sendCode('  kode-benar-0123456789#state-tes\n');
    expect(done.statusCode).toBe(200);
    // Tokennya tidak pernah dikirim ke browser; hanya empat karakter terakhir.
    expect(done.body).not.toContain(TOKEN);
    const subscription = (done.json() as AssistantSettingsDTO).providers.find((p) => p.provider === 'subscription')!;
    expect(subscription).toMatchObject({ connected: true, last4: 'QwEr', state: 'unknown' });
    expect((await loadCredentials(app.deps)).subscription).toBe(TOKEN);

    const audits = await t.get().db.select().from(auditLogs).where(eq(auditLogs.action, 'assistant.credential.set'));
    expect(audits.map((a) => a.meta)).toEqual([{ via: 'login' }]);
    expect(JSON.stringify(audits)).not.toContain(TOKEN);

    // Sesi login sekali pakai.
    expect((await sendCode('kode-benar-0123456789#state-tes')).statusCode).toBe(409);
  });

  it('explains a rejected code and asks for a fresh link', async () => {
    await start();
    await begin();
    const rejected = await sendCode('kode-salah-0123456789#state-tes');
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toMatchObject({ code: 'aos_login_code' });
    expect(rejected.json().error.message).toContain('Kode tidak diterima Claude');
    expect((await loadCredentials(app.deps)).subscription).toBeUndefined();
    // Kode yang ditolak Claude menghabiskan sesinya.
    expect((await sendCode('kode-benar-0123456789#state-tes')).statusCode).toBe(409);

    // Tautan baru bisa dibuat lagi dan berhasil.
    await begin();
    expect((await sendCode('kode-benar-0123456789#state-tes')).statusCode).toBe(200);
  });

  it('passes on what Claude says when it refuses the sign-in for another reason', async () => {
    await start();
    await begin();
    const refused = await sendCode('akun-ditolak-0123456789#state-tes');
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toContain(`Claude menolak login ini: "This account can't be used here."`);
    // Kode yang diketik tidak ikut tercetak di pesan galat.
    expect(refused.json().error.message).not.toContain('akun-ditolak-0123456789');
  });

  it('catches a miscopied code before it reaches Claude, so the same link can still be used', async () => {
    await start();
    expect((await sendCode('kode-benar-0123456789#state-tes')).statusCode).toBe(409);
    await begin();

    const incomplete = await sendCode('kode-benar-0123456789');
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().error).toMatchObject({ code: 'aos_login_code_format' });
    expect(incomplete.json().error.message).toContain('termasuk tanda # di tengahnya');

    const address = await sendCode('https://claude.ai/oauth/authorize?abc');
    expect(address.json().error.message).toContain('Itu alamat web, bukan kodenya');

    const odd = await sendCode('kode\u001b[2Jjahat#0123456789');
    expect(odd.statusCode).toBe(400);
    expect(odd.json().error.message).toContain('Kode tidak dikenali');

    // Sesi masih hidup: kode yang benar langsung diterima tanpa tautan baru.
    expect((await sendCode('kode-benar-0123456789#state-tes')).statusCode).toBe(200);
  });

  it('can be cancelled', async () => {
    await start();
    await begin();
    const cancelled = await call('DELETE', '/api/assistant/credentials/subscription/login', admin);
    expect(cancelled.statusCode).toBe(200);
    expect((await sendCode('kode-benar-0123456789#state-tes')).statusCode).toBe(409);
  });

  it('reports when the server cannot prepare a link', async () => {
    await start();
    app.deps.aosLoginCommand = () => ({ command: process.execPath, args: ['-e', 'process.exit(3)'] });
    const failed = await begin();
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.message).toContain('Tidak bisa menyiapkan tautan login Claude');
  });
});
