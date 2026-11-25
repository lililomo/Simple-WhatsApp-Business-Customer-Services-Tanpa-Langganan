import { access, mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import { KB_MAX_FILE_MB, KB_QUOTA_MB, type KbDocumentDTO, type KbListDTO } from '@wa/shared';
import { auditLogs, kbChunks, kbDocuments } from '../src/db/schema';
import type { BusEvent } from '../src/lib/bus';
import { sha256Hex } from '../src/lib/crypto';
import { runHousekeeping } from '../src/modules/housekeeping/service';
import { CHUNK_SIZE, chunkSegments, joinChunks, normalizeText } from '../src/modules/knowledge/chunk';
import {
  knowledgeCatalog,
  readKnowledge,
  searchKnowledge,
  setKnowledgeAi,
} from '../src/modules/knowledge/service';
import { KnowledgeWorker } from '../src/modules/knowledge/worker';
import type { AppInstance } from '../src/types';
import { buildTestApp, loginAs, ORIGIN, seedUser } from './helpers/app';
import { useTestDatabase } from './helpers/db';

const t = useTestDatabase();
let app: AppInstance;
let cookie: string;
let storage: string;

beforeAll(async () => {
  storage = await mkdtemp(path.join(tmpdir(), 'wa-inbox-kb-'));
});
afterAll(async () => {
  await rm(storage, { recursive: true, force: true });
});
afterEach(async () => {
  setKnowledgeAi(null);
  await app?.close();
});

async function setup() {
  app = await buildTestApp(t.get(), { STORAGE_DIR: storage });
  await seedUser(t.get(), 'agent', 'petugas@kpp.test');
  cookie = await loginAs(app, 'petugas@kpp.test');
}

const quiet = { error: () => {}, warn: () => {} };
/** Jalankan worker sampai tidak ada lagi dokumen berstatus processing. */
const drain = () => new KnowledgeWorker(app.deps, quiet).drain();

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload ? { payload } : {}) });

