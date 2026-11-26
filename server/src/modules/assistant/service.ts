import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';
import {
  draftPartsForWhatsApp,
  parseAosAnswer,
  sanitizeInfographic,
  unmaskSensitive,
  type AosAnswer,
  type AosAskBody,
  type AosMessageDTO,
  type AosOption,
  type AosSource,
  type AssistantSettings,
} from '@wa/shared';
import { aiMessages, aiThreads, contactLabels, conversations, labels, messages } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import type { AppDeps, SessionUser } from '../../types';
import { knowledgeCatalog } from '../knowledge/service';
import { buildChatContext, buildThreadHistory, masker } from './context';
import {
  closeOpenOffers,
  emitAiMessage,
  emitConversation,
  ensureThread,
  getThread,
  loadAiMessage,
  type AiMessageData,
  type AiThreadRow,
} from './dto';
import { EngineError } from './engine';
import {
  ACTION_LABEL,
  DEFAULT_DRAFT_INSTRUCTION,
  EXPLAIN_INSTRUCTION,
  SUMMARIZE_INSTRUCTION,
  TRIAGE_CATEGORIES,
  answerSystemPrompt,
  answerUserPrompt,
  friendlierInstruction,
  regenerateInstruction,
  infographicInstruction,
  shortenInstruction,
  triageSystemPrompt,
  triageUserPrompt,
  type TriageResult,
} from './prompts';
import { callClaude, type CallOutcome } from './providers';
import { assistantReady, loadSettings } from './settings';

/** Keadaan yang hanya hidup di proses ini: pekerjaan yang sedang berjalan dan penunda deteksi awal. */
export class AssistantRuntime {
  /** Jawaban yang sedang disusun: id pesan jawaban → pembatal. */
  readonly jobs = new Map<number, { abort: AbortController; conversationId: number }>();
  readonly triageTimers = new Map<number, NodeJS.Timeout>();
  readonly triageRunning = new Set<number>();
  /** Pesan WP terakhir yang sudah dinilai per percakapan, agar tidak dinilai dua kali. */
  readonly lastTriaged = new Map<number, number>();
  private readonly background = new Set<Promise<unknown>>();

  track<T>(work: Promise<T>): Promise<T> {
    this.background.add(work);
    void work.finally(() => this.background.delete(work)).catch(() => undefined);
    return work;
  }

  /** Menunggu semua pekerjaan latar selesai (dipakai test dan saat aplikasi berhenti). */
  async idle(): Promise<void> {
    while (this.background.size > 0) await Promise.allSettled([...this.background]);
  }

  abortAll(): void {
    for (const timer of this.triageTimers.values()) clearTimeout(timer);
    this.triageTimers.clear();
    for (const job of this.jobs.values()) job.abort.abort();
  }
}

const runtimes = new WeakMap<AppDeps, AssistantRuntime>();

export function runtimeFor(deps: AppDeps): AssistantRuntime {
  let runtime = runtimes.get(deps);
  if (!runtime) {
    runtime = new AssistantRuntime();
    runtimes.set(deps, runtime);
  }
  return runtime;
}

const ANSWER_TIMEOUT_MS = 5 * 60_000;
const TRIAGE_TIMEOUT_MS = 60_000;
const MAX_STEPS = 12;
const DELTA_INTERVAL_MS = 120;

const hostAllowed = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * Sumber yang ditulis model disaring: dokumen Pustaka harus benar-benar dicari/dibaca lewat alat pada jawaban ini,
 * dan alamat web harus berada di daftar situs yang diizinkan. Sumber yang tidak lolos dibuang.
 */
