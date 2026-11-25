import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, inArray, isNotNull, isNull, like, lt, ne, or, sum, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  KB_EXTENSIONS,
  KB_MAX_FILE_MB,
  KB_QUOTA_MB,
  type KbDocumentDTO,
  type kbListQuery,
  type KbListDTO,
  type kbUpdateBody,
} from '@wa/shared';
import type { Config } from '../../config';
import type { Db } from '../../db/client';
import { kbChunks, kbDocuments, users } from '../../db/schema';
import { sha256Hex } from '../../lib/crypto';
import { AppError, notFound } from '../../lib/errors';
import type { AppDeps } from '../../types';
import { mediaAbsolutePath } from '../media/service';
import { chunkSegments, excerpt, normalizeText, type Chunk } from './chunk';
import { documentIdsMatchingContent, likePattern } from './search';

// Yang dipakai modul asisten (AOS) diekspor dari satu tempat ini.
export { knowledgeCatalog, readKnowledge, searchKnowledge } from './search';

export type KbDocumentRow = typeof kbDocuments.$inferSelect;
type KbExtension = (typeof KB_EXTENSIONS)[number];
/** Koneksi biasa atau transaksi yang sedang berjalan. */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const MIB = 1024 * 1024;
export const KB_MAX_FILE_BYTES = KB_MAX_FILE_MB * MIB;
export const KB_QUOTA_BYTES = KB_QUOTA_MB * MIB;
const STORAGE_FOLDER = 'knowledge';
const INSERT_BATCH = 50;

// Tipe MIME ditentukan dari ekstensi yang sudah divalidasi, bukan dari klaim browser pengunggah.
const MIME_BY_EXTENSION: Record<KbExtension, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** Kemampuan AI opsional untuk Pustaka; dipasang modul asisten selama koneksi AI tersedia. */
export interface KnowledgeAi {
  summarize?(text: string, title: string): Promise<string | null>;
  readImage?(data: Buffer, mimeType: string): Promise<string | null>;
}

let knowledgeAi: KnowledgeAi | null = null;

export function setKnowledgeAi(ai: KnowledgeAi | null): void {
  knowledgeAi = ai;
}

export function getKnowledgeAi(): KnowledgeAi | null {
  return knowledgeAi;
}

const changed = (deps: AppDeps) => deps.bus.emit({ type: 'library.updated', resource: 'knowledge' });

export const fileTooLarge = () =>
  new AppError(413, 'file_too_large', `Berkas melebihi ${KB_MAX_FILE_MB} MB. Perkecil atau pecah berkasnya.`);

/** Ubah baris dokumen menjadi DTO, lengkap dengan nama pengunggah dan penghapusnya. */
export async function documentDTOs(db: Db, rows: KbDocumentRow[]): Promise<KbDocumentDTO[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.uploadedBy, r.deletedBy]).filter((id) => id !== null))];
  const people =
    ids.length > 0
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))
      : [];
  const byId = new Map(people.map((u) => [u.id, { id: String(u.id), name: u.name }]));
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    title: r.title,
    description: r.description,
    tags: r.tags,
    fileName: r.fileName,
    mimeType: r.mimeType,
    fileSize: r.fileSize,
    status: r.status,
    // Selama processing kolom error dipakai worker untuk hitungan percobaan; itu bukan pesan untuk petugas.
    error: r.status === 'failed' ? r.error : null,
    pageCount: r.pageCount,
    charCount: r.charCount,
    summary: r.summary,
    isActive: r.isActive,
    isOfficial: r.isOfficial,
    validUntil: r.validUntil,
    uploadedBy: (r.uploadedBy !== null && byId.get(r.uploadedBy)) || null,
    createdAt: r.createdAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
    deletedBy: (r.deletedBy !== null && byId.get(r.deletedBy)) || null,
    fileUrl: r.kind === 'file' && r.storagePath ? `/api/knowledge/${r.id}/file` : null,
  }));
}

export async function getDocument(db: Db, id: number): Promise<KbDocumentRow> {
  const [row] = await db.select().from(kbDocuments).where(eq(kbDocuments.id, id)).limit(1);
  if (!row) throw notFound('Dokumen');
  return row;
}

async function documentDTO(db: Db, id: number): Promise<KbDocumentDTO> {
  const [dto] = await documentDTOs(db, [await getDocument(db, id)]);
  return dto!;
}

