import { and, eq, lt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  apiSendMessageBody,
  listConversationsQuery,
  listMessagesQuery,
  normalizePhone,
  type ApiScope,
  type ApiSendMessageBody,
} from '@wa/shared';
import { contacts, conversations, idempotencyKeys, media, messages, templates } from '../../db/schema';
import { sha256Hex } from '../../lib/crypto';
import { AppError, isDuplicateKey, notFound } from '../../lib/errors';
import type { AppDeps, AppInstance } from '../../types';
import { apiKeys } from '../../db/schema';
import { findActiveKey } from '../api-keys/service';
import { requireAccount } from '../connection/service';
import { contactDTO, loadMessage, mediaDTO } from '../conversations/dto';
import { listConversations, listMessages } from '../conversations/queries';
import { replyWithMedia } from '../media/routes';
import { uploadOutboundMedia } from '../media/service';
import { mediaSpec, textSpec } from '../messages/build';
import { sendToConversation, windowClosed, type OutboundSpec } from '../messages/service';
import { upsertContact, upsertConversation } from '../processor/handlers';
import { listTemplates, templateSpec } from '../templates/service';

declare module 'fastify' {
  interface FastifyRequest {
    apiKey: { id: number; name: string; scopes: string[] } | null;
  }
}

const idParams = z.object({ id: z.coerce.number().int().positive() });
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function requireScope(scope: ApiScope) {
  return async (req: FastifyRequest) => {
    if (!req.apiKey!.scopes.includes(scope)) {
      throw new AppError(403, 'insufficient_scope', `API key ini tidak punya izin "${scope}".`);
    }
  };
}

/** REST API untuk sistem lain. Autentikasi: header Authorization: Bearer wai_… */
export async function apiV1Routes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;

  app.decorateRequest('apiKey', null);
  app.addHook('onRequest', async (req) => {
    const match = (req.headers.authorization ?? '').match(/^Bearer\s+(\S+)$/i);
    const row = match ? await findActiveKey(db, match[1]!) : undefined;
    if (!row) throw new AppError(401, 'invalid_api_key', 'API key tidak valid atau sudah dicabut.');
    req.apiKey = { id: row.id, name: row.name, scopes: row.scopes };
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    }
  });

  const rateLimit = {
    max: deps.config.API_RATE_LIMIT_PER_MIN,
    timeWindow: 60_000,
    keyGenerator: (req: FastifyRequest) => `api-key:${req.apiKey?.id ?? req.ip}`,
  };
  const opts = <S extends Record<string, unknown>>(scope: ApiScope, schema: S, summary: string) => ({
    preValidation: requireScope(scope),
    config: { rateLimit },
    schema: { tags: ['API v1'], summary, security: [{ bearerAuth: [] }], ...schema },
  });

  app.post(
    '/messages',
    opts('messages:send', { body: apiSendMessageBody, headers: z.object({ 'idempotency-key': z.string().max(128).optional() }) }, 'Kirim pesan'),
    async (req, reply) =>
      withIdempotency(deps, req.apiKey!.id, req.headers['idempotency-key'], req.body, reply, () => apiSend(deps, req, req.body)),
  );

  app.get('/messages/:id', opts('messages:read', { params: idParams }, 'Detail & status pesan'), async (req) => {
    const message = await loadMessage(db, req.params.id);
    if (!message) throw notFound('Pesan');
    return { data: message };
  });

  app.get('/conversations', opts('conversations:read', { querystring: listConversationsQuery }, 'Daftar percakapan'), async (req) => {
    const page = await listConversations(db, req.query);
    return { data: page.conversations, nextCursor: page.nextCursor };
  });

  app.get(
    '/conversations/:id/messages',
    opts('messages:read', { params: idParams, querystring: listMessagesQuery }, 'Pesan dalam percakapan (lama → baru)'),
    async (req) => {
      const page = await listMessages(db, req.params.id, req.query.before, req.query.limit);
      return { data: page.messages, hasMore: page.hasMore };
    },
  );

  app.get(
    '/contacts/:waId',
    opts('conversations:read', { params: z.object({ waId: z.string() }) }, 'Kontak berdasarkan nomor'),
    async (req) => {
      const waId = normalizePhone(req.params.waId);
      const [contact] = waId ? await db.select().from(contacts).where(eq(contacts.waId, waId)).limit(1) : [];
      if (!contact) throw notFound('Kontak');
      const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, contact.id)).limit(1);
      return { data: { ...contactDTO(contact), conversationId: conv ? String(conv.id) : null } };
    },
  );

  app.get(
    '/templates',
    opts('templates:read', { querystring: z.object({ status: z.string().optional() }) }, 'Daftar template'),
    async (req) => ({ data: await listTemplates(deps, req.query.status) }),
  );

  app.post('/media', opts('media:write', {}, 'Unggah media (multipart, field "file")'), async (req, reply) => {
    const file = await req.file().catch(() => undefined);
    if (!file) throw new AppError(400, 'file_required', 'Field "file" wajib diisi.');
    const row = await uploadOutboundMedia(deps, await requireAccount(deps), {
      data: await file.toBuffer(),
      mime: file.mimetype,
      fileName: file.filename || 'lampiran',
    });
    return reply.status(201).send({ data: { mediaId: String(row.id), ...mediaDTO(row) } });
  });

  app.get('/media/:id', opts('messages:read', { params: idParams }, 'Unduh media'), async (req, reply) => {
    const [row] = await db.select().from(media).where(eq(media.id, req.params.id)).limit(1);
    if (!row) throw notFound('Media');
    return replyWithMedia(deps, reply, row, true);
  });
}

