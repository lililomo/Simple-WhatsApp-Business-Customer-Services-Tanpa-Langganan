import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { kbChunks, kbDocuments } from '../../db/schema';
import type { AppDeps } from '../../types';
import { mediaAbsolutePath } from '../media/service';
import { chunkSegments, excerpt, type Segment } from './chunk';
import { AI_TIMEOUT_MS, ExtractError, extractDocument, withTimeout } from './extract';
import { getKnowledgeAi, replaceChunks, type KbDocumentRow, type KnowledgeAi } from './service';

type Log = Pick<FastifyBaseLogger, 'error' | 'warn'>;

// Jaring pengaman saja: pekerjaan baru datang lewat event library.updated, bukan lewat polling.
const POLL_MS = 60_000;
/** Saat server berhenti, pekerjaan yang masih berjalan ditunggu paling lama sekian; sisanya diulang saat start. */
const STOP_WAIT_MS = 5_000;
/** Teks yang diberikan ke peringkas AI (awal dokumen saja). */
const SUMMARY_INPUT_CHARS = 12_000;
const SUMMARY_MAX_CHARS = 2_000;
const GENERIC_FAILURE = 'Berkas gagal diproses. Coba proses ulang; bila tetap gagal, unggah ulang berkasnya.';
const INTERRUPTED_FAILURE =
  'Pemrosesan berkas ini berulang kali terhenti. Berkasnya mungkin terlalu besar atau rumit; coba unggah versi yang lebih ringkas.';
const ATTEMPT_MARK = /^attempt:(\d+)$/;
const MAX_ATTEMPTS = 3;

async function summarize(ai: KnowledgeAi | null, segments: Segment[], title: string, log: Log): Promise<string> {
  let head = '';
  for (const segment of segments) {
    if (head.length >= SUMMARY_INPUT_CHARS) break;
    head += `${head ? '\n\n' : ''}${segment.text}`;
  }
  head = head.slice(0, SUMMARY_INPUT_CHARS);
  if (ai?.summarize) {
    const summarizeWithAi = ai.summarize.bind(ai);
    try {
      const summary = await withTimeout(
        Promise.resolve().then(() => summarizeWithAi(head, title)),
        AI_TIMEOUT_MS,
      );
      if (summary?.trim()) return summary.trim().slice(0, SUMMARY_MAX_CHARS);
    } catch (err) {
      log.warn({ err }, 'knowledge summary failed, using excerpt');
    }
  }
  return excerpt(head);
}

/** Ekstrak teks satu dokumen, simpan potongannya, lalu tandai ready; kegagalan dicatat sebagai failed. */
async function processDocument(deps: AppDeps, doc: KbDocumentRow, log: Log): Promise<void> {
  const { db } = deps.database;
  try {
    if (doc.kind !== 'file' || !doc.storagePath) throw new ExtractError('Dokumen ini tidak punya berkas untuk diproses.');
    const data = await readFile(mediaAbsolutePath(deps.config, doc.storagePath)).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        throw new ExtractError('Berkas aslinya sudah tidak ada di server. Hapus dokumen ini lalu unggah ulang.');
      }
      throw err;
    });
    const ai = getKnowledgeAi();
    const extension = path.extname(doc.storagePath).slice(1).toLowerCase();
    const { segments, pageCount } = await extractDocument(data, extension, ai);
    const chunks = chunkSegments(segments);
    const charCount = segments.reduce((total, s) => total + s.text.length, 0);
    const summary = await summarize(ai, segments, doc.title, log);
    await db.transaction(async (tx) => {
      // Kunci barisnya; dokumen yang sudah dihapus permanen selama diproses dilewati.
      const [current] = await tx
        .select({ id: kbDocuments.id })
        .from(kbDocuments)
        .where(eq(kbDocuments.id, doc.id))
        .for('update');
      if (!current) return;
      await replaceChunks(tx, doc.id, chunks);
      await tx
        .update(kbDocuments)
        .set({ status: 'ready', error: null, pageCount, charCount, summary })
        .where(eq(kbDocuments.id, doc.id));
    });
  } catch (err) {
    if (!(err instanceof ExtractError)) log.warn({ err, documentId: doc.id }, 'knowledge processing failed');
    await markFailed(deps, doc.id, err instanceof ExtractError ? err.message : GENERIC_FAILURE);
  }
}