export function resolveSources(lines: string[], outcome: Pick<CallOutcome, 'libraryDocs'>, settings: AssistantSettings): AosSource[] {
  const out: AosSource[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const url = /https?:\/\/[^\s<>"')\]]+/i.exec(line)?.[0].replace(/[.,;]+$/, '');
    if (url) {
      if (!URL.canParse(url)) continue;
      const host = new URL(url).hostname.toLowerCase();
      if (!hostAllowed(host, settings.sources.domains) || seen.has(url)) continue;
      seen.add(url);
      out.push({ type: 'web', title: host.replace(/^www\./, ''), url });
      continue;
    }
    const lib = /\bP\s?(\d+)\b(?:\D{0,12}?(?:hlm|hal|halaman)\.?\s*(\d+))?/i.exec(line);
    if (!lib) continue;
    const id = Number(lib[1]);
    const title = outcome.libraryDocs.get(id);
    const page = lib[2] ? Number(lib[2]) : null;
    const key = `P${id}:${page ?? ''}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ type: 'library', title, documentId: String(id), page });
  }
  return out.slice(0, 8);
}

interface AnswerJob {
  messageId: number;
  conversationId: number;
  thread: AiThreadRow;
  userId: number | null;
  instruction: string;
}

function errorText(err: unknown): string {
  if (err instanceof AppError || err instanceof EngineError) return err.message;
  return 'AOS gagal menyiapkan jawaban. Coba lagi.';
}

async function runAnswer(deps: AppDeps, job: AnswerJob): Promise<void> {
  const { db } = deps.database;
  const runtime = runtimeFor(deps);
  const started = Date.now();
  const abort = new AbortController();
  runtime.jobs.set(job.messageId, { abort, conversationId: job.conversationId });
  const steps: string[] = [];
  let timer: NodeJS.Timeout | undefined;
  try {
    // Bila sudah dibatalkan sebelum sempat mulai, statusnya bukan lagi pending.
    const [claimed] = await db.update(aiMessages).set({ status: 'running' }).where(and(eq(aiMessages.id, job.messageId), eq(aiMessages.status, 'pending')));
    if (claimed.affectedRows === 0) return;
    await emitAiMessage(deps, job.messageId);

    const settings = await loadSettings(deps);
    const ctx = await buildChatContext(deps, job.conversationId, settings, { since: job.thread.topicStartedAt, withImages: true });
    if (!ctx) throw notFound('Percakapan');
    const hide = masker(settings, ctx.mask);
    const history = await buildThreadHistory(deps, job.thread.id, job.thread.topicStartedAt, job.messageId, hide);
    const catalog = settings.sources.library ? await knowledgeCatalog(deps, 40) : [];

    let live = '';
    const flush = () => {
      timer = undefined;
      deps.bus.emit({
        type: 'assistant.delta',
        conversationId: String(job.conversationId),
        messageId: String(job.messageId),
        text: unmaskSensitive(live, ctx.mask),
        steps: [...steps],
      });
    };
    const schedule = () => {
      timer ??= setTimeout(flush, DELTA_INTERVAL_MS);
    };

    const outcome = await callClaude(
      deps,
      { purpose: 'answer', conversationId: job.conversationId, userId: job.userId },
      {
        model: settings.answer.model,
        effort: settings.answer.effort,
        system: answerSystemPrompt(settings, catalog),
        prompt: answerUserPrompt({
          contactName: hide(ctx.contactName),
          transcript: ctx.transcript,
          history,
          instruction: hide(job.instruction),
          imageCount: ctx.images.length,
        }),
        images: ctx.images,
        web: settings.sources.web ? { domains: settings.sources.domains, maxSearches: settings.sources.maxSearches } : null,
        library: settings.sources.library,
        signal: abort.signal,
        timeoutMs: ANSWER_TIMEOUT_MS,
        onText: (text) => {
          live = text;
          schedule();
        },
        onStep: (label) => {
          if (steps.at(-1) !== label && steps.length < MAX_STEPS) steps.push(label);
          schedule();
        },
      },
    );

    const text = unmaskSensitive(outcome.text, ctx.mask).trim();
    if (!text) throw new EngineError('other', 'AOS tidak menghasilkan jawaban. Coba lagi.');
    const parsed = parseAosAnswer(text);
    const answer: AosAnswer = {
      draft: parsed.draft,
      notes: parsed.notes,
      confidence: parsed.draft ? parsed.confidence : null,
      sources: resolveSources(parsed.sourceLines, outcome, settings),
      infographic: sanitizeInfographic(parsed.infographic),
    };
    // Setiap bagian muat dalam satu pesan WhatsApp; bagian disimpan hanya bila lebih dari satu.
    const parts = draftPartsForWhatsApp(parsed.draftParts);
    if (parts.length > 1) answer.parts = parts;
    const data: AiMessageData = { instruction: job.instruction, steps, answer };
    await db
      .update(aiMessages)
      .set({
        status: 'done',
        text,
        data,
        provider: outcome.provider,
        model: outcome.model,
        durationMs: Date.now() - started,
        triggerMessageId: ctx.lastInboundId,
        completedAt: new Date(),
      })
      .where(eq(aiMessages.id, job.messageId));
  } catch (err) {
    const cancelled = err instanceof EngineError && err.kind === 'cancelled';
    if (!cancelled && !(err instanceof AppError) && !(err instanceof EngineError)) deps.log?.error({ err }, 'aos: answer failed');
    await db
      .update(aiMessages)
      .set({
        status: cancelled ? 'cancelled' : 'error',
        error: cancelled ? null : errorText(err),
        data: { instruction: job.instruction, steps } satisfies AiMessageData,
        durationMs: Date.now() - started,
        completedAt: new Date(),
      })
      .where(eq(aiMessages.id, job.messageId))
      .catch(() => undefined);
  } finally {
    if (timer) clearTimeout(timer);
    runtime.jobs.delete(job.messageId);
    await emitAiMessage(deps, job.messageId).catch(() => undefined);
  }
}

function startAnswer(deps: AppDeps, job: AnswerJob): void {
  void runtimeFor(deps).track(runAnswer(deps, job));
}

async function insertMessage(deps: AppDeps, values: typeof aiMessages.$inferInsert): Promise<number> {
  const [res] = await deps.database.db.insert(aiMessages).values(values);
  return res.insertId;
}

async function requireReady(deps: AppDeps): Promise<AssistantSettings> {
  const { ready, settings } = await assistantReady(deps);
  if (!ready) throw new AppError(409, 'aos_off', 'AOS belum aktif. Minta admin menyalakannya di Pengaturan › Asisten AI.');
  return settings;
}

async function requireConversation(deps: AppDeps, conversationId: number): Promise<{ id: number; contactId: number }> {
  const [conv] = await deps.database.db
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) throw notFound('Percakapan');
  return conv;
}

/** Permintaan petugas ke AOS: pertanyaan bebas, pilihan dari tawaran, atau tindakan cepat. Jawabannya disusun di latar. */
export async function ask(deps: AppDeps, conversationId: number, user: SessionUser, body: AosAskBody): Promise<AosMessageDTO[]> {
  const { db } = deps.database;
  await requireReady(deps);
  const conv = await requireConversation(deps, conversationId);
  const thread = await ensureThread(db, conversationId);

  let label: string;
  let instruction: string;

  if (body.offerId !== undefined && body.optionIndex !== undefined) {
    const found = await loadAiMessage(db, Number(body.offerId));
    if (!found || found.thread.id !== thread.id || found.row.kind !== 'offer') throw notFound('Tawaran');
    if (found.row.offerState !== 'open') throw new AppError(409, 'aos_offer_closed', 'Tawaran ini sudah ditutup.');
    const data = (found.row.data ?? {}) as AiMessageData;
    const options = data.options ?? [];
    const option = options[body.optionIndex];
    if (!option) throw new AppError(400, 'aos_option', 'Pilihan itu tidak ada di tawaran ini.');

    if (option.labelId) {
      // Pilihan "pasang label": tempel label ke kontak, lalu pilihan itu hilang dari tawaran.
      const labelId = Number(option.labelId);
      const [exists] = await db.select({ id: labels.id }).from(labels).where(eq(labels.id, labelId)).limit(1);
      if (exists) {
        await db
          .insert(contactLabels)
          .values({ contactId: conv.contactId, labelId, createdBy: user.id })
          .onDuplicateKeyUpdate({ set: { labelId } });
      }
      const remaining = options.filter((_, i) => i !== body.optionIndex);
      await db
        .update(aiMessages)
        .set({ data: { ...data, options: remaining } })
        .where(eq(aiMessages.id, found.row.id));
      if (remaining.length === 0) await closeOpenOffers(deps, thread, 'answered', { emitConversation: false });
      await emitConversation(deps, conversationId);
      const dto = await emitAiMessage(deps, found.row.id);
      return dto ? [dto] : [];
    }
    label = option.label;
    instruction = option.instruction.trim() || DEFAULT_DRAFT_INSTRUCTION;
  } else if (body.action) {
    label = ACTION_LABEL[body.action];
    if (body.action === 'summarize') instruction = SUMMARIZE_INSTRUCTION;
    else if (body.action === 'explain') instruction = EXPLAIN_INSTRUCTION;
    else if (body.action === 'infographic' && !body.targetId) instruction = infographicInstruction(null);
    else {
      if (!body.targetId) throw new AppError(400, 'aos_target', 'Pilih dulu jawaban yang ingin diubah.');
      const target = await loadAiMessage(db, Number(body.targetId));
      if (!target || target.thread.id !== thread.id || target.row.kind !== 'answer' || target.row.status !== 'done') throw notFound('Jawaban');
      const data = (target.row.data ?? {}) as AiMessageData;
      // Jawaban berupa teks biasa (tanpa draf) juga boleh diperpendek, diperhalus, atau dijadikan infografis.
      const draft = data.answer?.draft ?? parseAosAnswer(target.row.text ?? '').plain ?? null;
      if (body.action === 'regenerate') instruction = regenerateInstruction(data.instruction ?? DEFAULT_DRAFT_INSTRUCTION, draft);
      else if (body.action === 'infographic') {
        const basis = draft;
        if (!basis) throw new AppError(400, 'aos_no_draft', 'Jawaban itu tidak memuat isi yang bisa dijadikan infografis.');
        instruction = infographicInstruction(basis);
      } else {
        if (!draft) throw new AppError(400, 'aos_no_draft', 'Jawaban itu tidak memuat teks yang bisa diubah.');
        instruction = body.action === 'shorten' ? shortenInstruction(draft) : friendlierInstruction(draft);
      }
    }
  } else if (body.text) {
    label = body.text;
    instruction = body.text;
  } else {
    throw new AppError(400, 'aos_empty', 'Isi pertanyaan, pilih salah satu tawaran, atau pilih tindakan.');
  }

  const [busy] = await db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, thread.id), eq(aiMessages.kind, 'answer'), inArray(aiMessages.status, ['pending', 'running'])))
    .limit(1);
  if (busy) throw new AppError(409, 'aos_busy', 'AOS masih menyiapkan jawaban sebelumnya. Tunggu sebentar atau batalkan dulu.');

  // Petugas sudah menanggapi: tawaran yang masih terbuka dianggap terjawab.
  await closeOpenOffers(deps, thread, 'answered');

  const userMessageId = await insertMessage(deps, { threadId: thread.id, kind: 'user', status: 'done', text: label, createdByUserId: user.id });
  const answerId = await insertMessage(deps, {
    threadId: thread.id,
    kind: 'answer',
    status: 'pending',
    data: { instruction, steps: [] } satisfies AiMessageData,
  });
  const dtos = [await emitAiMessage(deps, userMessageId), await emitAiMessage(deps, answerId)].filter((d): d is AosMessageDTO => d !== null);
  startAnswer(deps, { messageId: answerId, conversationId, thread, userId: user.id, instruction });
  return dtos;
}

/** Batalkan jawaban yang sedang disusun. */
export async function cancelAnswer(deps: AppDeps, messageId: number): Promise<AosMessageDTO> {
  const { db } = deps.database;
  const found = await loadAiMessage(db, messageId);
  if (!found || found.row.kind !== 'answer') throw notFound('Jawaban');
  const job = runtimeFor(deps).jobs.get(messageId);
  if (job) job.abort.abort();
  // Belum sempat berjalan (atau prosesnya sudah tidak ada): tandai langsung.
  await db
    .update(aiMessages)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(and(eq(aiMessages.id, messageId), job ? eq(aiMessages.status, 'pending') : inArray(aiMessages.status, ['pending', 'running'])));
  return (await emitAiMessage(deps, messageId))!;
}

/** "Topik baru": AOS melupakan sesi dan pesan WhatsApp sebelum saat ini. */
export async function resetThread(deps: AppDeps, conversationId: number): Promise<void> {
  const { db } = deps.database;
  await requireConversation(deps, conversationId);
  const thread = await ensureThread(db, conversationId);
  const runtime = runtimeFor(deps);
  for (const [, job] of runtime.jobs) if (job.conversationId === conversationId) job.abort.abort();
  await closeOpenOffers(deps, thread, 'dismissed');
  await db
    .update(aiMessages)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(and(eq(aiMessages.threadId, thread.id), eq(aiMessages.status, 'pending')));
  await db.update(aiThreads).set({ topicStartedAt: new Date() }).where(eq(aiThreads.id, thread.id));
  runtime.lastTriaged.delete(conversationId);
  deps.bus.emit({ type: 'assistant.thread', conversationId: String(conversationId) });
}

/* ---------- Deteksi awal ---------- */

/** Hasil deteksi awal ditulis model sebagai satu objek JSON; teks di sekitarnya (bila ada) diabaikan. */
export function parseTriage(text: string): TriageResult | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<TriageResult>;
  if (r.tindakan !== 'diam' && r.tindakan !== 'tawarkan' && r.tindakan !== 'jawab') return null;
  const opsi = Array.isArray(r.opsi)
    ? r.opsi
        .filter((o): o is { label: string; instruksi: string } => !!o && typeof o.label === 'string' && typeof o.instruksi === 'string' && !!o.label.trim())
        .slice(0, 3)
    : [];
  return {
    kategori: TRIAGE_CATEGORIES.includes(r.kategori as never) ? r.kategori! : 'lainnya',
    tindakan: r.tindakan,
    ringkasan: typeof r.ringkasan === 'string' ? r.ringkasan.trim() : '',
    opsi,
    topik: typeof r.topik === 'string' ? r.topik.trim().toLowerCase().slice(0, 60) : '',
    label: typeof r.label === 'string' && r.label.trim() ? r.label.trim() : null,
    sensitif: r.sensitif === true,
    butuh_data_internal: r.butuh_data_internal === true,
  };
}

/**
 * Menilai pesan WP yang baru masuk: diam, tawarkan bantuan, atau (mode Otomatis) langsung siapkan rekomendasi.
 * Dipanggil AssistantWorker setelah jeda `triage.debounceSec`.
 */
export async function runTriage(deps: AppDeps, conversationId: number): Promise<void> {
  const { db } = deps.database;
  const runtime = runtimeFor(deps);
  const { ready, settings } = await assistantReady(deps);
  if (!ready || !settings.triage.enabled || settings.triage.mode === 'manual') return;

  const existing = await getThread(db, conversationId);
  const ctx = await buildChatContext(deps, conversationId, settings, { since: existing?.topicStartedAt ?? null, limit: 14, markNew: true });
  if (!ctx || ctx.newInbound === 0 || ctx.lastInboundId === null) return;
  if (runtime.lastTriaged.get(conversationId) === ctx.lastInboundId) return;
  runtime.lastTriaged.set(conversationId, ctx.lastInboundId);

  const [allLabels, attached] = await Promise.all([
    db.select({ id: labels.id, name: labels.name }).from(labels),
    db.select({ labelId: contactLabels.labelId }).from(contactLabels).where(eq(contactLabels.contactId, ctx.contactId)),
  ]);

  const outcome = await callClaude(
    deps,
    {
      purpose: 'triage',
      conversationId,
      meta: (result) => {
        const t = parseTriage(result.text);
        return t ? { kategori: t.kategori, tindakan: t.tindakan, topik: t.topik, sensitif: t.sensitif, butuhDataInternal: t.butuh_data_internal } : null;
      },
    },
    {
      model: settings.triage.model,
      system: triageSystemPrompt(allLabels.map((l) => l.name)),
      prompt: triageUserPrompt(ctx.transcript, ctx.newInbound),
      maxTurns: 2,
      timeoutMs: TRIAGE_TIMEOUT_MS,
    },
  );
  const triage = parseTriage(outcome.text);
  if (!triage || triage.tindakan === 'diam') return;

  // Petugas sudah membalas selagi dinilai: tawaran tidak lagi berguna.
  const [replied] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, 'out'), isNull(messages.sentBySystem), gt(messages.id, ctx.lastInboundId)))
    .orderBy(desc(messages.id))
    .limit(1);
  if (replied) return;

  const options: AosOption[] = triage.opsi.map((o, i) => ({
    label: unmaskSensitive(o.label, ctx.mask).slice(0, 48),
    instruction: unmaskSensitive(o.instruksi, ctx.mask).slice(0, 600),
    primary: i === 0,
  }));
  if (options.length === 0) options.push({ label: 'Buatkan draf jawaban', instruction: DEFAULT_DRAFT_INSTRUCTION, primary: true });

  const suggested = triage.label ? allLabels.find((l) => l.name.toLowerCase() === triage.label!.toLowerCase()) : undefined;
  const labelOption: AosOption | null =
    suggested && !attached.some((a) => a.labelId === suggested.id)
      ? { label: `Pasang label ${suggested.name}`, instruction: '', labelId: String(suggested.id) }
      : null;

  const auto = settings.triage.mode === 'auto' && triage.tindakan === 'jawab';
  const summary = unmaskSensitive(triage.ringkasan, ctx.mask) || 'WP menanyakan sesuatu yang mungkin perlu dicek dulu.';
  const hints = [triage.butuh_data_internal ? 'Sepertinya perlu dicek di sistem DJP.' : '', triage.sensitif ? 'Perlu kehati-hatian dalam membalas.' : ''].filter(Boolean);
  const text = [summary, ...hints, auto ? 'Saya siapkan rekomendasinya di bawah.' : 'Mau saya bantu?'].join(' ');

  const first = options[0]!;
  const shown = [...(auto ? options.slice(1).map((o, i) => ({ ...o, primary: i === 0 })) : options), ...(labelOption ? [labelOption] : [])];

  const thread = await ensureThread(db, conversationId);
  await closeOpenOffers(deps, thread, 'dismissed', { emitConversation: false });
  const offerId = await insertMessage(deps, {
    threadId: thread.id,
    kind: 'offer',
    status: 'done',
    text,
    offerState: 'open',
    triggerMessageId: ctx.lastInboundId,
    data: {
      options: shown,
      triage: { kategori: triage.kategori, tindakan: triage.tindakan, topik: triage.topik, sensitif: triage.sensitif },
    } satisfies AiMessageData,
    provider: outcome.provider,
    model: outcome.model,
    durationMs: outcome.durationMs,
  });
  await db.update(conversations).set({ aosOfferMessageId: offerId }).where(eq(conversations.id, conversationId));
  await emitAiMessage(deps, offerId);
  await emitConversation(deps, conversationId);

  if (auto) {
    const answerId = await insertMessage(deps, {
      threadId: thread.id,
      kind: 'answer',
      status: 'pending',
      triggerMessageId: ctx.lastInboundId,
      data: { instruction: first.instruction, steps: [] } satisfies AiMessageData,
    });
    await emitAiMessage(deps, answerId);
    startAnswer(deps, { messageId: answerId, conversationId, thread, userId: null, instruction: first.instruction });
  }
}
