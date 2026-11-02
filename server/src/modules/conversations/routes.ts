import { and, count, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  listConversationsQuery,
  listMessagesQuery,
  type ConversationPage,
  type InboxSummary,
  type MessagePage,
  updateContactBody,
} from '@wa/shared';
import { contactLabels, contacts, conversations, labels, messages } from '../../db/schema';
import { notFound } from '../../lib/errors';
import type { AppDeps, AppInstance } from '../../types';
import { requireUserHook } from '../auth/plugin';
import { accountGraph, getAccount } from '../connection/service';
import { loadConversation } from './dto';
import { listConversations, listMessages } from './queries';

const idParams = z.object({ id: z.coerce.number().int().positive() });
const labelParams = idParams.extend({ labelId: z.coerce.number().int().positive() });

/** Kirim ulang percakapan milik kontak ini ke semua browser (nama atau label kontak berubah). */
async function emitContactConversations(deps: AppDeps, contactId: number) {
  const { db } = deps.database;
  const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, contactId));
  for (const c of convs) {
    const dto = await loadConversation(db, c.id);
    if (dto) deps.bus.emit({ type: 'conversation.updated', conversation: dto });
  }
}

/**
 * Jumlah "belum dibaca" saat petugas menandai percakapan belum dibaca: pesan masuk sejak balasan terakhir kita
 * (balasan otomatis dan pesan gagal tidak dihitung sebagai balasan), atau sejak awal bila belum pernah dibalas.
 * Minimal 1 agar percakapan tetap tampil sebagai belum dibaca walaupun pesan terakhir dari kita.
 */
export async function unreadSinceLastReply(deps: AppDeps, conversationId: number): Promise<number> {
  const { db } = deps.database;
  const [lastReply] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'out'),
        isNull(messages.sentBySystem),
        ne(messages.status, 'failed'),
      ),
    )
    .orderBy(desc(messages.id))
    .limit(1);
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'in'),
        ne(messages.type, 'reaction'),
        lastReply ? gt(messages.id, lastReply.id) : undefined,
      ),
    );
  return Math.max(1, Number(row?.n ?? 0));
}

export async function conversationRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);

  app.get('/', { schema: { querystring: listConversationsQuery } }, async (req): Promise<ConversationPage> =>
    listConversations(db, req.query),
  );

  app.get('/summary', async (): Promise<InboxSummary> => {
    const [row] = await db
      .select({
        unreadConversations: sql<number>`COUNT(*)`,
        unreadMessages: sql<number>`COALESCE(SUM(${conversations.unreadCount}), 0)`,
      })
      .from(conversations)
      .where(gt(conversations.unreadCount, 0));
    return { unreadConversations: Number(row?.unreadConversations ?? 0), unreadMessages: Number(row?.unreadMessages ?? 0) };
  });

  app.get('/:id', { schema: { params: idParams } }, async (req) => {
    const conversation = await loadConversation(db, req.params.id);
    if (!conversation) throw notFound('Percakapan');
    return { conversation };
  });

  app.get('/:id/messages', { schema: { params: idParams, querystring: listMessagesQuery } }, async (req): Promise<MessagePage> =>
    listMessages(db, req.params.id, req.query.before, req.query.limit),
  );

  app.post('/:id/read', { schema: { params: idParams } }, async (req) => {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, req.params.id)).limit(1);
    if (!conv) throw notFound('Percakapan');
    if (conv.unreadCount === 0) return { ok: true };

    await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conv.id));
    const dto = await loadConversation(db, conv.id);
    if (dto) deps.bus.emit({ type: 'conversation.updated', conversation: dto });

    // Centang biru untuk pesan masuk terakhir (WhatsApp menandai pesan sebelumnya ikut terbaca).
    if (deps.config.SEND_READ_RECEIPTS) {
      const [lastIn] = await db
        .select({ wamid: messages.wamid })
        .from(messages)
        .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'in'), ne(messages.type, 'reaction')))
        .orderBy(desc(messages.id))
        .limit(1);
      const account = await getAccount(deps);
      if (lastIn?.wamid && account) {
        await accountGraph(deps, account)
          .post(`${account.phoneNumberId}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: lastIn.wamid })
          .catch((err) => req.log.warn({ err }, 'read receipt failed'));
      }
    }
    return { ok: true };
  });

  app.post('/:id/unread', { schema: { params: idParams } }, async (req) => {
    const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, req.params.id)).limit(1);
    if (!conv) throw notFound('Percakapan');
    await db
      .update(conversations)
      .set({ unreadCount: await unreadSinceLastReply(deps, conv.id) })
      .where(eq(conversations.id, conv.id));
    const dto = await loadConversation(db, conv.id);
    if (dto) deps.bus.emit({ type: 'conversation.updated', conversation: dto });
    return { conversation: dto };
  });

  // Label menempel ke kontak (lawan chat), bukan ke percakapan; percakapan hanya jalan pintas dari UI.
  const contactOf = async (conversationId: number, labelId: number) => {
    const [conv] = await db.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    if (!conv) throw notFound('Percakapan');
    const [label] = await db.select({ id: labels.id }).from(labels).where(eq(labels.id, labelId)).limit(1);
    if (!label) throw notFound('Label');
    return conv.contactId;
  };

  app.put('/:id/labels/:labelId', { schema: { params: labelParams } }, async (req) => {
    const contactId = await contactOf(req.params.id, req.params.labelId);
    await db
      .insert(contactLabels)
      .values({ contactId, labelId: req.params.labelId, createdBy: req.user?.id ?? null })
      .onDuplicateKeyUpdate({ set: { contactId: sql`${contactLabels.contactId}` } });
    await emitContactConversations(deps, contactId);
    return { conversation: await loadConversation(db, req.params.id) };
  });

  app.delete('/:id/labels/:labelId', { schema: { params: labelParams } }, async (req) => {
    const contactId = await contactOf(req.params.id, req.params.labelId);
    await db.delete(contactLabels).where(and(eq(contactLabels.contactId, contactId), eq(contactLabels.labelId, req.params.labelId)));
    await emitContactConversations(deps, contactId);
    return { conversation: await loadConversation(db, req.params.id) };
  });
}

export async function contactRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preValidation', requireUserHook);

  app.patch(
    '/:id',
    { schema: { params: idParams, body: updateContactBody } },
    async (req) => {
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, req.params.id)).limit(1);
      if (!contact) throw notFound('Kontak');
      await db
        .update(contacts)
        .set({ displayName: req.body.displayName || null })
        .where(eq(contacts.id, contact.id));
      await emitContactConversations(deps, contact.id);
      const [conv] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, contact.id)).limit(1);
      const dto = conv ? await loadConversation(db, conv.id) : null;
      return { contact: dto?.contact ?? null };
    },
  );
}