/** Dokumen yang tidak sedang di tempat sampah; yang di tempat sampah harus dipulihkan dulu sebelum diubah. */
async function getActiveDocument(db: Db, id: number): Promise<KbDocumentRow> {
  const row = await getDocument(db, id);
  if (row.deletedAt !== null) {
    throw new AppError(409, 'in_trash', 'Dokumen ini ada di tempat sampah. Pulihkan dulu untuk mengubahnya.');
  }
  return row;
}

/** Tag tanpa duplikat (tanpa membedakan huruf besar/kecil), ejaan pertama yang dipakai. */
function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out.slice(0, 10);
}

/** Daftar Pustaka (atau isi tempat sampah), terbaru lebih dulu, beserta semua tag dan pemakaian kuota. */
export async function listKnowledge(deps: AppDeps, query: z.infer<typeof kbListQuery>): Promise<KbListDTO> {
  const { db } = deps.database;
  const trash = query.trash === '1';
  const scope = trash ? isNotNull(kbDocuments.deletedAt) : isNull(kbDocuments.deletedAt);
  const conditions: (SQL | undefined)[] = [scope];
  if (query.q) {
    const pattern = likePattern(query.q);
    const byContent = await documentIdsMatchingContent(db, query.q, scope);
    conditions.push(
      or(
        like(kbDocuments.title, pattern),
        like(kbDocuments.description, pattern),
        like(kbDocuments.fileName, pattern),
        byContent.length > 0 ? inArray(kbDocuments.id, byContent) : undefined,
      ),
    );
  }
  const rows = await db
    .select()
    .from(kbDocuments)
    .where(and(...conditions))
    // Tempat sampah: yang terakhir dihapus lebih dulu.
    .orderBy(trash ? desc(kbDocuments.deletedAt) : desc(kbDocuments.createdAt), desc(kbDocuments.id));
  const tag = query.tag?.toLowerCase();
  const visible = tag ? rows.filter((r) => r.tags.some((t) => t.toLowerCase() === tag)) : rows;

  const active = await db
    .select({ tags: kbDocuments.tags, fileSize: kbDocuments.fileSize })
    .from(kbDocuments)
    .where(isNull(kbDocuments.deletedAt));
  return {
    documents: await documentDTOs(db, visible),
    tags: uniqueTags(active.flatMap((r) => r.tags)).sort((a, b) => a.localeCompare(b, 'id')),
    totalBytes: active.reduce((total, r) => total + (r.fileSize ?? 0), 0),
    quotaBytes: KB_QUOTA_BYTES,
  };
}

/** Ganti seluruh potongan teks sebuah dokumen. */
export async function replaceChunks(tx: Executor, documentId: number, chunks: Chunk[]): Promise<void> {
  await tx.delete(kbChunks).where(eq(kbChunks.documentId, documentId));
  for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
    await tx.insert(kbChunks).values(
      chunks.slice(i, i + INSERT_BATCH).map((chunk, j) => ({
        documentId,
        seq: i + j,
        page: chunk.page,
        heading: chunk.heading,
        text: chunk.text,
      })),
    );
  }
}

/** Buat catatan Pustaka; teksnya langsung dipotong sehingga catatan langsung siap dipakai AOS. */
export async function createNote(
  deps: AppDeps,
  input: { title: string; text: string; tags: string[] },
  userId: number | null,
): Promise<KbDocumentDTO> {
  const title = input.title.trim().slice(0, 190);
  const text = normalizeText(input.text);
  if (!title) throw new AppError(400, 'title_required', 'Judul wajib diisi.');
  if (!text) throw new AppError(400, 'text_required', 'Isi catatan wajib diisi.');
  const chunks = chunkSegments([{ page: null, text }]);
  const { db } = deps.database;
  const id = await db.transaction(async (tx) => {
    const [res] = await tx.insert(kbDocuments).values({
      kind: 'note',
      title,
      tags: uniqueTags(input.tags),
      status: 'ready',
      charCount: text.length,
      summary: excerpt(text),
      uploadedBy: userId,
    });
    await replaceChunks(tx, res.insertId, chunks);
    return res.insertId;
  });
  changed(deps);
  return documentDTO(db, id);
}

/** Nama berkas tanpa folder dan karakter kontrol, paling panjang 255 karakter (ekstensi dipertahankan). */
function cleanFileName(raw: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/\p{Cc}/gu, '').trim();
  if (base.length <= 255) return base;
  const ext = path.extname(base);
  return `${base.slice(0, 255 - ext.length)}${ext}`;
}

function extensionOf(fileName: string): KbExtension | null {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return (KB_EXTENSIONS as readonly string[]).includes(ext) ? (ext as KbExtension) : null;
}