/** Tandai gagal dengan pesan untuk petugas; potongan lama dibuang supaya tidak ikut tercari. */
async function markFailed(deps: AppDeps, documentId: number, message: string): Promise<void> {
  await deps.database.db.transaction(async (tx) => {
    await tx.delete(kbChunks).where(eq(kbChunks.documentId, documentId));
    await tx.update(kbDocuments).set({ status: 'failed', error: message }).where(eq(kbDocuments.id, documentId));
  });
}

/**
 * Memproses dokumen Pustaka berstatus `processing` di proses yang sama dengan server, satu per satu.
 * Antreannya adalah status di database, jadi dokumen yang belum selesai saat server berhenti diproses
 * lagi begitu worker dijalankan. Setiap perubahan Pustaka (event library.updated) membangunkan worker.
 */
export class KnowledgeWorker {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private wakeRequested = false;
  private stopped = true;
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly deps: AppDeps,
    private readonly log: Log,
  ) {}

  start(): void {
    this.stopped = false;
    this.unsubscribe = this.deps.bus.on((e) => {
      if (e.type === 'library.updated' && e.resource === 'knowledge') this.kick();
    });
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    clearTimeout(this.timer);
    const deadline = Date.now() + STOP_WAIT_MS;
    while (this.running && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  }

  kick(): void {
    if (this.running) this.wakeRequested = true;
    else this.schedule(0);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    this.running = true;
    try {
      while (!this.stopped && (await this.runOnce()) > 0) {
        // terus selama masih ada dokumen yang menunggu
      }
    } catch (err) {
      this.log.error({ err }, 'knowledge worker error');
    } finally {
      this.running = false;
      const wake = this.wakeRequested;
      this.wakeRequested = false;
      this.schedule(wake ? 0 : POLL_MS);
    }
  }

  /** Proses satu dokumen yang menunggu (yang paling lama); mengembalikan jumlah yang diproses. Dipakai juga oleh test. */
  async runOnce(): Promise<number> {
    const [doc] = await this.deps.database.db
      .select()
      .from(kbDocuments)
      .where(eq(kbDocuments.status, 'processing'))
      .orderBy(asc(kbDocuments.id))
      .limit(1);
    if (!doc) return 0;
    const { db } = this.deps.database;
    // Selama status masih processing, kolom error menyimpan hitungan percobaan (tidak pernah dikirim ke
    // browser). Dokumen yang berkali-kali membuat proses terhenti di tengah jalan (mis. server kehabisan
    // memori lalu dihidupkan ulang) dihentikan di sini agar tidak menjatuhkan server terus-menerus.
    const attempts = Number(ATTEMPT_MARK.exec(doc.error ?? '')?.[1] ?? 0);
    if (attempts >= MAX_ATTEMPTS) {
      this.log.warn({ documentId: doc.id, attempts }, 'knowledge processing interrupted repeatedly');
      await markFailed(this.deps, doc.id, INTERRUPTED_FAILURE);
    } else {
      await db
        .update(kbDocuments)
        .set({ error: `attempt:${attempts + 1}` })
        .where(eq(kbDocuments.id, doc.id));
      await processDocument(this.deps, doc, this.log);
    }
    this.deps.bus.emit({ type: 'library.updated', resource: 'knowledge' });
    return 1;
  }

  /** Proses sampai tidak ada lagi dokumen yang menunggu; mengembalikan jumlah yang diproses. Untuk test. */
  async drain(): Promise<number> {
    let processed = 0;
    while ((await this.runOnce()) > 0) processed++;
    return processed;
  }
}
