import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  aosAskBody,
  aosFeedbackBody,
  aosPlaygroundBody,
  aosProvider,
  aosSaveBody,
  assistantSettings,
  credentialBody,
  maskSensitive,
  parseAosAnswer,
  TEXT_MAX,
  type AosConnectionTestDTO,
  type AosPlaygroundDTO,
  type AosThreadDTO,
} from '@wa/shared';
import { aiMessages, conversations, quickReplies } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { audit } from '../audit/service';
import { requireAdminHook, requireUser, requireUserHook } from '../auth/plugin';
import { createNote, knowledgeCatalog } from '../knowledge/service';
import { closeOpenOffers, emitAiMessage, loadAiMessage, threadDTO, type AiMessageData } from './dto';
import { EngineError } from './engine';
import { DEFAULT_DRAFT_INSTRUCTION, answerSystemPrompt, answerUserPrompt } from './prompts';
import { callClaude } from './providers';
import { ask, cancelAnswer, resetThread, resolveSources } from './service';
import { loadCredentials, loadSettings, removeCredential, saveSettings, setCredential, settingsDTO, statusDTO } from './settings';
import { computeUsage } from './usage';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const providerParams = z.object({ provider: aosProvider });
const usageQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

const PROVIDER_NAME = { subscription: 'Langganan Claude', api: 'API Claude' } as const;

