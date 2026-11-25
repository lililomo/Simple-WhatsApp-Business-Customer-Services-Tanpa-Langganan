import type { AosProvider } from '@wa/shared';
import { aiCalls } from '../../db/schema';
import { AppError } from '../../lib/errors';
import type { AppDeps } from '../../types';
import { EngineError, runEngine, type EngineRequest, type EngineResult } from './engine';
import { loadCredentials, loadProviderState, loadSettings, monthApiCostUsd, patchProviderState } from './settings';

/** Untuk apa panggilan ini: masuk ke ai_calls.purpose dan laporan pemakaian. */
export type CallPurpose = 'answer' | 'triage' | 'summary' | 'image' | 'test' | 'playground';

export interface CallContext {
  purpose: CallPurpose;
  conversationId?: number | null;
  userId?: number | null;
  /** Dipaksa memakai satu jalur (uji koneksi); tanpa perpindahan. */
  only?: AosProvider;
  /** Diisi setelah hasil ada, mis. hasil deteksi awal untuk statistik topik. */
  meta?: (result: EngineResult) => Record<string, unknown> | null;
}

export interface CallOutcome extends EngineResult {
  provider: AosProvider;
  model: string;
  durationMs: number;
}

const LIMIT_COOLDOWN_MS = 15 * 60_000;
const OVERLOAD_COOLDOWN_MS = 60_000;
/** Tiap panggilan menjalankan satu proses Claude Code; dibatasi agar memori server tidak habis. */
const MAX_PARALLEL = 2;

class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const slots = new Semaphore(MAX_PARALLEL);

async function logCall(
  deps: AppDeps,
  ctx: CallContext,
  provider: AosProvider,
  model: string,
  durationMs: number,
  result: EngineResult | null,
  error: string | null,
) {
  try {
    await deps.database.db.insert(aiCalls).values({
      purpose: ctx.purpose,
      conversationId: ctx.conversationId ?? null,
      userId: ctx.userId ?? null,
      provider,
      model,
      ok: !!result,
      error: error?.slice(0, 500) ?? null,
      inputTokens: result?.inputTokens ?? 0,
      outputTokens: result?.outputTokens ?? 0,
      costMicroUsd: Math.round((result?.costUsd ?? 0) * 1_000_000),
      durationMs,
      meta: result ? (ctx.meta?.(result) ?? null) : null,
    });
  } catch (err) {
    deps.log?.warn({ err }, 'aos: failed to record call');
  }
}

/**
 * Memanggil Claude lewat jalur sesuai urutan yang diatur admin. Bila jalur utama kena batas pemakaian, saldo habis,
 * layanan penuh, atau kredensialnya ditolak, permintaan yang sama diulang di jalur berikutnya. Galat lain (model
 * salah, dibatalkan, waktu habis) tidak memicu perpindahan karena jalur lain akan gagal dengan cara yang sama.
 */
export async function callClaude(deps: AppDeps, ctx: CallContext, request: EngineRequest): Promise<CallOutcome> {
  const [settings, credentials, state] = await Promise.all([loadSettings(deps), loadCredentials(deps), loadProviderState(deps)]);
  const connected = (ctx.only ? [ctx.only] : settings.order).filter((p) => !!credentials[p]);
  if (connected.length === 0) {
    throw new AppError(409, 'aos_not_connected', 'AOS belum terhubung ke Claude. Minta admin menghubungkannya di Pengaturan › Asisten AI.');
  }

  let candidates = connected;
  let budgetHit = false;
  if (!ctx.only) {
    if (settings.budget.monthlyUsd > 0 && candidates.includes('api') && (await monthApiCostUsd(deps)) >= settings.budget.monthlyUsd) {
      candidates = candidates.filter((p) => p !== 'api');
      budgetHit = true;
    }
    const now = Date.now();
    const rested = candidates.filter((p) => !(state[p].state === 'cooldown' && state[p].cooldownUntil && new Date(state[p].cooldownUntil!).getTime() > now));
    // Bila semua jalur sedang diistirahatkan, tetap dicoba sesuai urutan: batasnya mungkin sudah pulih lebih cepat.
    if (rested.length > 0) candidates = rested;
  }
  if (candidates.length === 0) {
    throw new AppError(
      409,
      budgetHit ? 'aos_budget' : 'aos_not_connected',
      budgetHit ? 'Anggaran jalur API bulan ini sudah habis. Admin bisa menaikkannya di Pengaturan › Asisten AI.' : 'AOS belum terhubung ke Claude.',
    );
  }

  const engine = deps.aosEngine ?? runEngine;
  let lastError: EngineError | undefined;
  for (const provider of candidates) {
    const started = Date.now();
    try {
      const result = await slots.run(() => {
        // Pembatalan bisa datang selagi menunggu giliran; listener pada sinyal yang sudah batal tidak pernah terpanggil.
        if (request.signal?.aborted) throw new EngineError('cancelled', 'Dibatalkan.');
        return engine(deps, { provider, secret: credentials[provider]! }, request);
      });
      const durationMs = Date.now() - started;
      await logCall(deps, ctx, provider, request.model, durationMs, result, null);
      await patchProviderState(deps, provider, { state: 'ok', cooldownUntil: null, lastError: null, lastUsedAt: new Date().toISOString() }).catch(() => undefined);
      return { ...result, provider, model: request.model, durationMs };
    } catch (err) {
      const error = err instanceof EngineError ? err : new EngineError('other', err instanceof Error ? err.message.slice(0, 300) : 'Gagal memanggil Claude.');
      if (error.kind === 'cancelled') throw error;
      await logCall(deps, ctx, provider, request.model, Date.now() - started, null, error.message);
      lastError = error;
      const at = new Date().toISOString();
      if (error.kind === 'limit' || error.kind === 'billing') {
        const until = error.resetsAt && error.resetsAt.getTime() > Date.now() ? error.resetsAt : new Date(Date.now() + LIMIT_COOLDOWN_MS);
        await patchProviderState(deps, provider, { state: 'cooldown', cooldownUntil: until.toISOString(), lastError: error.message, lastUsedAt: at });
      } else if (error.kind === 'overloaded') {
        await patchProviderState(deps, provider, {
          state: 'cooldown',
          cooldownUntil: new Date(Date.now() + OVERLOAD_COOLDOWN_MS).toISOString(),
          lastError: error.message,
          lastUsedAt: at,
        });
      } else if (error.kind === 'auth') {
        await patchProviderState(deps, provider, { state: 'rejected', cooldownUntil: null, lastError: error.message, lastUsedAt: at });
      } else {
        // Bukan masalah jalur: jangan pindah.
        await patchProviderState(deps, provider, { lastError: error.message, lastUsedAt: at });
        throw error;
      }
      deps.bus.emit({ type: 'library.updated', resource: 'assistant' });
      deps.log?.warn({ provider, kind: error.kind }, 'aos: provider failed, trying next');
    }
  }
  throw lastError ?? new EngineError('other', 'Gagal memanggil Claude.');
}
