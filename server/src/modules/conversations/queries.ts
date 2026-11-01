import { and, desc, eq, exists, gt, isNotNull, like, lt, ne, or, sql } from 'drizzle-orm';
import type { ConversationFilter, ConversationPage, MessagePage } from '@wa/shared';
import type { Db } from '../../db/client';
import { contacts, conversations, messages } from '../../db/schema';
import { conversationDTO, messagesToDTO } from './dto';

// Cursor halaman berikutnya: "<lastMessageAt ms>_<id>".
function decodeCursor(cursor: string | undefined) {
  const m = cursor?.match(/^(\d+)_(\d+)$/);
  return m ? { at: new Date(Number(m[1])), id: Number(m[2]) } : null;
}

export async function listConversations(
  db: Db,
  opts: { filter: ConversationFilter; q?: string; cursor?: string; limit: number },
): Promise<ConversationPage> {
  const { filter, q, limit } = opts;
  const cursor = decodeCursor(opts.cursor);
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
}

/** Halaman pesan (reaksi disembunyikan), urut lama → baru; `before` = id pesan tertua yang sudah dimuat. */
export async function listMessages(db: Db, conversationId: number, before: number | undefined, limit: number): Promise<MessagePage> {
  const conds = [eq(messages.conversationId, conversationId), ne(messages.type, 'reaction')];
  if (before) conds.push(lt(messages.id, before));
  const rows = await db
    .select()
    .from(messages)
    .where(and(...conds))
    .orderBy(desc(messages.id))
    .limit(limit + 1);
  return { messages: await messagesToDTO(db, rows.slice(0, limit).reverse()), hasMore: rows.length > limit };
}