/** Pengaturan, koneksi, dan tindakan pada pesan sesi AOS. Lihat SPEC §19.5. */
export async function assistantRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);
  const changed = () => deps.bus.emit({ type: 'library.updated', resource: 'assistant' });
  const admin = { preValidation: requireAdminHook };

  app.get('/status', async () => statusDTO(deps));

  app.get('/settings', admin, async () => settingsDTO(deps));

  app.put('/settings', { ...admin, schema: { body: assistantSettings } }, async (req) => {
    requireUser(req);
    await saveSettings(deps, req.body, req.user.id);
    await audit(db, {
      actorUserId: req.user.id,
      action: 'assistant.settings',
      meta: { enabled: req.body.enabled, order: req.body.order, model: req.body.answer.model, effort: req.body.answer.effort, mode: req.body.triage.mode },
      ip: req.ip,
    });
    changed();
    return settingsDTO(deps);
  });

  app.put('/credentials/:provider', { ...admin, schema: { params: providerParams, body: credentialBody } }, async (req) => {
    requireUser(req);
    const { provider } = req.params;
    const secret = req.body.secret.replace(/\s+/g, '');
    // Salah tempel adalah kesalahan yang paling sering; pesan yang jelas lebih berguna daripada "ditolak" saat diuji.
    if (provider === 'api' && secret.startsWith('sk-ant-oat')) {
      throw new AppError(400, 'aos_wrong_secret', 'Itu token langganan, bukan kunci API. Tempel di kartu Langganan Claude.');
    }
    if (provider === 'subscription' && secret.startsWith('sk-ant-api')) {
      throw new AppError(400, 'aos_wrong_secret', 'Itu kunci API, bukan token langganan. Tempel di kartu API Claude.');
    }
    await setCredential(deps, provider, secret, req.user.id);
    // Rahasianya sendiri tidak pernah masuk log audit.
    await audit(db, { actorUserId: req.user.id, action: 'assistant.credential.set', targetType: 'assistant_provider', targetId: provider, ip: req.ip });
    changed();
    return settingsDTO(deps);
  });

  app.delete('/credentials/:provider', { ...admin, schema: { params: providerParams } }, async (req) => {
    requireUser(req);
    await removeCredential(deps, req.params.provider, req.user.id);
    await audit(db, {
      actorUserId: req.user.id,
      action: 'assistant.credential.remove',
      targetType: 'assistant_provider',
      targetId: req.params.provider,
      ip: req.ip,
    });
    changed();
    return settingsDTO(deps);
  });

  app.post('/credentials/:provider/test', { ...admin, schema: { params: providerParams } }, async (req): Promise<AosConnectionTestDTO> => {
    requireUser(req);
    const { provider } = req.params;
    const [settings, credentials] = await Promise.all([loadSettings(deps), loadCredentials(deps)]);
    if (!credentials[provider]) throw new AppError(409, 'aos_not_connected', `${PROVIDER_NAME[provider]} belum dihubungkan.`);
    const started = Date.now();
    try {
      // Diuji dengan model jawaban agar sekaligus ketahuan bila model itu tidak tersedia di jalur ini.
      const outcome = await callClaude(
        deps,
        { purpose: 'test', userId: req.user.id, only: provider },
        {
          model: settings.answer.model,
          effort: 'low',
          system: 'Kamu sedang diuji koneksinya. Balas persis dengan satu kata: siap',
          prompt: 'Uji koneksi.',
          maxTurns: 1,
          timeoutMs: 90_000,
        },
      );
      changed();
      return {
        ok: true,
        provider,
        model: outcome.model,
        message: `Terhubung. Model ${outcome.model} menjawab dalam ${(outcome.durationMs / 1000).toFixed(1).replace('.', ',')} detik.`,
        durationMs: outcome.durationMs,
      };
    } catch (err) {
      changed();
      const message = err instanceof EngineError || err instanceof AppError ? err.message : 'Gagal menghubungi Claude.';
      return { ok: false, provider, model: settings.answer.model, message, durationMs: Date.now() - started };
    }
  });

  app.get('/usage', { ...admin, schema: { querystring: usageQuery } }, async (req) => computeUsage(deps, req.query.month));

  app.post('/playground', { ...admin, schema: { body: aosPlaygroundBody } }, async (req): Promise<AosPlaygroundDTO> => {
    requireUser(req);
    const settings = await loadSettings(deps);
    const catalog = settings.sources.library ? await knowledgeCatalog(deps, 40) : [];
    try {
      const outcome = await callClaude(
        deps,
        { purpose: 'playground', userId: req.user.id },
        {
          model: settings.answer.model,
          effort: settings.answer.effort,
          system: answerSystemPrompt(settings, catalog),
          prompt: answerUserPrompt({
            contactName: 'WP (uji coba)',
            transcript: `[baru saja] WP: ${req.body.text}`,
            history: '',
            instruction: DEFAULT_DRAFT_INSTRUCTION,
            imageCount: 0,
          }),
          web: settings.sources.web ? { domains: settings.sources.domains, maxSearches: settings.sources.maxSearches } : null,
          library: settings.sources.library,
          timeoutMs: 5 * 60_000,
        },
      );
      const parsed = parseAosAnswer(outcome.text);
      return {
        text: outcome.text,
        answer: {
          draft: parsed.draft,
          notes: parsed.notes,
          confidence: parsed.draft ? parsed.confidence : null,
          sources: resolveSources(parsed.sourceLines, outcome, settings),
        },
        provider: outcome.provider,
        model: outcome.model,
        durationMs: outcome.durationMs,
      };
    } catch (err) {
      if (err instanceof EngineError) throw new AppError(502, 'aos_failed', err.message);
      throw err;
    }
  });

  /* ---------- Tindakan pada satu pesan sesi ---------- */

  const answerOf = async (id: number) => {
    const found = await loadAiMessage(db, id);
    if (!found || found.row.kind !== 'answer' || found.row.status !== 'done') throw notFound('Jawaban');
    return found;
  };

  app.post('/messages/:id/cancel', { schema: { params: idParams } }, async (req) => ({ message: await cancelAnswer(deps, req.params.id) }));

  app.post('/messages/:id/dismiss', { schema: { params: idParams } }, async (req) => {
    const found = await loadAiMessage(db, req.params.id);
    if (!found || found.row.kind !== 'offer') throw notFound('Tawaran');
    if (found.row.offerState === 'open') await closeOpenOffers(deps, found.thread, 'dismissed');
    return { message: await emitAiMessage(deps, found.row.id) };
  });

  app.post('/messages/:id/feedback', { schema: { params: idParams, body: aosFeedbackBody } }, async (req) => {
    requireUser(req);
    const found = await answerOf(req.params.id);
    await db
      .update(aiMessages)
      .set({ feedback: req.body.value, feedbackBy: req.body.value === null ? null : req.user.id })
      .where(eq(aiMessages.id, found.row.id));
    return { message: await emitAiMessage(deps, found.row.id) };
  });

  // Dipanggil saat petugas menekan "Pakai": dasar hitungan seberapa sering saran AOS benar-benar dipakai.
  app.post('/messages/:id/used', { schema: { params: idParams } }, async (req) => {
    requireUser(req);
    const found = await answerOf(req.params.id);
    if (!found.row.usedAt) await db.update(aiMessages).set({ usedAt: new Date(), usedBy: req.user.id }).where(eq(aiMessages.id, found.row.id));
    await closeOpenOffers(deps, found.thread, 'answered');
    return { message: await emitAiMessage(deps, found.row.id) };
  });

  // Bank Jawaban: draf yang bagus disimpan ke Pustaka (dipakai AOS lagi) atau dijadikan balasan cepat.
  app.post('/messages/:id/save', { schema: { params: idParams, body: aosSaveBody } }, async (req) => {
    requireUser(req);
    const found = await answerOf(req.params.id);
    const data = (found.row.data ?? {}) as AiMessageData;
    const draft = data.answer?.draft;
    if (!draft) throw new AppError(400, 'aos_no_draft', 'Jawaban itu tidak memuat draf balasan.');
    // Yang disimpan dipakai ulang untuk WP lain, jadi data pribadi WP ini tidak boleh ikut.
    const clean = maskSensitive(draft).text;

    if (req.body.target === 'library') {
      if (found.row.savedDocumentId) throw new AppError(409, 'aos_saved', 'Jawaban ini sudah disimpan ke Pustaka.');
      const sources = (data.answer?.sources ?? []).map((s) => (s.type === 'web' ? s.url : `Pustaka: ${s.title}${s.page ? ` hlm ${s.page}` : ''}`));
      const text = [
        `Contoh jawaban yang pernah dipakai petugas untuk: ${req.body.title}`,
        clean,
        data.answer?.notes ? `Catatan: ${maskSensitive(data.answer.notes).text}` : '',
        sources.length ? `Sumber: ${sources.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const doc = await createNote(deps, { title: req.body.title, text, tags: ['bank jawaban'] }, req.user.id);
      await db
        .update(aiMessages)
        .set({ savedDocumentId: Number(doc.id) })
        .where(eq(aiMessages.id, found.row.id));
      await audit(db, { actorUserId: req.user.id, action: 'assistant.save_library', targetType: 'kb_document', targetId: doc.id, ip: req.ip });
      deps.bus.emit({ type: 'library.updated', resource: 'knowledge' });
    } else {
      const [res] = await db
        .insert(quickReplies)
        .values({ title: req.body.title, shortcut: null, body: clean.slice(0, TEXT_MAX), createdBy: req.user.id, updatedBy: req.user.id });
      await audit(db, { actorUserId: req.user.id, action: 'quick_reply.create', targetType: 'quick_reply', targetId: res.insertId, meta: { from: 'aos' }, ip: req.ip });
      deps.bus.emit({ type: 'library.updated', resource: 'quick-replies' });
    }
    return { message: await emitAiMessage(deps, found.row.id) };
  });
}

/** Sesi AOS per percakapan (per nomor WhatsApp), dipakai bersama semua petugas. */
export async function assistantConversationRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);

  const exists = async (id: number) => {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, id)))
      .limit(1);
    if (!row) throw notFound('Percakapan');
  };

  app.get('/:id/assistant', { schema: { params: idParams } }, async (req): Promise<AosThreadDTO> => {
    await exists(req.params.id);
    return threadDTO(db, req.params.id);
  });

  app.post('/:id/assistant/messages', { schema: { params: idParams, body: aosAskBody } }, async (req, reply) => {
    requireUser(req);
    const created = await ask(deps, req.params.id, req.user, req.body);
    return reply.status(202).send({ messages: created });
  });

  app.post('/:id/assistant/reset', { schema: { params: idParams } }, async (req): Promise<AosThreadDTO> => {
    requireUser(req);
    await resetThread(deps, req.params.id);
    await audit(db, { actorUserId: req.user.id, action: 'assistant.reset', targetType: 'conversation', targetId: req.params.id, ip: req.ip });
    return threadDTO(db, req.params.id);
  });
}
