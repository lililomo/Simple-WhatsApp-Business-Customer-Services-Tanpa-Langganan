import { and, eq } from 'drizzle-orm';
import { messagePreview, windowRemainingMs, type MessageDTO } from '@wa/shared';
import { contacts, conversations, messages } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import { GraphError } from '../../meta/graph-client';
import type { AppDeps } from '../../types';
import { audit } from '../audit/service';
import { accountGraph, noteTokenError, requireAccount } from '../connection/service';
import { loadConversation, loadMessage } from '../conversations/dto';

export interface Actor {
  userId?: number;
  apiKeyId?: number;
  /** Pengirim otomatis aplikasi, mis. 'auto_reply'. */
  system?: string;
  ip?: string;
}

/** Pesan keluar yang sudah dibentuk: isi untuk disimpan + body Graph (tanpa to/context). */
export interface OutboundSpec {
  type: string;
  text: string | null;
  mediaId?: number | null;
  fileName?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  graph: Record<string, unknown>;
  /** Pesan bebas hanya boleh dikirim di dalam jendela layanan 24 jam; template boleh kapan saja. */
  requiresWindow: boolean;
}

export interface SendResult {
  message: MessageDTO;
  /** Terisi bila Meta menolak; pesan tetap tersimpan dengan status failed. */
  error: AppError | null;
}

export const windowClosed = () =>
  new AppError(422, 'window_closed', 'Jendela 24 jam sudah tertutup. Kirim template untuk menghubungi kontak ini.');

export async function sendToConversation(
  deps: AppDeps,
  conversationId: number,
  spec: OutboundSpec,
  actor: Actor,
  opts: { clientRef?: string | null; replyToMessageId?: number | null } = {},
): Promise<SendResult> {
  const { db } = deps.database;
  const [row] = await db
    .select({ conv: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw notFound('Percakapan');
  await requireAccount(deps);

  if (opts.clientRef) {
    // Klik ganda / kirim ulang dengan clientRef yang sama tidak boleh mengirim dua kali.
    const [dup] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.clientRef, opts.clientRef)))
      .limit(1);
    if (dup) return { message: (await loadMessage(db, dup.id))!, error: null };
  }
  if (spec.requiresWindow && windowRemainingMs(row.conv.cswExpiresAt?.toISOString() ?? null) <= 0) throw windowClosed();

  let replyToWamid: string | null = null;
  if (opts.replyToMessageId) {
    const [target] = await db
      .select({ wamid: messages.wamid })
      .from(messages)
      .where(and(eq(messages.id, opts.replyToMessageId), eq(messages.conversationId, conversationId)))
      .limit(1);
    if (!target?.wamid) throw new AppError(400, 'reply_target_invalid', 'Pesan yang dibalas tidak ditemukan.');
    replyToWamid = target.wamid;
  }

  const graphBody = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: row.contact.waId,
    ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
    ...spec.graph,
  };
  const now = new Date();
  const [res] = await db.insert(messages).values({
    conversationId,
    direction: 'out',
    type: spec.type,
    status: 'pending',
    text: spec.text,
    payload: graphBody,
    mediaId: spec.mediaId ?? null,
    replyToWamid,
    templateName: spec.templateName ?? null,
    templateLanguage: spec.templateLanguage ?? null,
    sentByUserId: actor.userId ?? null,
    sentByApiKeyId: actor.apiKeyId ?? null,
    sentBySystem: actor.system ?? null,
    clientRef: opts.clientRef ?? null,
    waTimestamp: now,
  });
  const messageId = res.insertId;
  await db
    .update(conversations)
    .set({
      lastMessageId: messageId,
      lastMessageAt: now,
      lastMessagePreview: messagePreview(spec.type, spec.text, { fileName: spec.fileName }).slice(0, 200),
      lastMessageDirection: 'out',
    })
    .where(eq(conversations.id, conversationId));

  const [created, conv] = await Promise.all([loadMessage(db, messageId), loadConversation(db, conversationId)]);
  deps.bus.emit({ type: 'message.created', message: created!, conversation: conv! });

  const error = await deliver(deps, messageId, graphBody);
  await audit(db, {
    actorUserId: actor.userId,
    actorApiKeyId: actor.apiKeyId,
    action: 'message.send',
    targetType: 'message',
    targetId: messageId,
    meta: { conversationId, type: spec.type, template: spec.templateName ?? undefined, failed: !!error },
    ip: actor.ip,
  });
  return { message: (await loadMessage(db, messageId))!, error };
}

/**
 * Kirim body ke Graph satu kali (tidak pernah di-retry otomatis) dan catat hasilnya.
 * Status sent/delivered/read datang kemudian lewat webhook.
 */
async function deliver(deps: AppDeps, messageId: number, graphBody: Record<string, unknown>): Promise<AppError | null> {
  const { db } = deps.database;
  const account = await requireAccount(deps);
  let error: AppError | null = null;
  try {
    const res = await accountGraph(deps, account).post<{ messages?: { id: string }[] }>(`${account.phoneNumberId}/messages`, graphBody);
    const wamid = res.messages?.[0]?.id ?? null;
    await db
      .update(messages)
      .set({ wamid, status: 'accepted', errorCode: null, errorTitle: null, errorDetail: null, failedAt: null })
      .where(eq(messages.id, messageId));
  } catch (err) {
    await noteTokenError(deps, account, err);
    const g = err instanceof GraphError ? err : null;
    await db
      .update(messages)
      .set({
        status: 'failed',
        failedAt: new Date(),
        errorCode: g?.code ?? null,
        errorTitle: g?.title?.slice(0, 255) ?? (err instanceof Error ? err.message.slice(0, 255) : 'Gagal mengirim'),
        errorDetail: g?.details ?? null,
      })
      .where(eq(messages.id, messageId));
    error = new AppError(g && g.httpStatus >= 400 && g.httpStatus < 500 ? 422 : 502, 'meta_error', g?.message ?? 'Gagal mengirim ke Meta.', {
      metaCode: g?.code,
      fbtraceId: g?.fbtraceId,
    });
  }
  const dto = await loadMessage(db, messageId);
  if (dto) deps.bus.emit({ type: 'message.updated', message: dto });
  return error;
}

/** Kirim ulang pesan keluar yang gagal, memakai body Graph yang sama. */
export async function retryMessage(deps: AppDeps, messageId: number, actor: Actor): Promise<SendResult> {
  const { db } = deps.database;
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) throw notFound('Pesan');
  if (msg.direction !== 'out' || msg.status !== 'failed' || !msg.payload) {
    throw new AppError(400, 'not_retryable', 'Hanya pesan keluar yang gagal yang bisa dikirim ulang.');
  }
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, msg.conversationId)).limit(1);
  if (msg.type !== 'template' && windowRemainingMs(conv?.cswExpiresAt?.toISOString() ?? null) <= 0) throw windowClosed();

  await db.update(messages).set({ status: 'pending' }).where(eq(messages.id, msg.id));
  const error = await deliver(deps, msg.id, msg.payload);
  await audit(db, { actorUserId: actor.userId, actorApiKeyId: actor.apiKeyId, action: 'message.retry', targetType: 'message', targetId: msg.id, ip: actor.ip });
  return { message: (await loadMessage(db, msg.id))!, error };
}