// Unggah dan pulihkan dijalankan satu per satu (server berjalan dalam satu proses), supaya pemeriksaan
// duplikat dan kuota tidak balapan dengan unggahan lain yang masuk bersamaan.
let queue: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function assertQuota(db: Db, addedBytes: number): Promise<void> {
  const [row] = await db
    .select({ total: sum(kbDocuments.fileSize) })
    .from(kbDocuments)
    .where(isNull(kbDocuments.deletedAt));
  if (Number(row?.total ?? 0) + addedBytes > KB_QUOTA_BYTES) {
    throw new AppError(
      413,
      'quota_exceeded',
      `Kuota Pustaka (${KB_QUOTA_MB / 1024} GB) tidak cukup untuk berkas ini. Hapus berkas yang tidak dipakai lagi, lalu coba lagi.`,
    );
  }
}

const duplicateFile = (title: string) =>
  new AppError(409, 'duplicate_file', `Berkas yang sama sudah ada di Pustaka dengan judul "${title}".`);

/** Tulis berkas ke STORAGE_DIR bila belum ada. Nama berkas = sha256 isinya, jadi isi yang sama tidak ditulis ulang. */
async function ensureStored(config: Config, storagePath: string, data: Buffer): Promise<void> {
  const abs = mediaAbsolutePath(config, storagePath);
  const info = await stat(abs).catch(() => null);
  if (info?.size === data.length) return;
  await mkdir(path.dirname(abs), { recursive: true });
  // Tulis ke berkas sementara lalu ganti nama, supaya pembaca tidak pernah melihat berkas setengah jadi.
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, abs);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

/** Hapus berkas dari disk bila tidak ada lagi dokumen (termasuk yang di tempat sampah) yang memakainya. */
async function removeFileIfUnused(deps: AppDeps, storagePath: string): Promise<void> {
  if (!storagePath.startsWith(`${STORAGE_FOLDER}/`)) return;
  const [used] = await deps.database.db
    .select({ id: kbDocuments.id })
    .from(kbDocuments)
    .where(eq(kbDocuments.storagePath, storagePath))
    .limit(1);
  if (!used) await unlink(mediaAbsolutePath(deps.config, storagePath)).catch(() => undefined);
}

/**
 * Simpan berkas unggahan ke STORAGE_DIR/knowledge/<sha256>.<ext> dan daftarkan untuk diproses worker.
 * Berkas yang sama (sha256) ditolak bila masih ada di Pustaka; bila hanya ada di tempat sampah, baris lama
 * itu dipulihkan (`restored: true`) alih-alih membuat dokumen baru.
 */
export async function uploadDocument(
  deps: AppDeps,
  file: { data: Buffer; fileName: string },
  userId: number | null,
): Promise<{ document: KbDocumentDTO; restored: boolean }> {
  const { data } = file;
  const fileName = cleanFileName(file.fileName);
  const ext = extensionOf(fileName);
  if (!ext) {
    throw new AppError(
      400,
      'unsupported_file',
      'Jenis berkas ini belum didukung. Unggah PDF, DOCX, PPTX, TXT, MD, CSV, JPG, atau PNG.',
    );
  }
  if (data.length === 0) throw new AppError(400, 'file_empty', 'Berkas kosong.');
  if (data.length > KB_MAX_FILE_BYTES) throw fileTooLarge();
  const sha256 = sha256Hex(data);
  const { db } = deps.database;

  const result = await exclusive(async () => {
    const same = await db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.sha256, sha256))
      .orderBy(desc(kbDocuments.id));
    const active = same.find((r) => r.deletedAt === null);
    if (active) throw duplicateFile(active.title);
    await assertQuota(db, data.length);

    const trashed = same.find((r) => r.storagePath !== null);
    if (trashed) {
      await ensureStored(deps.config, trashed.storagePath!, data);
      await db
        .update(kbDocuments)
        // Yang dulu gagal diproses dicoba lagi, karena petugas baru saja mengunggahnya ulang.
        .set({
          deletedAt: null,
          deletedBy: null,
          ...(trashed.status === 'failed' ? { status: 'processing' as const, error: null } : {}),
        })
        .where(eq(kbDocuments.id, trashed.id));
      return { id: trashed.id, restored: true };
    }

    const storagePath = path.posix.join(STORAGE_FOLDER, `${sha256}.${ext}`);
    await ensureStored(deps.config, storagePath, data);
    try {
      const [res] = await db.insert(kbDocuments).values({
        kind: 'file',
        title: path.parse(fileName).name.trim().slice(0, 190) || 'Tanpa judul',
        tags: [],
        fileName,
        mimeType: MIME_BY_EXTENSION[ext],
        fileSize: data.length,
        sha256,
        storagePath,
        status: 'processing',
        uploadedBy: userId,
      });
      return { id: res.insertId, restored: false };
    } catch (err) {
      await removeFileIfUnused(deps, storagePath).catch(() => undefined);
      throw err;
    }
  });
  // Event ini juga membangunkan KnowledgeWorker untuk memproses dokumen berstatus processing.
  changed(deps);
  return { document: await documentDTO(db, result.id), restored: result.restored };
}

