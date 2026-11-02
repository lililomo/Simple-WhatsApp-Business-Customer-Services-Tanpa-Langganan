import { and, desc, eq, exists, gt, isNotNull, like, lt, ne, or, sql } from 'drizzle-orm';
import type { ConversationFilter, ConversationPage, MessagePage } from '@wa/shared';
import type { Db } from '../../db/client';
import { contactLabels, contacts, conversations, messages } from '../../db/schema';
import { labelsByContact } from '../labels/service';
import { conversationDTO, messagesToDTO } from './dto';

// Cursor halaman berikutnya: "<lastMessageAt ms>_<id>".
function decodeCursor(cursor: string | undefined) {
  const m = cursor?.match(/^(\d+)_(\d+)$/);
  return m ? { at: new Date(Number(m[1])), id: Number(m[2]) } : null;
}

/**
 * Ubah teks pencarian menjadi query FULLTEXT boolean: setiap kata ≥ 3 huruf wajib ada, cocok sebagai awalan.
 * Kata lebih pendek diabaikan karena tidak diindeks InnoDB (innodb_ft_min_token_size = 3).
 */
export function fulltextQuery(q: string): string | null {
  const terms = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  return terms.length ? terms.map((t) => `+${t}*`).join(' ') : null;
}

export async function listConversations(
  db: Db,
  opts: { filter: ConversationFilter; q?: string; label?: number; cursor?: string; limit: number },
): Promise<ConversationPage> {
  const { filter, q, label, limit } = opts;
  const cursor = decodeCursor(opts.cursor);
  const conds = [isNotNull(conversations.lastMessageAt)];
  if (filter === 'unread') conds.push(gt(conversations.unreadCount, 0));
  if (filter === 'open') conds.push(gt(conversations.cswExpiresAt, new Date()));
  if (label) {
    conds.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(contactLabels)
          .where(and(eq(contactLabels.contactId, conversations.contactId), eq(contactLabels.labelId, label))),
      ),
    );
  }
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = q.replace(/\D/g, '');
    // Nomor diketik "08…" tetapi disimpan WhatsApp sebagai "628…".
    const numberVariants = digits.length >= 3 ? [digits, ...(digits.startsWith('0') ? [`62${digits.slice(1)}`] : [])] : [];
    const fulltext = fulltextQuery(q);
    conds.push(
      or(
        like(contacts.displayName, pattern),
        like(contacts.profileName, pattern),
        ...numberVariants.map((d) => like(contacts.waId, `%${d}%`)),
        ...(fulltext
          ? [
              exists(
                db
                  .select({ one: sql`1` })
                  .from(messages)
                  .where(and(eq(messages.conversationId, conversations.id), sql`MATCH(${messages.text}) AGAINST(${fulltext} IN BOOLEAN MODE)`)),
              ),
            ]
          : []),
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
  const labels = await labelsByContact(db, page.map((r) => r.contact.id));
  return {
    conversations: page.map((r) => conversationDTO(r.conv, r.contact, labels.get(r.contact.id) ?? [])),
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
