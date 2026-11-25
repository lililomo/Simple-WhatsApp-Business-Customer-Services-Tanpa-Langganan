import { and, eq, inArray, lt } from 'drizzle-orm';
import { aiMessages, aiThreads } from '../../db/schema';
import type { AppDeps } from '../../types';
import { setKnowledgeAi } from '../knowledge/service';
import { closeOpenOffers } from './dto';
import { IMAGE_SYSTEM, SUMMARY_SYSTEM } from './prompts';
import { callClaude } from './providers';
import { runTriage, runtimeFor } from './service';
import { assistantReady } from './settings';

/** Jenis pesan yang tidak perlu dinilai sama sekali. */
const SKIP_TYPES = new Set(['reaction', 'sticker', 'unsupported', 'system']);
const OFFER_TTL_MS = 12 * 60 * 60_000;
const SWEEP_MS = 10 * 60_000;
const SUMMARY_INPUT_CHARS = 12_000;

export interface AssistantWorkerOptions {
  /** Jeda sebelum menilai pesan masuk; bawaan dari pengaturan (`triage.debounceSec`). Diisi 0 di test. */
  debounceMs?: number;
}

/**
 * Pekerjaan latar AOS di proses yang sama dengan server: menilai pesan WP yang baru masuk (deteksi awal),
 * merapikan tawaran yang kedaluwarsa, dan meminjamkan koneksi AI ke Pustaka (ringkasan dan membaca gambar).
 */
export class AssistantWorker {
  private unsubscribe: (() => void) | undefined;
  private sweeper: NodeJS.Timeout | undefined;
  private stopped = true;

  constructor(
    private readonly deps: AppDeps,
    private readonly options: AssistantWorkerOptions = {},
  ) {}