export async function updateDocument(
  deps: AppDeps,
  id: number,
  patch: z.infer<typeof kbUpdateBody>,
): Promise<KbDocumentDTO> {
  const { db } = deps.database;
  const row = await getActiveDocument(db, id);
  const set: Partial<typeof kbDocuments.$inferInsert> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description || null;
  if (patch.tags !== undefined) set.tags = uniqueTags(patch.tags);
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  if (patch.isOfficial !== undefined) set.isOfficial = patch.isOfficial;
  if (patch.validUntil !== undefined) set.validUntil = patch.validUntil;
  if (Object.keys(set).length > 0) {
    await db.update(kbDocuments).set(set).where(eq(kbDocuments.id, row.id));
    changed(deps);
  }
  return documentDTO(db, row.id);
}

/**
 * Pindahkan dokumen ke tempat sampah (berkas dan potongannya tetap ada sampai dibersihkan housekeeping).
 * Mengembalikan null bila dokumen memang sudah di tempat sampah.
 */
export async function trashDocument(deps: AppDeps, id: number, userId: number | null): Promise<KbDocumentRow | null> {
  const { db } = deps.database;
  const row = await getDocument(db, id);
  if (row.deletedAt !== null) return null;
  await db.update(kbDocuments).set({ deletedAt: new Date(), deletedBy: userId }).where(eq(kbDocuments.id, row.id));
  changed(deps);
  return row;
}

export async function restoreDocument(deps: AppDeps, id: number): Promise<KbDocumentDTO> {
  const { db } = deps.database;
  await exclusive(async () => {
    const row = await getDocument(db, id);
    if (row.deletedAt === null) return;
    if (row.sha256) {
      const [twin] = await db
        .select({ title: kbDocuments.title })
        .from(kbDocuments)
        .where(and(eq(kbDocuments.sha256, row.sha256), isNull(kbDocuments.deletedAt), ne(kbDocuments.id, row.id)))
        .limit(1);
      if (twin) throw duplicateFile(twin.title);
    }
    await assertQuota(db, row.fileSize ?? 0);
    await db.update(kbDocuments).set({ deletedAt: null, deletedBy: null }).where(eq(kbDocuments.id, row.id));
  });
  changed(deps);
  return documentDTO(db, id);
}

/** Jalankan ulang ekstraksi sebuah berkas (mis. setelah koneksi AI tersedia untuk membaca gambar). */
export async function reprocessDocument(deps: AppDeps, id: number): Promise<KbDocumentDTO> {
  const { db } = deps.database;
  const row = await getActiveDocument(db, id);
  if (row.kind !== 'file' || !row.storagePath) {
    throw new AppError(400, 'not_a_file', 'Catatan tidak perlu diproses ulang.');
  }
  await db.update(kbDocuments).set({ status: 'processing', error: null }).where(eq(kbDocuments.id, row.id));
  changed(deps);
  return documentDTO(db, row.id);
}

/**
 * Hapus permanen dokumen yang masuk tempat sampah sebelum `before` (dipanggil housekeeping); mengembalikan
 * jumlah dokumen yang dihapus. Berkasnya ikut dihapus bila tidak dipakai dokumen lain.
 */
export async function purgeDeletedKnowledge(deps: AppDeps, before: Date): Promise<number> {
  const { db } = deps.database;
  const expired = and(isNotNull(kbDocuments.deletedAt), lt(kbDocuments.deletedAt, before));
  const old = await db
    .select({ id: kbDocuments.id, storagePath: kbDocuments.storagePath })
    .from(kbDocuments)
    .where(expired)
    .limit(5000);
  if (old.length === 0) return 0;
  // kb_chunks ikut terhapus (ON DELETE CASCADE). Syaratnya diulang agar dokumen yang baru saja dipulihkan tidak ikut.
  const [res] = await db.delete(kbDocuments).where(
    and(
      inArray(
        kbDocuments.id,
        old.map((d) => d.id),
      ),
      expired,
    ),
  );
  for (const storagePath of new Set(old.map((d) => d.storagePath))) {
    if (storagePath) await removeFileIfUnused(deps, storagePath);
  }
  return res.affectedRows;
}
