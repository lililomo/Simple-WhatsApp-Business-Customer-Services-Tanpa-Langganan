import { and, eq, sql } from 'drizzle-orm';
import { messagePreview } from '@wa/shared';
import { contacts, conversations, media, messages, templates, waAccounts } from '../../db/schema';
import {
  MEDIA_TYPES,
  type InboundMessage,
  type MediaRef,
  type MessagesValue,
  type StatusUpdate,
  type WebhookPayload,
} from '../../meta/webhook-types';
import type { AppDeps } from '../../types';
import { isDuplicateKey } from '../../lib/errors';
import { maybeAutoReply } from '../business-hours/service';
import type { WaAccount } from '../connection/service';
import { loadConversation, loadMessage, type ContactRow, type ConversationRow } from '../conversations/dto';
import { downloadInboundMedia } from '../media/service';

/** Data yang dibutuhkan belum ada (mis. status untuk pesan yang baru dikirim); coba lagi nanti. */
export class RetryLater extends Error {}

const CSW_MS = 24 * 60 * 60 * 1000;
// Status untuk wamid yang belum dikenal ditunggu sebentar (balasan Graph bisa kalah cepat dari webhook).
const UNKNOWN_STATUS_GRACE_MS = 2 * 60 * 1000;
const STATUS_RANK: Record<string, number> = { pending: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };

const tsToDate = (ts: string | undefined) => (ts ? new Date(Number(ts) * 1000) : new Date());

export async function processPayload(deps: AppDeps, payload: WebhookPayload, receivedAt: Date): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      switch (change.field) {
        case 'messages':
          await handleMessagesValue(deps, value as MessagesValue, receivedAt);
          break;
        case 'message_template_status_update':
          await updateTemplate(deps, entry.id, value, {
            status: String(value.event ?? ''),
            rejectedReason: value.reason && value.reason !== 'NONE' ? String(value.reason) : null,
          });
          break;
        case 'template_category_update':
          if (value.new_category) await updateTemplate(deps, entry.id, value, { category: String(value.new_category) });
          break;
        case 'message_template_quality_update':
          if (value.new_quality_score) await updateTemplate(deps, entry.id, value, { qualityScore: String(value.new_quality_score) });
          break;
        case 'phone_number_quality_update':
        case 'account_update':
          await updateAccountSignals(deps, entry.id, value);
          break;
        default:
          break;
      }
    }
  }
}

async function accountByPhoneId(deps: AppDeps, phoneNumberId: string | undefined): Promise<WaAccount | undefined> {
  if (!phoneNumberId) return undefined;
  const [row] = await deps.database.db.select().from(waAccounts).where(eq(waAccounts.phoneNumberId, phoneNumberId)).limit(1);
  return row;
}

async function handleMessagesValue(deps: AppDeps, value: MessagesValue, receivedAt: Date) {
  const account = await accountByPhoneId(deps, value.metadata?.phone_number_id);
  if (!account) return; // Nomor lain di WABA yang sama, bukan urusan aplikasi ini.

  for (const msg of value.messages ?? []) {
    const profile = value.contacts?.find((c) => c.wa_id === msg.from) ?? value.contacts?.[0];
    await handleInbound(deps, account, msg, profile?.profile?.name ?? null, profile ?? null);
  }
  for (const status of value.statuses ?? []) {
    await handleStatus(deps, status, receivedAt);
  }
}

export async function upsertContact(deps: AppDeps, waId: string, profileName: string | null, raw: unknown): Promise<ContactRow> {
  const { db } = deps.database;
  const set: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  if (profileName) set.profileName = profileName;
  if (raw) set.raw = raw;
  await db
    .insert(contacts)
    .values({ waId, profileName, raw: raw ?? null, firstSeenAt: new Date() })
    .onDuplicateKeyUpdate({ set });
  const [row] = await db.select().from(contacts).where(eq(contacts.waId, waId)).limit(1);
  return row!;
}

export async function upsertConversation(deps: AppDeps, accountId: number, contactId: number): Promise<ConversationRow> {
  const { db } = deps.database;
  await db
    .insert(conversations)
    .values({ waAccountId: accountId, contactId })
    .onDuplicateKeyUpdate({ set: { waAccountId: sql`wa_account_id` } });
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.waAccountId, accountId), eq(conversations.contactId, contactId)))
    .limit(1);
  return row!;
}