async function apiSend(deps: AppDeps, req: FastifyRequest, body: ApiSendMessageBody): Promise<{ status: number; body: unknown }> {
  const { db } = deps.database;
  const waId = normalizePhone(body.to);
  if (!waId) throw new AppError(400, 'invalid_phone', 'Nomor tujuan tidak valid.');
  const account = await requireAccount(deps);

  let spec: OutboundSpec;
  if (body.type === 'text') {
    spec = textSpec(body.text!);
  } else if (body.type === 'template') {
    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.waAccountId, account.id), eq(templates.name, body.template!.name), eq(templates.language, body.template!.language)))
      .limit(1);
    if (!row) throw new AppError(404, 'template_not_found', `Template "${body.template!.name}" (${body.template!.language}) tidak ditemukan. Sinkronkan template dulu.`);
    spec = await templateSpec(deps, row, body.template!.params);
  } else if (body.media?.mediaId) {
    spec = await mediaSpec(deps, Number(body.media.mediaId), body.media.caption);
    if (spec.type !== body.type) throw new AppError(400, 'media_type_mismatch', `Media yang diunggah berjenis ${spec.type}, bukan ${body.type}.`);
  } else {
    const kind = body.type;
    const caption = kind === 'audio' ? undefined : body.media!.caption;
    spec = {
      type: kind,
      text: caption ?? null,
      fileName: body.media!.filename ?? null,
      graph: {
        type: kind,
        [kind]: { link: body.media!.link, ...(caption ? { caption } : {}), ...(kind === 'document' && body.media!.filename ? { filename: body.media!.filename } : {}) },
      },
      requiresWindow: true,
    };
  }

  // Tolak pesan bebas ke nomor tanpa jendela terbuka sebelum membuat kontak/percakapan baru.
  if (spec.requiresWindow) {
    const [existing] = await db
      .select({ csw: conversations.cswExpiresAt })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(eq(contacts.waId, waId), eq(conversations.waAccountId, account.id)))
      .limit(1);
    if (!existing?.csw || existing.csw.getTime() <= Date.now()) throw windowClosed();
  }
  const contact = await upsertContact(deps, waId, null, null);
  const conv = await upsertConversation(deps, account.id, contact.id);
  let replyToMessageId: number | null = null;
  if (body.replyTo) {
    const where = /^\d+$/.test(body.replyTo) ? eq(messages.id, Number(body.replyTo)) : eq(messages.wamid, body.replyTo);
    const [target] = await db.select({ id: messages.id }).from(messages).where(where).limit(1);
    replyToMessageId = target?.id ?? null;
  }
  const result = await sendToConversation(deps, conv.id, spec, { apiKeyId: req.apiKey!.id, ip: req.ip }, { replyToMessageId });
  if (result.error) {
    return {
      status: result.error.statusCode,
      body: { error: { code: result.error.code, message: result.error.message, details: { ...result.error.details, messageId: result.message.id } } },
    };
  }
  return {
    status: 202,
    body: {
      data: {
        id: result.message.id,
        wamid: result.message.wamid,
        status: result.message.status,
        conversationId: String(conv.id),
        clientRef: body.clientRef ?? null,
      },
    },
  };
}

/**
 * Idempotency-Key: permintaan ulang dengan key + body yang sama mengembalikan respons tersimpan (24 jam),
 * body berbeda → 409. Placeholder disimpan lebih dulu agar dua permintaan bersamaan tidak sama-sama mengirim.
 */
async function withIdempotency(
  deps: AppDeps,
  apiKeyId: number,
  key: string | undefined,
  body: unknown,
  reply: FastifyReply,
  run: () => Promise<{ status: number; body: unknown }>,
) {
  if (!key) {
    const r = await run();
    return reply.status(r.status).send(r.body);
  }
  const { db } = deps.database;
  const hash = sha256Hex(JSON.stringify(body));
  await db
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.apiKeyId, apiKeyId), eq(idempotencyKeys.idemKey, key), lt(idempotencyKeys.createdAt, new Date(Date.now() - IDEMPOTENCY_TTL_MS))));
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.apiKeyId, apiKeyId), eq(idempotencyKeys.idemKey, key)))
    .limit(1);
  if (existing) {
    if (existing.requestHash !== hash) throw new AppError(409, 'idempotency_conflict', 'Idempotency-Key ini sudah dipakai untuk permintaan yang berbeda.');
    if (existing.responseStatus === 0) throw new AppError(409, 'idempotency_in_progress', 'Permintaan dengan Idempotency-Key ini sedang diproses.');
    return reply.status(existing.responseStatus).header('idempotent-replayed', 'true').send(existing.response);
  }
  try {
    await db.insert(idempotencyKeys).values({ apiKeyId, idemKey: key, requestHash: hash, responseStatus: 0, response: {} });
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new AppError(409, 'idempotency_in_progress', 'Permintaan dengan Idempotency-Key ini sedang diproses.');
    }
    throw err;
  }
  let result: { status: number; body: unknown };
  try {
    result = await run();
  } catch (err) {
    if (!(err instanceof AppError)) {
      await db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.apiKeyId, apiKeyId), eq(idempotencyKeys.idemKey, key)));
      throw err;
    }
    result = { status: err.statusCode, body: { error: { code: err.code, message: err.message, details: err.details } } };
  }
  await db
    .update(idempotencyKeys)
    .set({ responseStatus: result.status, response: result.body })
    .where(and(eq(idempotencyKeys.apiKeyId, apiKeyId), eq(idempotencyKeys.idemKey, key)));
  return reply.status(result.status).send(result.body);
}