function upload(name: string, data: Buffer | string) {
  const boundary = '----uji-pustaka';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  return app.inject({
    method: 'POST',
    url: '/api/knowledge',
    headers: { cookie, origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([Buffer.from(head), Buffer.from(data), Buffer.from(`\r\n--${boundary}--\r\n`)]),
  });
}

async function uploaded(name: string, data: Buffer | string): Promise<KbDocumentDTO> {
  const res = await upload(name, data);
  expect(res.statusCode).toBe(201);
  return res.json().document;
}

async function note(title: string, text: string, tags: string[] = []): Promise<KbDocumentDTO> {
  const res = await call('POST', '/api/knowledge/notes', { title, text, tags });
  expect(res.statusCode).toBe(201);
  return res.json().document;
}

const list = async (query = '') => (await call('GET', `/api/knowledge${query}`)).json() as KbListDTO;
const titles = async (query = '') => (await list(query)).documents.map((d) => d.title);
const found = async (q: string) => (await searchKnowledge(app.deps, q)).map((h) => h.title);
const document = async (id: string) => (await list()).documents.find((d) => d.id === id)!;
const row = async (id: string) =>
  (
    await t
      .get()
      .db.select()
      .from(kbDocuments)
      .where(eq(kbDocuments.id, Number(id)))
  )[0];
const chunksOf = (id: string) =>
  t
    .get()
    .db.select()
    .from(kbChunks)
    .where(eq(kbChunks.documentId, Number(id)))
    .orderBy(kbChunks.seq);
// Hanya catatan audit Pustaka; login di awal test juga tercatat tetapi bukan yang diperiksa di sini.
const auditActions = async () =>
  (await t.get().db.select().from(auditLogs)).map((a) => a.action).filter((action) => action.startsWith('knowledge.'));
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Tanggal hari ini (atau digeser sekian hari) di Asia/Jakarta, "YYYY-MM-DD". */
const jakartaDay = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PKG = 'http://schemas.openxmlformats.org/package/2006';
const DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** DOCX sekecil mungkin: satu paragraf per teks. */
function docx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        `${XML}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      '_rels/.rels': strToU8(
        `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${DOC}/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      'word/document.xml': strToU8(
        `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      ),
    }),
  );
}

/**
 * PPTX sekecil mungkin. `order` = urutan tampil (indeks ke `slides`); berkas slideN.xml sengaja dinomori
 * menurut urutan `slides`, supaya urutan tampil yang berbeda dari nomor berkas ikut teruji.
 */
function pptx(slides: { title: string; body: string[] }[], order = slides.map((_, i) => i)): Buffer {
  const ns =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const files: Record<string, Uint8Array> = {};
  slides.forEach((slide, i) => {
    const body = slide.body.map((line) => `<a:p><a:r><a:rPr lang="id-ID"/><a:t>${line}</a:t></a:r></a:p>`).join('');
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `${XML}<p:sld ${ns}><p:cSld><p:spTree>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Judul"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${slide.title}</a:t></a:r></a:p></p:txBody></p:sp>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Isi"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${body}<a:p/></p:txBody></p:sp>` +
        `</p:spTree></p:cSld></p:sld>`,
    );
  });
  files['ppt/presentation.xml'] = strToU8(
    `${XML}<p:presentation ${ns}><p:sldIdLst>${order.map((n, k) => `<p:sldId id="${256 + k}" r:id="rId${n + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`,
  );
  files['ppt/_rels/presentation.xml.rels'] = strToU8(
    `${XML}<Relationships xmlns="${PKG}/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${DOC}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`,
  );
  return Buffer.from(zipSync(files));
}

/** PDF sekecil mungkin: satu baris teks per halaman (tanpa tanda kurung); teks kosong = halaman tanpa teks. */
function pdf(pages: string[]): Buffer {
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: number[] = [];
  for (const text of pages) {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : '';
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`,
    );
    kids.push(objects.length);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('gambar uji')]);

describe('knowledge routes', () => {
  it('requires a session for every route', async () => {
    await setup();
    const routes: ['GET' | 'POST' | 'PATCH' | 'DELETE', string][] = [
      ['GET', '/api/knowledge'],
      ['POST', '/api/knowledge'],
      ['POST', '/api/knowledge/notes'],
      ['PATCH', '/api/knowledge/1'],
      ['DELETE', '/api/knowledge/1'],
      ['POST', '/api/knowledge/1/restore'],
      ['POST', '/api/knowledge/1/reprocess'],
      ['GET', '/api/knowledge/1/file'],
    ];
    for (const [method, url] of routes) {
      const res = await app.inject({ method, url, headers: { origin: ORIGIN } });
      expect([method, url, res.statusCode]).toEqual([method, url, 401]);
    }
  });

  it('creates notes that are listed, filtered and searchable right away', async () => {
    await setup();
    const events: BusEvent[] = [];
    app.deps.bus.on((e) => events.push(e));

    const created = await note(
      'Tarif PPh Final UMKM',
      'Tarif PPh final untuk UMKM adalah 0,5% dari omzet bruto setiap bulan.\n\nBerlaku untuk omzet sampai 4,8 miliar setahun.',
      ['UMKM', 'umkm', ' Tarif '],
    );
    expect(created).toMatchObject({
      kind: 'note',
      status: 'ready',
      error: null,
      tags: ['UMKM', 'Tarif'],
      fileName: null,
      fileSize: null,
      fileUrl: null,
      pageCount: null,
      isActive: true,
      isOfficial: false,
      validUntil: null,
      deletedAt: null,
      uploadedBy: { name: 'Petugas' },
    });
    expect(created.summary).toContain('Tarif PPh final untuk UMKM');
    expect(created.charCount).toBeGreaterThan(50);
    expect(events).toContainEqual({ type: 'library.updated', resource: 'knowledge' });
    expect(await auditActions()).toContain('knowledge.note');

    await note('Jam Layanan', 'Loket buka Senin sampai Jumat pukul 08.00 sampai 16.00.', ['Layanan']);
    const all = await list();
    expect(all.documents.map((d) => d.title)).toEqual(['Jam Layanan', 'Tarif PPh Final UMKM']);
    expect(all.tags).toEqual(['Layanan', 'Tarif', 'UMKM']);
    expect(all.totalBytes).toBe(0);
    expect(all.quotaBytes).toBe(KB_QUOTA_MB * 1024 * 1024);

    const hits = await searchKnowledge(app.deps, 'omzet');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ documentId: created.id, title: 'Tarif PPh Final UMKM', page: null, isOfficial: false });
    expect(hits[0]!.snippet).toContain('omzet');
    expect(await searchKnowledge(app.deps, '   ')).toEqual([]);

    expect(await titles('?q=omzet')).toEqual(['Tarif PPh Final UMKM']);
    expect(await titles('?q=jam%20layanan')).toEqual(['Jam Layanan']);
    expect(await titles('?q=tidakadadimanapun')).toEqual([]);
    expect(await titles('?tag=umkm')).toEqual(['Tarif PPh Final UMKM']);
    expect(await titles('?tag=lain')).toEqual([]);
    expect(await titles('?trash=1')).toEqual([]);

    expect((await call('POST', '/api/knowledge/notes', { title: ' ', text: 'isi' })).statusCode).toBe(400);
    expect((await call('POST', '/api/knowledge/notes', { title: 'Judul', text: '' })).statusCode).toBe(400);
    // Catatan tidak punya berkas asli dan tidak diproses worker.
    expect((await call('GET', `/api/knowledge/${created.id}/file`)).statusCode).toBe(404);
    expect((await call('POST', `/api/knowledge/${created.id}/reprocess`)).statusCode).toBe(400);
  });

  it('stores an uploaded text file, processes it in the worker and rejects duplicates', async () => {
    await setup();
    const text =
      'Batas waktu pelaporan SPT Tahunan orang pribadi adalah 31 Maret.\r\n\r\nSPT Tahunan badan paling lambat 30 April.\r\n';
    const res = await upload('Batas Lapor SPT.txt', text);
    expect(res.statusCode).toBe(201);
    const doc = res.json().document as KbDocumentDTO;
    expect(doc).toMatchObject({
      kind: 'file',
      title: 'Batas Lapor SPT',
      fileName: 'Batas Lapor SPT.txt',
      mimeType: 'text/plain',
      fileSize: Buffer.byteLength(text),
      status: 'processing',
      error: null,
      fileUrl: `/api/knowledge/${doc.id}/file`,
      uploadedBy: { name: 'Petugas' },
    });
    const stored = path.join(storage, 'knowledge', `${sha256Hex(text)}.txt`);
    expect(await exists(stored)).toBe(true);
    expect((await row(doc.id))!.storagePath).toBe(`knowledge/${sha256Hex(text)}.txt`);
    // Belum diproses: belum bisa dicari.
    expect(await found('pelaporan')).toEqual([]);

    const events: BusEvent[] = [];
    app.deps.bus.on((e) => events.push(e));
    expect(await drain()).toBe(1);
    expect(events).toContainEqual({ type: 'library.updated', resource: 'knowledge' });
    const ready = await document(doc.id);
    expect(ready).toMatchObject({ status: 'ready', error: null, pageCount: null });
    expect(ready.charCount).toBe(normalizeText(text).length);
    expect(ready.summary).toMatch(/^Batas waktu pelaporan SPT Tahunan/);
    expect(await found('pelaporan')).toEqual(['Batas Lapor SPT']);
    expect(await drain()).toBe(0);

    // Isi yang sama dengan nama lain tetap dianggap berkas yang sama.
    const dup = await upload('salinan.md', text);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatchObject({ code: 'duplicate_file' });
    expect(dup.json().error.message).toContain('Batas Lapor SPT');
    expect(await t.get().db.$count(kbDocuments)).toBe(1);
    expect((await list()).totalBytes).toBe(Buffer.byteLength(text));

    const file = await call('GET', `/api/knowledge/${doc.id}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.body).toBe(text);
    expect(file.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(file.headers['content-disposition']).toBe("inline; filename*=UTF-8''Batas%20Lapor%20SPT.txt");
    expect(file.headers['content-security-policy']).toContain('sandbox');
    const download = await call('GET', `/api/knowledge/${doc.id}/file?download=1`);
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    expect(await auditActions()).toEqual(['knowledge.upload']);
  });

  it('validates uploads: file required, type, size and quota', async () => {
    await setup();
    const noFile = await call('POST', '/api/knowledge', { bukan: 'multipart' });
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json().error.code).toBe('file_required');

    const exe = await upload('program.exe', 'MZ');
    expect(exe.statusCode).toBe(400);
    expect(exe.json().error).toMatchObject({ code: 'unsupported_file' });
    expect(exe.json().error.message).toContain('belum didukung');
    expect((await upload('tanpa-ekstensi', 'isi')).statusCode).toBe(400);
    expect((await upload('kosong.txt', '')).json().error.code).toBe('file_empty');

    const big = await upload('besar.txt', Buffer.alloc(KB_MAX_FILE_MB * 1024 * 1024 + 1, 0x61));
    expect(big.statusCode).toBe(413);
    expect(big.json().error).toMatchObject({ code: 'file_too_large' });
    expect(big.json().error.message).toContain(`${KB_MAX_FILE_MB} MB`);

    // Kuota dihitung dari berkas yang tidak di tempat sampah.
    await t
      .get()
      .db.insert(kbDocuments)
      .values({ title: 'Pengisi kuota', tags: [], fileSize: KB_QUOTA_MB * 1024 * 1024 - 5, status: 'ready' });
    const full = await upload('kecil.txt', 'lebih dari lima byte');
    expect(full.statusCode).toBe(413);
    expect(full.json().error.code).toBe('quota_exceeded');
    expect((await upload('pas.txt', 'lima!')).statusCode).toBe(201);
    expect(await titles()).toEqual(['pas', 'Pengisi kuota']);
  });

  it('moves documents to the trash and restores them', async () => {
    await setup();
    const text = 'Pemindahbukuan diajukan lewat formulir Pbk di loket atau secara daring.';
    const doc = await uploaded('Pemindahbukuan.txt', text);
    await drain();
    expect(await found('pemindahbukuan')).toEqual(['Pemindahbukuan']);

    expect((await call('DELETE', `/api/knowledge/${doc.id}`)).json()).toEqual({ ok: true });
    expect(await titles()).toEqual([]);
    const trash = await list('?trash=1');
    expect(trash.documents).toHaveLength(1);
    expect(trash.documents[0]).toMatchObject({ id: doc.id, deletedBy: { name: 'Petugas' } });
    expect(trash.documents[0]!.deletedAt).not.toBeNull();
    expect(trash.totalBytes).toBe(0);
    expect(await titles('?trash=1&q=formulir')).toEqual(['Pemindahbukuan']);
    expect(await found('pemindahbukuan')).toEqual([]);
    expect(await readKnowledge(app.deps, Number(doc.id))).toBeNull();
    // Berkas dan potongannya tetap disimpan selama di tempat sampah.
    expect(await exists(path.join(storage, 'knowledge', `${sha256Hex(text)}.txt`))).toBe(true);
    expect(await chunksOf(doc.id)).toHaveLength(1);
    expect((await call('GET', `/api/knowledge/${doc.id}/file`)).statusCode).toBe(200);

    // Di tempat sampah: tidak bisa diubah; menghapus lagi tidak mengubah apa pun.
    expect((await call('PATCH', `/api/knowledge/${doc.id}`, { title: 'Baru' })).statusCode).toBe(409);
    expect((await call('POST', `/api/knowledge/${doc.id}/reprocess`)).statusCode).toBe(409);
    const deletedAt = (await row(doc.id))!.deletedAt;
    expect((await call('DELETE', `/api/knowledge/${doc.id}`)).json()).toEqual({ ok: true });
    expect((await row(doc.id))!.deletedAt).toEqual(deletedAt);

    // Mengunggah berkas yang sama memulihkan baris lama, bukan membuat dokumen baru.
    const again = await uploaded('nama-lain.txt', text);
    expect(again).toMatchObject({ id: doc.id, title: 'Pemindahbukuan', status: 'ready', deletedAt: null, deletedBy: null });
    expect(await t.get().db.$count(kbDocuments)).toBe(1);
    expect(await found('pemindahbukuan')).toEqual(['Pemindahbukuan']);

    await call('DELETE', `/api/knowledge/${doc.id}`);
    const restored = await call('POST', `/api/knowledge/${doc.id}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json().document).toMatchObject({ id: doc.id, deletedAt: null, deletedBy: null });
    expect(await titles()).toEqual(['Pemindahbukuan']);
    expect(await found('pemindahbukuan')).toEqual(['Pemindahbukuan']);

    expect(await auditActions()).toEqual([
      'knowledge.upload',
      'knowledge.delete',
      'knowledge.restore',
      'knowledge.delete',
      'knowledge.restore',
    ]);
    for (const [method, url] of [
      ['DELETE', '/api/knowledge/999999'],
      ['POST', '/api/knowledge/999999/restore'],
      ['POST', '/api/knowledge/999999/reprocess'],
      ['PATCH', '/api/knowledge/999999'],
      ['GET', '/api/knowledge/999999/file'],
    ] as const) {
      expect((await call(method, url, method === 'PATCH' ? { title: 'x' } : undefined)).statusCode).toBe(404);
    }
  });

  it('updates metadata; inactive and expired documents are not used by AOS', async () => {
    await setup();
    const a = await note('Restitusi A', 'Permohonan restitusi diproses paling lama dua belas bulan.');
    const b = await note('Restitusi B', 'Permohonan restitusi diproses paling lama dua belas bulan.');
    const ids = async (q = 'restitusi') => (await searchKnowledge(app.deps, q)).map((h) => h.documentId);
    const catalog = async () => (await knowledgeCatalog(app.deps)).map((d) => d.id);
    expect((await ids()).sort()).toEqual([a.id, b.id].sort());

    const patched = await call('PATCH', `/api/knowledge/${a.id}`, {
      title: 'Restitusi Resmi',
      description: 'Dari peraturan terbaru',
      tags: ['Restitusi', 'restitusi'],
      isOfficial: true,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().document).toMatchObject({
      title: 'Restitusi Resmi',
      description: 'Dari peraturan terbaru',
      tags: ['Restitusi'],
      isOfficial: true,
    });
    // Sumber resmi diutamakan.
    expect(await ids()).toEqual([a.id, b.id]);
    expect(await catalog()).toEqual([a.id, b.id]);
    expect((await searchKnowledge(app.deps, 'restitusi', 1)).map((h) => h.isOfficial)).toEqual([true]);
    expect(await titles('?q=peraturan%20terbaru')).toEqual(['Restitusi Resmi']);

    expect((await call('PATCH', `/api/knowledge/${a.id}`, { isActive: false })).json().document.isActive).toBe(false);
    expect(await ids()).toEqual([b.id]);
    expect(await catalog()).toEqual([b.id]);
    expect(await readKnowledge(app.deps, Number(a.id))).toBeNull();
    // Tetap tampil di halaman Pustaka.
    expect(await titles()).toEqual(['Restitusi B', 'Restitusi Resmi']);
    await call('PATCH', `/api/knowledge/${a.id}`, { isActive: true });
    expect(await ids()).toEqual([a.id, b.id]);

    await call('PATCH', `/api/knowledge/${b.id}`, { validUntil: jakartaDay(-1) });
    expect(await ids()).toEqual([a.id]);
    expect(await catalog()).toEqual([a.id]);
    // Tanggal valid_until itu sendiri masih berlaku.
    await call('PATCH', `/api/knowledge/${b.id}`, { validUntil: jakartaDay() });
    expect(await ids()).toEqual([a.id, b.id]);
    const cleared = await call('PATCH', `/api/knowledge/${b.id}`, { validUntil: null, description: null });
    expect(cleared.json().document).toMatchObject({ validUntil: null, description: null });

    expect((await call('PATCH', `/api/knowledge/${b.id}`, { validUntil: '31-12-2026' })).statusCode).toBe(400);
    expect((await call('PATCH', `/api/knowledge/${b.id}`, { title: '' })).statusCode).toBe(400);
    expect(await auditActions()).toContain('knowledge.update');
  });
});

describe('knowledge extraction', () => {
  it('reads PPTX slides as pages, in presentation order', async () => {
    await setup();
    const deck = pptx(
      [
        { title: 'Penutup', body: ['Hubungi Kring Pajak 1500200 &amp; kantor terdekat.'] },
        { title: 'Syarat Pengukuhan PKP', body: ['Omzet di atas 4,8 miliar setahun.', 'Mengajukan permohonan daring.'] },
      ],
      [1, 0],
    );
    const doc = await uploaded('Sosialisasi PKP.pptx', deck);
    expect(doc.mimeType).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation');
    await drain();
    expect(await document(doc.id)).toMatchObject({ status: 'ready', pageCount: 2 });
    const chunks = await chunksOf(doc.id);
    expect(chunks.map((c) => [c.page, c.heading])).toEqual([
      [1, 'Syarat Pengukuhan PKP'],
      [2, 'Penutup'],
    ]);
    expect(chunks[0]!.text).toBe('Syarat Pengukuhan PKP\nOmzet di atas 4,8 miliar setahun.\nMengajukan permohonan daring.');
    expect(chunks[1]!.text).toContain('1500200 & kantor');

    const [hit] = await searchKnowledge(app.deps, 'permohonan daring');
    expect(hit).toMatchObject({ documentId: doc.id, page: 1, heading: 'Syarat Pengukuhan PKP' });
    const page = await readKnowledge(app.deps, Number(doc.id), 2);
    expect(page).toMatchObject({ title: 'Sosialisasi PKP', page: 2, pageCount: 2 });
    expect(page!.text).toBe('Penutup\nHubungi Kring Pajak 1500200 & kantor terdekat.');
    const whole = await readKnowledge(app.deps, Number(doc.id));
    expect(whole!.page).toBeNull();
    expect(whole!.text).toMatch(/^\[Halaman 1\]\nSyarat Pengukuhan PKP[\s\S]+\n\n\[Halaman 2\]\nPenutup/);
    expect((await readKnowledge(app.deps, Number(doc.id), 9))!.text).toBe('');
    // Berkas Office tidak dibuka langsung di browser.
    const file = await call('GET', `/api/knowledge/${doc.id}/file`);
    expect(file.headers['content-disposition']).toMatch(/^attachment;/);
  });

  it('reads DOCX and text PDFs, and reports scanned or broken files', async () => {
    await setup();
    const word = await uploaded('Surat Edaran.docx', docx(['Ketentuan Angsuran', 'Angsuran PPh Pasal 25 dibayar paling lambat tanggal 15.']));
    const text = await uploaded('Batas Lapor.pdf', pdf(['Tarif PPh final UMKM setengah persen', 'Batas lapor SPT Tahunan akhir Maret']));
    const scan = await uploaded('Hasil Pindai.pdf', pdf(['']));
    const broken = await uploaded('Rusak.docx', 'ini bukan berkas zip');
    const fake = await uploaded('Palsu.pdf', 'ini bukan pdf');
    expect(await drain()).toBe(5);

    expect(await document(word.id)).toMatchObject({ status: 'ready', pageCount: null });
    expect((await chunksOf(word.id)).map((c) => c.text)).toEqual([
      'Ketentuan Angsuran\n\nAngsuran PPh Pasal 25 dibayar paling lambat tanggal 15.',
    ]);
    expect(await found('angsuran')).toEqual(['Surat Edaran']);

    expect(await document(text.id)).toMatchObject({ status: 'ready', pageCount: 2 });
    const [hit] = await searchKnowledge(app.deps, 'Maret');
    expect(hit).toMatchObject({ documentId: text.id, page: 2, snippet: 'Batas lapor SPT Tahunan akhir Maret' });
    expect((await readKnowledge(app.deps, Number(text.id), 1))!.text).toBe('Tarif PPh final UMKM setengah persen');
    const inline = await call('GET', `/api/knowledge/${text.id}/file`);
    expect(inline.headers['content-type']).toBe('application/pdf');
    expect(inline.headers['content-disposition']).toMatch(/^inline;/);

    const scanned = await document(scan.id);
    expect(scanned).toMatchObject({ status: 'failed', pageCount: null, summary: null });
    expect(scanned.error).toMatch(/pindai/);
    expect(scanned.error).toMatch(/PDF berteks/);
    expect((await document(broken.id)).error).toMatch(/bukan DOCX yang valid/);
    expect((await document(fake.id)).error).toMatch(/bukan PDF yang valid/);
    expect(await chunksOf(scan.id)).toEqual([]);
  });

  it('reads images only through the AI hook, and summarises with it when available', async () => {
    await setup();
    const doc = await uploaded('Kode Billing.png', PNG);
    expect(doc.mimeType).toBe('image/png');
    await drain();
    const failed = await document(doc.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/koneksi AI/);
    expect(await found('billing')).toEqual([]);

    const seen: { bytes: number; mime: string; title: string }[] = [];
    setKnowledgeAi({
      readImage: async (data, mime) => {
        seen.push({ bytes: data.length, mime, title: '' });
        return 'Kode billing berlaku tujuh hari sejak diterbitkan.';
      },
      summarize: async (text, title) => {
        seen.push({ bytes: text.length, mime: '', title });
        return ' Ringkasan buatan AI. ';
      },
    });
    const re = await call('POST', `/api/knowledge/${doc.id}/reprocess`);
    expect(re.statusCode).toBe(200);
    expect(re.json().document).toMatchObject({ status: 'processing', error: null });
    expect(await drain()).toBe(1);
    expect(await document(doc.id)).toMatchObject({ status: 'ready', error: null, summary: 'Ringkasan buatan AI.' });
    expect(seen).toEqual([
      { bytes: PNG.length, mime: 'image/png', title: '' },
      { bytes: 'Kode billing berlaku tujuh hari sejak diterbitkan.'.length, mime: '', title: 'Kode Billing' },
    ]);
    expect(await found('billing')).toEqual(['Kode Billing']);
    expect(await auditActions()).toContain('knowledge.reprocess');

    // AI yang gagal: gambar ditandai gagal, ringkasan memakai cuplikan awal.
    setKnowledgeAi({
      readImage: async () => {
        throw new Error('rate limited');
      },
      summarize: async () => {
        throw new Error('rate limited');
      },
    });
    await call('POST', `/api/knowledge/${doc.id}/reprocess`);
    const plain = await uploaded('Catatan Rapat.md', '# Rapat\n\nPembahasan target penerimaan triwulan.');
    await drain();
    expect((await document(doc.id)).error).toMatch(/gagal dibaca lewat koneksi AI/);
    expect(await found('billing')).toEqual([]);
    expect(await document(plain.id)).toMatchObject({ status: 'ready', summary: '# Rapat Pembahasan target penerimaan triwulan.' });
    expect((await chunksOf(plain.id))[0]!.heading).toBe('Rapat');
  });
});

describe('knowledge worker', () => {
  it('continues documents left in processing when it starts and wakes up on new uploads', async () => {
    await setup();
    const first = await uploaded('satu.txt', 'Dokumen pertama tentang keberatan pajak.');
    const worker = new KnowledgeWorker(app.deps, quiet);
    worker.start();
    try {
      const ready = (id: string) =>
        vi.waitFor(async () => expect((await row(id))!.status).toBe('ready'), { timeout: 15_000, interval: 100 });
      await ready(first.id);
      const second = await uploaded('dua.txt', 'Dokumen kedua tentang banding pajak.');
      await ready(second.id);
    } finally {
      await worker.stop();
    }
    expect(await found('banding')).toEqual(['dua']);
  });

  it('marks a document failed when its file is gone or processing keeps getting interrupted', async () => {
    await setup();
    const text = 'Berkas yang akan hilang dari disk.';
    const gone = await uploaded('hilang.txt', text);
    await unlink(path.join(storage, 'knowledge', `${sha256Hex(text)}.txt`));
    const stuck = await uploaded('macet.txt', 'Berkas yang pemrosesannya selalu terhenti.');
    // Hitungan percobaan disimpan di kolom error selama processing dan tidak dikirim ke browser.
    await t
      .get()
      .db.update(kbDocuments)
      .set({ error: 'attempt:3' })
      .where(eq(kbDocuments.id, Number(stuck.id)));
    expect((await document(stuck.id)).error).toBeNull();

    expect(await drain()).toBe(2);
    expect(await document(gone.id)).toMatchObject({ status: 'failed' });
    expect((await document(gone.id)).error).toMatch(/sudah tidak ada di server/);
    expect((await document(stuck.id)).error).toMatch(/berulang kali terhenti/);
    expect((await call('GET', `/api/knowledge/${gone.id}/file`)).statusCode).toBe(404);

    // Proses ulang mengulang hitungan dari awal.
    await call('POST', `/api/knowledge/${stuck.id}/reprocess`);
    await drain();
    expect(await document(stuck.id)).toMatchObject({ status: 'ready', error: null });
  });
});

describe('knowledge search and reading', () => {
  it('falls back to LIKE for short or partial words and for title-only matches', async () => {
    await setup();
    await note('Kode KLU', 'KLU 47111 dipakai untuk toko kelontong. NTPN terdiri dari 16 digit.');
    await note('Prosedur Pindah KPP', 'Wajib pajak mengajukan perubahan data lewat formulir yang tersedia.');
    // "47" terlalu pendek untuk indeks FULLTEXT; "kelon" hanya sebagian kata.
    expect(await found('47')).toEqual(['Kode KLU']);
    expect(await found('kelon')).toEqual(['Kode KLU']);
    expect(await found('100%')).toEqual([]);
    // Cocok di judul saja: dokumen diwakili potongan pertamanya.
    const [hit] = await searchKnowledge(app.deps, 'pindah kpp');
    expect(hit).toMatchObject({ title: 'Prosedur Pindah KPP' });
    expect(hit!.snippet).toMatch(/^Wajib pajak mengajukan/);
    expect(await titles('?q=kelon')).toEqual(['Kode KLU']);
  });

  it('chunks long documents with overlap and reads them back without repeating it', async () => {
    await setup();
    const paragraphs = Array.from(
      { length: 40 },
      (_, i) => `Butir ${i + 1}. ${'Wajib pajak menyampaikan surat pemberitahuan tepat waktu sesuai ketentuan yang berlaku. '.repeat(8).trim()}`,
    );
    const text = `PEDOMAN PELAPORAN\n\n${paragraphs.slice(0, 20).join('\n\n')}\n\n## Sanksi Administrasi\n\n${paragraphs.slice(20).join('\n\n')}`;
    const chunks = chunkSegments([{ page: null, text }]);
    expect(chunks.length).toBeGreaterThan(15);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_SIZE * 1.2);
    // Potongan berikutnya diawali ekor potongan sebelumnya; digabung lagi hasilnya persis teks aslinya.
    expect(chunks[1]!.text.slice(0, 20)).toBe(chunks[0]!.text.slice(chunks[0]!.text.indexOf(chunks[1]!.text.slice(0, 20))).slice(0, 20));
    expect(chunks[0]!.text.endsWith(chunks[1]!.text.slice(0, 40))).toBe(false);
    expect(joinChunks(chunks.map((c) => c.text))).toBe(normalizeText(text));
    expect(chunks[0]!.heading).toBe('PEDOMAN PELAPORAN');
    expect(chunks.at(-1)!.heading).toBe('Sanksi Administrasi');
    expect(chunkSegments([{ page: 3, text: '  \n ' }])).toEqual([]);
    // Teks tanpa spasi sama sekali tetap terpotong habis.
    const solid = chunkSegments([{ page: null, text: 'x'.repeat(5000) }]);
    expect(solid.map((c) => c.text).join('')).toBe('x'.repeat(5000));

    const doc = await note('Pedoman Pelaporan', text);
    expect(await t.get().db.$count(kbChunks)).toBe(chunks.length);
    const read = await readKnowledge(app.deps, Number(doc.id));
    expect(read).toMatchObject({ title: 'Pedoman Pelaporan', page: null, pageCount: null });
    expect(read!.text.endsWith('[… isi dipotong]')).toBe(true);
    expect(read!.text.length).toBeLessThan(12_100);
    expect(normalizeText(text).startsWith(read!.text.slice(0, 11_900))).toBe(true);
    // Dokumen tanpa halaman selalu dibaca utuh, berapa pun halaman yang diminta.
    expect((await readKnowledge(app.deps, Number(doc.id), 4))!.page).toBeNull();
    expect(await readKnowledge(app.deps, 999_999)).toBeNull();

    const [hit] = await searchKnowledge(app.deps, 'sanksi administrasi');
    expect(hit).toMatchObject({ heading: 'Sanksi Administrasi' });
    expect(hit!.snippet.length).toBeLessThanOrEqual(302);
    expect(hit!.snippet).toContain('Sanksi Administrasi');
    // Satu dokumen panjang tidak memenuhi seluruh hasil.
    expect(await searchKnowledge(app.deps, 'pemberitahuan', 10)).toHaveLength(3);
  });
});

