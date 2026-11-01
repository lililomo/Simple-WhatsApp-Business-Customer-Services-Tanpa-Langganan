import { eq, inArray } from 'drizzle-orm';
import {
  formatWaId,
  messagePreview,
  type ContactDTO,
  type ConversationDTO,
  type MediaDTO,
  type MessageDTO,
  type SenderDTO,
} from '@wa/shared';
import type { Db } from '../../db/client';
import { apiKeys, contacts, conversations, media, messages, users } from '../../db/schema';
import { metaErrorMessage } from '../../meta/errors';

export type ContactRow = typeof contacts.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type MediaRow = typeof media.$inferSelect;

const SYSTEM_SENDERS: Record<string, string> = { auto_reply: 'Balasan otomatis' };

export function contactDTO(c: ContactRow): ContactDTO {
  return {
    id: String(c.id),
    waId: c.waId,
    name: c.displayName || c.profileName || formatWaId(c.waId),
    profileName: c.profileName,
    displayName: c.displayName,
    firstSeenAt: c.firstSeenAt.toISOString(),
  };
}

export function conversationDTO(conv: ConversationRow, contact: ContactRow): ConversationDTO {
  return {
    id: String(conv.id),
    contact: contactDTO(contact),
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: conv.lastMessagePreview,
    lastMessageDirection: conv.lastMessageDirection,
    lastInboundAt: conv.lastInboundAt?.toISOString() ?? null,
    cswExpiresAt: conv.cswExpiresAt?.toISOString() ?? null,
    unreadCount: conv.unreadCount,
  };
}

export async function loadConversation(db: Db, id: number): Promise<ConversationDTO | null> {
  const [row] = await db
    .select({ conv: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, id))
    .limit(1);
  return row ? conversationDTO(row.conv, row.contact) : null;
}

export function mediaDTO(m: MediaRow): MediaDTO {
  return {
    id: String(m.id),
    mimeType: m.mimeType,
    fileName: m.fileName,
    fileSize: m.fileSize,
    status: m.status,
    url: `/api/media/${m.id}`,
  };
}

/** Ubah baris pesan menjadi DTO dengan media, pengirim, dan cuplikan pesan yang dikutip (dimuat sekaligus). */
export async function messagesToDTO(db: Db, rows: MessageRow[]): Promise<MessageDTO[]> {
  if (rows.length === 0) return [];
  const uniq = <T>(xs: (T | null)[]) => [...new Set(xs.filter((x): x is T => x !== null))];
  const mediaIds = uniq(rows.map((r) => r.mediaId));
  const userIds = uniq(rows.map((r) => r.sentByUserId));
  const keyIds = uniq(rows.map((r) => r.sentByApiKeyId));
  const replyIds = uniq(rows.map((r) => r.replyToWamid));

  const [mediaRows, userRows, keyRows, replyRows] = await Promise.all([
    mediaIds.length ? db.select().from(media).where(inArray(media.id, mediaIds)) : [],
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
    keyIds.length ? db.select({ id: apiKeys.id, name: apiKeys.name }).from(apiKeys).where(inArray(apiKeys.id, keyIds)) : [],
    replyIds.length
      ? db
          .select({ wamid: messages.wamid, type: messages.type, text: messages.text, direction: messages.direction })
          .from(messages)
          .where(inArray(messages.wamid, replyIds))
      : [],
  ]);
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));
  const userById = new Map(userRows.map((u) => [u.id, u.name]));
  const keyById = new Map(keyRows.map((k) => [k.id, k.name]));
  const replyByWamid = new Map(replyRows.map((r) => [r.wamid, r]));

  return rows.map((r) => {
    const m = r.mediaId ? mediaById.get(r.mediaId) : undefined;
    const reply = r.replyToWamid ? replyByWamid.get(r.replyToWamid) : undefined;
    let sentBy: SenderDTO | null = null;
    if (r.sentByUserId) sentBy = { type: 'user', id: String(r.sentByUserId), name: userById.get(r.sentByUserId) ?? 'Petugas' };
    else if (r.sentByApiKeyId) sentBy = { type: 'api', id: String(r.sentByApiKeyId), name: keyById.get(r.sentByApiKeyId) ?? 'API' };
    else if (r.sentBySystem) sentBy = { type: 'system', id: r.sentBySystem, name: SYSTEM_SENDERS[r.sentBySystem] ?? 'Sistem' };
    return {
      id: String(r.id),
      conversationId: String(r.conversationId),
      wamid: r.wamid,
      direction: r.direction,
      type: r.type,
      status: r.status,
      text: r.text,
      payload: r.payload,
      media: m ? mediaDTO(m) : null,
      replyTo: r.replyToWamid
        ? {
            wamid: r.replyToWamid,
            preview: reply ? messagePreview(reply.type, reply.text) : null,
            direction: reply?.direction ?? null,
          }
        : null,
      reactionEmoji: r.reactionEmoji,
      templateName: r.templateName,
      sentBy,
      clientRef: r.clientRef,
      error:
        r.status === 'failed' || r.errorCode !== null
          ? {
              code: r.errorCode,
              title: r.errorTitle,
              detail: r.errorDetail,
              message: metaErrorMessage(r.errorCode ?? undefined, r.errorTitle ?? undefined),
            }
          : null,
      pricingCategory: r.pricingCategory,
      timestamp: (r.waTimestamp ?? r.createdAt).toISOString(),
    };
  });
}

export async function loadMessage(db: Db, id: number): Promise<MessageDTO | null> {
  const [row] = await db.select().from(messages).where(eq(messages.id, id)).limit(1);
  return row ? ((await messagesToDTO(db, [row]))[0] ?? null) : null;
}