  start(): void {
    this.stopped = false;
    const runtime = runtimeFor(this.deps);
    this.unsubscribe = this.deps.bus.on((event) => {
      if (event.type !== 'message.created') return;
      const conversationId = Number(event.conversation.id);
      if (event.message.direction === 'out') {
        // Petugas sudah membalas sendiri: pesan yang menunggu dinilai tidak perlu lagi.
        if (event.message.sentBy?.type === 'user') this.clearTimer(conversationId);
        return;
      }
      if (SKIP_TYPES.has(event.message.type)) return;
      void this.schedule(conversationId).catch((err: unknown) => this.deps.log?.warn({ err }, 'aos: triage scheduling failed'));
    });
    this.sweeper = setInterval(() => void runtime.track(this.sweep()).catch(() => undefined), SWEEP_MS);
    this.sweeper.unref();
    void runtime.track(this.recover()).catch(() => undefined);

    setKnowledgeAi({
      summarize: (text, title) => this.summarize(text, title),
      readImage: (data, mimeType) => this.readImage(data, mimeType),
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe?.();
    if (this.sweeper) clearInterval(this.sweeper);
    setKnowledgeAi(null);
    const runtime = runtimeFor(this.deps);
    runtime.abortAll();
    await runtime.idle();
  }

  /** Untuk test: tunggu sampai semua penilaian dan jawaban yang sedang berjalan selesai. */
  async drain(): Promise<void> {
    const runtime = runtimeFor(this.deps);
    // Beri kesempatan penjadwalan (yang membaca pengaturan dulu) memasang timernya.
    for (let i = 0; i < 50 && (this.scheduling > 0 || runtime.triageTimers.size > 0); i++) await new Promise((r) => setTimeout(r, 10));
    await runtime.idle();
  }

  private scheduling = 0;

  private clearTimer(conversationId: number): void {
    const runtime = runtimeFor(this.deps);
    const timer = runtime.triageTimers.get(conversationId);
    if (timer) clearTimeout(timer);
    runtime.triageTimers.delete(conversationId);
  }

  private async schedule(conversationId: number): Promise<void> {
    this.scheduling++;
    try {
      const { ready, settings } = await assistantReady(this.deps);
      if (this.stopped || !ready || !settings.triage.enabled || settings.triage.mode === 'manual') return;
      const runtime = runtimeFor(this.deps);
      // WP sering mengirim beberapa pesan pendek berturut-turut: tunggu sampai berhenti, lalu nilai sekaligus.
      this.clearTimer(conversationId);
      const delay = this.options.debounceMs ?? settings.triage.debounceSec * 1000;
      runtime.triageTimers.set(
        conversationId,
        setTimeout(() => {
          runtime.triageTimers.delete(conversationId);
          this.triage(conversationId);
        }, delay),
      );
    } finally {
      this.scheduling--;
    }
  }

  private triage(conversationId: number): void {
    if (this.stopped) return;
    const runtime = runtimeFor(this.deps);
    if (runtime.triageRunning.has(conversationId)) {
      // Penilaian sebelumnya belum selesai: coba lagi sebentar lagi agar pesan terbaru ikut dinilai.
      runtime.triageTimers.set(
        conversationId,
        setTimeout(() => {
          runtime.triageTimers.delete(conversationId);
          this.triage(conversationId);
        }, 3_000),
      );
      return;
    }
    runtime.triageRunning.add(conversationId);
    void runtime
      .track(runTriage(this.deps, conversationId))
      .catch((err: unknown) => this.deps.log?.warn({ err: err instanceof Error ? err.message : err, conversationId }, 'aos: triage failed'))
      .finally(() => runtime.triageRunning.delete(conversationId));
  }

  /** Jawaban yang tertinggal "sedang disusun" karena aplikasi dimulai ulang tidak akan pernah selesai: tandai gagal. */
  private async recover(): Promise<void> {
    await this.deps.database.db
      .update(aiMessages)
      .set({ status: 'error', error: 'Terhenti karena aplikasi dimulai ulang. Silakan minta lagi.', completedAt: new Date() })
      .where(inArray(aiMessages.status, ['pending', 'running']));
  }

  /** Tawaran yang tidak ditanggapi lebih dari 12 jam ditutup agar tanda di daftar chat tidak menumpuk. */
  async sweep(now = new Date()): Promise<number> {
    const { db } = this.deps.database;
    const stale = await db
      .select({ thread: aiThreads })
      .from(aiMessages)
      .innerJoin(aiThreads, eq(aiThreads.id, aiMessages.threadId))
      .where(and(eq(aiMessages.kind, 'offer'), eq(aiMessages.offerState, 'open'), lt(aiMessages.createdAt, new Date(now.getTime() - OFFER_TTL_MS))));
    const seen = new Set<number>();
    for (const { thread } of stale) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      await closeOpenOffers(this.deps, thread, 'dismissed');
    }
    return seen.size;
  }

  private async summarize(text: string, title: string): Promise<string | null> {
    try {
      const { ready, settings } = await assistantReady(this.deps);
      if (!ready) return null;
      const outcome = await callClaude(
        this.deps,
        { purpose: 'summary' },
        {
          model: settings.triage.model,
          system: SUMMARY_SYSTEM,
          prompt: `<judul>${title}</judul>\n<isi>\n${text.slice(0, SUMMARY_INPUT_CHARS)}\n</isi>`,
          maxTurns: 2,
          timeoutMs: 60_000,
        },
      );
      return outcome.text.trim().slice(0, 600) || null;
    } catch (err) {
      this.deps.log?.warn({ err: err instanceof Error ? err.message : err }, 'aos: summary failed');
      return null;
    }
  }

  private async readImage(data: Buffer, mimeType: string): Promise<string | null> {
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return null;
    try {
      const { ready, settings } = await assistantReady(this.deps);
      if (!ready) return null;
      const outcome = await callClaude(
        this.deps,
        { purpose: 'image' },
        {
          model: settings.triage.model,
          system: IMAGE_SYSTEM,
          prompt: 'Salin isi gambar ini.',
          images: [{ mediaType: mimeType, data: data.toString('base64') }],
          maxTurns: 2,
          timeoutMs: 120_000,
        },
      );
      return outcome.text.trim() || null;
    } catch (err) {
      this.deps.log?.warn({ err: err instanceof Error ? err.message : err }, 'aos: image reading failed');
      return null;
    }
  }
}
