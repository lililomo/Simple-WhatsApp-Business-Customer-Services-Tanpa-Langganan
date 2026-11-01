import { and, desc, eq, gt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  listConversationsQuery,
  listMessagesQuery,
  type ConversationPage,
  type InboxSummary,
  type MessagePage,
  updateContactBody,
} from '@wa/shared';
import { contacts, conversations, messages } from '../../db/schema';
import { notFound } from '../../lib/errors';
import type { AppInstance } from '../../types';
import { requireUserHook } from '../auth/plugin';
import { accountGraph, getAccount } from '../connection/service';
import { loadConversation } from './dto';
import { listConversations, listMessages } from './queries';

const idParams = z.object({ id: z.coerce.number().int().positive() });

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
      const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, contact.id));
      for (const c of convs) {
        const dto = await loadConversation(db, c.id);
        if (dto) deps.bus.emit({ type: 'conversation.updated', conversation: dto });
      }
      const dto = convs[0] ? await loadConversation(db, convs[0].id) : null;
      return { contact: dto?.contact ?? null };
    },
  );
}