describe('knowledge housekeeping', () => {
  it('purges documents that spent 30 days in the trash, with their chunks and files', async () => {
    await setup();
    const oldText = 'Dokumen lama yang sudah sebulan di tempat sampah.';
    const sharedText = 'Berkas yang dipakai dua baris dokumen.';
    const recentText = 'Dokumen yang baru kemarin dihapus.';
    const old = await uploaded('lama.txt', oldText);
    const shared = await uploaded('bersama.txt', sharedText);
    const recent = await uploaded('baru.txt', recentText);
    const kept = await note('Catatan aktif', 'Tetap ada.');
    await drain();
    for (const doc of [old, shared, recent]) await call('DELETE', `/api/knowledge/${doc.id}`);
    const db = t.get().db;
    const longAgo = new Date(Date.now() - 31 * 86_400_000);
    for (const doc of [old, shared]) {
      await db
        .update(kbDocuments)
        .set({ deletedAt: longAgo })
        .where(eq(kbDocuments.id, Number(doc.id)));
    }
    // Baris lain yang masih memakai berkas yang sama: berkasnya tidak boleh ikut terhapus.
    const sharedPath = (await row(shared.id))!.storagePath!;
    await db.insert(kbDocuments).values({ title: 'Kembaran', tags: [], storagePath: sharedPath, status: 'ready' });

    const result = await runHousekeeping(app.deps);
    expect(result.knowledgeDocuments).toBe(2);
    expect(await row(old.id)).toBeUndefined();
    expect(await row(shared.id)).toBeUndefined();
    expect(await chunksOf(old.id)).toEqual([]);
    const file = (text: string) => path.join(storage, 'knowledge', `${sha256Hex(text)}.txt`);
    expect(await exists(file(oldText))).toBe(false);
    expect(await exists(file(sharedText))).toBe(true);
    expect(await exists(file(recentText))).toBe(true);
    expect((await list('?trash=1')).documents.map((d) => d.id)).toEqual([recent.id]);
    expect(await titles()).toEqual(['Kembaran', kept.title]);
    expect((await runHousekeeping(app.deps)).knowledgeDocuments).toBe(0);
  });
});
