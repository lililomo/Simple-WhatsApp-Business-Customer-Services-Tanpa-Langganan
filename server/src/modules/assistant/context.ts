import { readFile } from 'node:fs/promises';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { maskSensitive, messagePreview, parseAosAnswer, type AssistantSettings } from '@wa/shared';
import { aiMessages, contacts, conversations, media, messages, users } from '../../db/schema';
import type { AppDeps } from '../../types';
import { mediaAbsolutePath } from '../media/service';
import type { EngineImage } from './engine';

/** Bahan yang dikirim ke Claude untuk satu percakapan: transkrip WhatsApp (disamarkan) dan lampiran gambar. */

export interface ChatContext {
  contactName: string;
  contactId: number;
  transcript: string;
  /** Jumlah pesan WP paling akhir yang belum dibalas petugas. */
  newInbound: number;
  /** Pesan WP terakhir. */
  lastInboundId: number | null;
  images: EngineImage[];
  /** Penanda → nilai asli (kosong bila penyamaran dimatikan). */
  mask: Record<string, string>;
}

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Gambar hanya diambil dari pesan-pesan paling akhir agar yang dikirim relevan dengan pertanyaan sekarang. */
const IMAGE_WINDOW = 12;
const MAX_MESSAGE_CHARS = 1500;

const stamp = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function masker(settings: AssistantSettings, map: Record<string, string>) {
  return (text: string) => (settings.privacy.mask ? maskSensitive(text, map).text : text);
}

export async function buildChatContext(
  deps: AppDeps,
  conversationId: number,
  settings: AssistantSettings,
  opts: { since?: Date | null; limit?: number; withImages?: boolean; markNew?: boolean } = {},
): Promise<ChatContext | null> {
  const { db } = deps.database;
  const [conv] = await db
    .select({ contactId: contacts.id, profileName: contacts.profileName, displayName: contacts.displayName })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) return null;

  const limit = opts.limit ?? settings.privacy.contextMessages;
  const rows = (
    await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), opts.since ? gte(messages.createdAt, opts.since) : undefined))
      .orderBy(desc(messages.id))
      .limit(limit)
  )
    // Reaksi dan pesan keluar yang gagal bukan bagian dari percakapan yang dibaca WP.
    .filter((m) => m.type !== 'reaction' && !(m.direction === 'out' && m.status === 'failed'))
    .reverse();

  const userIds = [...new Set(rows.map((r) => r.sentByUserId).filter((x): x is number => x !== null))];
  const mediaIds = [...new Set(rows.map((r) => r.mediaId).filter((x): x is number => x !== null))];
  const [userRows, mediaRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
    mediaIds.length ? db.select().from(media).where(inArray(media.id, mediaIds)) : [],
  ]);
  const userName = new Map(userRows.map((u) => [u.id, u.name]));
  const mediaById = new Map(mediaRows.map((m) => [m.id, m]));

  // Pesan WP setelah balasan petugas terakhir = yang sedang menunggu jawaban.
  let lastReply = -1;
  rows.forEach((m, i) => {
    if (m.direction === 'out' && !m.sentBySystem) lastReply = i;
  });
  const newInbound = rows.filter((m, i) => i > lastReply && m.direction === 'in').length;

  const mask: Record<string, string> = {};
  const hide = masker(settings, mask);
  const lines = rows.map((m, i) => {
    const file = m.mediaId ? mediaById.get(m.mediaId) : undefined;
    const body = clip(messagePreview(m.type, m.text, { fileName: file?.fileName ?? null }), MAX_MESSAGE_CHARS);
    const who =
      m.direction === 'in'
        ? 'WP'
        : m.sentBySystem
          ? 'Balasan otomatis'
          : `Petugas${m.sentByUserId && userName.get(m.sentByUserId) ? ` (${userName.get(m.sentByUserId)})` : ''}`;
    const fresh = opts.markNew && m.direction === 'in' && i > lastReply ? ' [BARU]' : '';
    return `[${stamp.format(m.waTimestamp ?? m.createdAt)}] ${who}${fresh}: ${hide(body)}`;
  });

  const images: EngineImage[] = [];
  if (opts.withImages && settings.privacy.attachments) {
    const candidates = rows
      .slice(-IMAGE_WINDOW)
      .filter((m) => m.direction === 'in' && m.type === 'image' && m.mediaId)
      .slice(-MAX_IMAGES);
    for (const m of candidates) {
      const file = mediaById.get(m.mediaId!);
      if (!file?.storagePath || file.status !== 'ready' || !file.mimeType || !IMAGE_TYPES.has(file.mimeType)) continue;
      if ((file.fileSize ?? 0) > MAX_IMAGE_BYTES) continue;
      try {
        const data = await readFile(mediaAbsolutePath(deps.config, file.storagePath));
        if (data.length <= MAX_IMAGE_BYTES) images.push({ mediaType: file.mimeType as EngineImage['mediaType'], data: data.toString('base64') });
      } catch {
        // Berkas sudah dibersihkan: lanjut tanpa gambar ini.
      }
    }
  }

  const lastInbound = [...rows].reverse().find((m) => m.direction === 'in');
  return {
    contactName: conv.displayName || conv.profileName || 'WP',
    contactId: conv.contactId,
    transcript: lines.join('\n'),
    newInbound,
    lastInboundId: lastInbound?.id ?? null,
    images,
    mask,
  };
}

/** Tanya-jawab AOS sebelumnya di sesi ini, diringkas agar permintaan lanjutan ("yang tadi dipersingkat") nyambung. */
export async function buildThreadHistory(
  deps: AppDeps,
  threadId: number,
  since: Date | null,
  beforeMessageId: number,
  hide: (text: string) => string,
): Promise<string> {
  const rows = (
    await deps.database.db
      .select({ id: aiMessages.id, kind: aiMessages.kind, status: aiMessages.status, text: aiMessages.text, createdAt: aiMessages.createdAt })
      .from(aiMessages)
      .where(and(eq(aiMessages.threadId, threadId), since ? gte(aiMessages.createdAt, since) : undefined))
      .orderBy(desc(aiMessages.id))
      .limit(12)
  )
    .filter((m) => m.id < beforeMessageId && (m.kind === 'user' || (m.kind === 'answer' && m.status === 'done')) && m.text)
    .reverse();
  return rows
    .map((m) => {
      if (m.kind === 'user') return `Petugas: ${hide(clip(m.text!, 600))}`;
      const parsed = parseAosAnswer(m.text!);
      return `AOS: ${hide(clip(parsed.draft ?? parsed.plain ?? '', 1200))}`;
    })
    .join('\n');
}