function extractText(msg: InboundMessage): string | null {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? null;
    case 'image':
    case 'video':
    case 'document':
      return msg[msg.type]?.caption ?? null;
    case 'interactive': {
      const i = msg.interactive;
      if (i?.button_reply) return i.button_reply.title;
      if (i?.list_reply) return [i.list_reply.title, i.list_reply.description].filter(Boolean).join(' — ');
      if (i?.nfm_reply) return i.nfm_reply.body ?? 'Formulir dikirim';
      return null;
    }
    case 'button':
      return msg.button?.text ?? null;
    case 'location': {
      const l = msg.location;
      return l ? [l.name, l.address].filter(Boolean).join(', ') || null : null;
    }
    case 'contacts':
      return msg.contacts?.map((c) => c.name?.formatted_name).filter(Boolean).join(', ') || null;
    case 'order':
      return msg.order?.text ?? null;
    case 'system':
      return msg.system?.body ?? null;
    case 'reaction':
      return msg.reaction?.emoji ?? null;
    default:
      return null;
  }
}

/** Tipe pesan tak dikenal Meta datang sebagai "unsupported"; simpan apa adanya. */
function normalizeType(msg: InboundMessage): string {
  return msg.type === 'unknown' ? 'unsupported' : msg.type;
}

async function handleInbound(
  deps: AppDeps,
  account: WaAccount,
  msg: InboundMessage,
  profileName: string | null,
  rawContact: unknown,
) {
  const { db } = deps.database;
  const [existing] = await db.select({ id: messages.id }).from(messages).where(eq(messages.wamid, msg.id)).limit(1);
  if (existing) return; // Meta mengirim ulang webhook; pesan ini sudah tercatat.

  const contact = await upsertContact(deps, msg.from, profileName, rawContact);
  const conv = await upsertConversation(deps, account.id, contact.id);
  const at = tsToDate(msg.timestamp);
  const type = normalizeType(msg);
  const text = extractText(msg);

  if (type === 'reaction' && msg.reaction) {
    await db.insert(messages).values({
      conversationId: conv.id,
      wamid: msg.id,
      direction: 'in',
      type,
      status: 'received',
      text,
      payload: msg as unknown as Record<string, unknown>,
      replyToWamid: msg.reaction.message_id,
      waTimestamp: at,
    });
    const [target] = await db.select({ id: messages.id }).from(messages).where(eq(messages.wamid, msg.reaction.message_id)).limit(1);
    if (target) {
      await db.update(messages).set({ reactionEmoji: msg.reaction.emoji || null }).where(eq(messages.id, target.id));
      const dto = await loadMessage(db, target.id);
      if (dto) deps.bus.emit({ type: 'message.updated', message: dto });
    }
    return;
  }

  let mediaRow: typeof media.$inferSelect | undefined;
  const mediaType = (MEDIA_TYPES as readonly string[]).includes(type) ? type : null;
  const ref: MediaRef | undefined = mediaType ? (msg[mediaType as keyof InboundMessage] as MediaRef | undefined) : undefined;
  if (ref?.id) {
    const [res] = await db.insert(media).values({
      waMediaId: ref.id,
      direction: 'in',
      mimeType: ref.mime_type ?? null,
      fileName: ref.filename ?? null,
      sha256: null,
      status: 'pending',
    });
    [mediaRow] = await db.select().from(media).where(eq(media.id, res.insertId));
  }

  let messageId: number;
  try {
    const [res] = await db.insert(messages).values({
      conversationId: conv.id,
      wamid: msg.id,
      direction: 'in',
      type,
      status: 'received',
      text,
      payload: msg as unknown as Record<string, unknown>,
      mediaId: mediaRow?.id ?? null,
      replyToWamid: msg.context?.id ?? null,
      waTimestamp: at,
      errorCode: msg.errors?.[0]?.code ?? null,
      errorTitle: msg.errors?.[0]?.title ?? null,
    });
    messageId = res.insertId;
  } catch (err) {
    if (isDuplicateKey(err)) return;
    throw err;
  }

  const isNewest = !conv.lastMessageAt || at >= conv.lastMessageAt;
  const csw = new Date(at.getTime() + CSW_MS);
  await db
    .update(conversations)
    .set({
      ...(isNewest
        ? {
            lastMessageId: messageId,
            lastMessageAt: at,
            lastMessagePreview: messagePreview(type, text, { voice: msg.audio?.voice, fileName: ref?.filename }).slice(0, 200),
            lastMessageDirection: 'in' as const,
          }
        : {}),
      lastInboundAt: !conv.lastInboundAt || at > conv.lastInboundAt ? at : conv.lastInboundAt,
      cswExpiresAt: !conv.cswExpiresAt || csw > conv.cswExpiresAt ? csw : conv.cswExpiresAt,
      unreadCount: sql`${conversations.unreadCount} + 1`,
    })
    .where(eq(conversations.id, conv.id));

  const [messageDto, convDto] = await Promise.all([loadMessage(db, messageId), loadConversation(db, conv.id)]);
  if (messageDto && convDto) deps.bus.emit({ type: 'message.created', message: messageDto, conversation: convDto });

  // Hanya untuk pesan yang baru tercatat (webhook ulang sudah berhenti di ER_DUP_ENTRY di atas). Kegagalannya
  // tidak boleh menggagalkan event ini, karena saat diproses ulang unduhan media di bawah akan terlewat.
  await maybeAutoReply(deps, {
    conversationId: conv.id,
    contactId: contact.id,
    contactName: convDto?.contact.name ?? contact.profileName ?? '',
    type,
    at,
  }).catch((err: unknown) => deps.log?.warn({ err, conversationId: conv.id }, 'auto reply check failed'));

  if (mediaRow) {
    await downloadInboundMedia(deps, account, mediaRow);
    const updated = await loadMessage(db, messageId);
    if (updated) deps.bus.emit({ type: 'message.updated', message: updated });
  }
}

