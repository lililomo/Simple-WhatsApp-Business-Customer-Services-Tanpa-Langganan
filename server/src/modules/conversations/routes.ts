import { and, desc, eq, exists, gt, like, lt, ne, or, sql, isNotNull } from 'drizzle-orm';
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
import { conversationDTO, loadConversation, messagesToDTO } from './dto';

const idParams = z.object({ id: z.coerce.number().int().positive() });

// Cursor halaman berikutnya: "<lastMessageAt ms>_<id>".
function decodeCursor(cursor: string | undefined) {
  const m = cursor?.match(/^(\d+)_(\d+)$/);
  return m ? { at: new Date(Number(m[1])), id: Number(m[2]) } : null;
}

export async function conversationRoutes(app: AppInstance) {
  const deps = app.deps;
  const { db } = deps.database;
  app.addHook('preHandler', requireUserHook);

  app.get('/', { schema: { querystring: listConversationsQuery } }, async (req): Promise<ConversationPage> => {
    const { filter, q, limit } = req.query;
    const cursor = decodeCursor(req.query.cursor);
    const conds = [isNotNull(conversations.lastMessageAt)];
    if (filter === 'unread') conds.push(gt(conversations.unreadCount, 0));
    if (filter === 'open') conds.push(gt(conversations.cswExpiresAt, new Date()));
    if (q) {
      const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const digits = q.replace(/\D/g, '');
      // Nomor diketik "08…" tetapi disimpan WhatsApp sebagai "628…".
      const numberVariants = digits.length >= 3 ? [digits, ...(digits.startsWith('0') ? [`62${digits.slice(1)}`] : [])] : [];
      conds.push(
        or(
          like(contacts.displayName, pattern),
          like(contacts.profileName, pattern),
          ...numberVariants.map((d) => like(contacts.waId, `%${d}%`)),
          exists(
            db
              .select({ one: sql`1` })
              .from(messages)
              .where(and(eq(messages.conversationId, conversations.id), like(messages.text, pattern))),
          ),
        )!,
      );
    }
    if (cursor) {
      conds.push(
        or(
          lt(conversations.lastMessageAt, cursor.at),
          and(eq(conversations.lastMessageAt, cursor.at), lt(conversations.id, cursor.id)),
        )!,
      );
    }
    const rows = await db
      .select({ conv: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .where(and(...conds))
      .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      conversations: page.map((r) => conversationDTO(r.conv, r.contact)),
      nextCursor: rows.length > limit && last ? `${last.conv.lastMessageAt!.getTime()}_${last.conv.id}` : null,
    };
  });

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

  app.get('/:id/messages', { schema: { params: idParams, querystring: listMessagesQuery } }, async (req): Promise<MessagePage> => {
    const { before, limit } = req.query;
    const conds = [eq(messages.conversationId, req.params.id), ne(messages.type, 'reaction')];
    if (before) conds.push(lt(messages.id, before));
    const rows = await db
      .select()
      .from(messages)
      .where(and(...conds))
      .orderBy(desc(messages.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit).reverse();
    return { messages: await messagesToDTO(db, page), hasMore: rows.length > limit };
  });

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
  app.addHook('preHandler', requireUserHook);

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