async function handleStatus(deps: AppDeps, st: StatusUpdate, receivedAt: Date) {
  const { db } = deps.database;
  const [msg] = await db.select().from(messages).where(eq(messages.wamid, st.id)).limit(1);
  if (!msg) {
    // Pesan dari aplikasi lain di WABA yang sama (mis. Kirimdev) tidak pernah tercatat di sini.
    if (Date.now() - receivedAt.getTime() < UNKNOWN_STATUS_GRACE_MS) throw new RetryLater(`status untuk wamid belum dikenal: ${st.id}`);
    return;
  }
  if (msg.direction !== 'out') return;

  const at = tsToDate(st.timestamp);
  const changes: Partial<typeof messages.$inferInsert> = {};
  const current = STATUS_RANK[msg.status] ?? -1;

  if (st.status === 'failed') {
    // Pesan yang sudah diterima/dibaca tidak bisa "gagal" lagi.
    if (current < STATUS_RANK.delivered!) {
      const e = st.errors?.[0];
      Object.assign(changes, {
        status: 'failed',
        failedAt: at,
        errorCode: e?.code ?? null,
        errorTitle: e?.title ?? e?.message ?? null,
        errorDetail: e?.error_data?.details ?? null,
      });
    }
  } else if (st.status in STATUS_RANK) {
    const rank = STATUS_RANK[st.status]!;
    if (rank > current && msg.status !== 'failed') changes.status = st.status as 'sent' | 'delivered' | 'read';
    // Isi waktu yang belum ada meski status datang tidak berurutan.
    if (st.status === 'sent' && !msg.sentAt) changes.sentAt = at;
    if (st.status === 'delivered' && !msg.deliveredAt) changes.deliveredAt = at;
    if (st.status === 'read' && !msg.readAt) changes.readAt = at;
  }
  if (st.pricing) {
    changes.pricingCategory = st.pricing.category ?? msg.pricingCategory;
    changes.pricingBillable = st.pricing.billable ?? msg.pricingBillable;
  }
  if (Object.keys(changes).length === 0) return;

  await db.update(messages).set(changes).where(eq(messages.id, msg.id));
  const dto = await loadMessage(db, msg.id);
  if (dto) deps.bus.emit({ type: 'message.updated', message: dto });
}

async function updateTemplate(
  deps: AppDeps,
  wabaId: string,
  value: Record<string, unknown>,
  changes: Partial<typeof templates.$inferInsert>,
) {
  const { db } = deps.database;
  const [account] = await db.select().from(waAccounts).where(eq(waAccounts.wabaId, wabaId)).limit(1);
  if (!account) return;
  const metaId = value.message_template_id !== undefined ? String(value.message_template_id) : null;
  const where = metaId
    ? and(eq(templates.waAccountId, account.id), eq(templates.metaTemplateId, metaId))
    : and(
        eq(templates.waAccountId, account.id),
        eq(templates.name, String(value.message_template_name ?? '')),
        eq(templates.language, String(value.message_template_language ?? '')),
      );
  await db.update(templates).set(changes).where(where);
}

async function updateAccountSignals(deps: AppDeps, wabaId: string, value: Record<string, unknown>) {
  const { db } = deps.database;
  const changes: Partial<typeof waAccounts.$inferInsert> = {};
  if (typeof value.current_limit === 'string') changes.messagingLimit = value.current_limit;
  const ban = value.ban_info as { waba_ban_state?: string } | undefined;
  if (ban?.waba_ban_state && ban.waba_ban_state !== 'NONE') {
    changes.status = 'error';
    changes.lastError = `Akun WhatsApp Business dibatasi Meta (${ban.waba_ban_state}).`;
  }
  if (Object.keys(changes).length > 0) await db.update(waAccounts).set(changes).where(eq(waAccounts.wabaId, wabaId));
}
