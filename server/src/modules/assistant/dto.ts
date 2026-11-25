import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AosAnswer, AosMessageDTO, AosOption, AosProvider, AosThreadDTO } from '@wa/shared';
import type { Db } from '../../db/client';
import { aiMessages, aiThreads, conversations, users } from '../../db/schema';
import { isDuplicateKey } from '../../lib/errors';
import type { AppDeps } from '../../types';
import { loadConversation } from '../conversations/dto';

export type AiMessageRow = typeof aiMessages.$inferSelect;
export type AiThreadRow = typeof aiThreads.$inferSelect;

/** Isi kolom ai_messages.data. Sengaja `type` (bukan interface) agar cocok dengan kolom JSON bertipe Record. */
export type AiMessageData = {
  options?: AosOption[];
  answer?: AosAnswer;
  steps?: string[];
  /** Instruksi yang dijalankan untuk jawaban ini (dipakai "Buat ulang"). */
  instruction?: string;
  /** Hasil deteksi awal yang melahirkan tawaran ini. */
  triage?: Record<string, unknown>;
};

const THREAD_LIMIT = 100;

export function messageDTO(row: AiMessageRow, conversationId: number, authorName: string | null): AosMessageDTO {
  const data = (row.data ?? {}) as AiMessageData;
  return {
    id: String(row.id),
    conversationId: String(conversationId),
    kind: row.kind,
    status: row.status,
    text: row.text,
    options: row.kind === 'offer' ? (data.options ?? []) : null,
    offerState: row.offerState,
    answer: row.kind === 'answer' && row.status === 'done' ? (data.answer ?? null) : null,
    steps: data.steps ?? [],
    error: row.error,
    author: row.createdByUserId ? { id: String(row.createdByUserId), name: authorName ?? 'Petugas' } : null,
    provider: (row.provider as AosProvider | null) ?? null,
    model: row.model,
    durationMs: row.durationMs,
    feedback: row.feedback === 1 ? 1 : row.feedback === -1 ? -1 : null,
    usedAt: row.usedAt?.toISOString() ?? null,
    savedDocumentId: row.savedDocumentId ? String(row.savedDocumentId) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function authorNames(db: Db, rows: AiMessageRow[]): Promise<Map<number, string>> {
  const ids = [...new Set(rows.map((r) => r.createdByUserId).filter((x): x is number => x !== null))];
  if (ids.length === 0) return new Map();
  const found = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(found.map((u) => [u.id, u.name]));
}

export async function getThread(db: Db, conversationId: number): Promise<AiThreadRow | null> {
  const [row] = await db.select().from(aiThreads).where(eq(aiThreads.conversationId, conversationId)).limit(1);
  return row ?? null;
}

/** Satu sesi per percakapan; dibuat saat pertama dibutuhkan. */
export async function ensureThread(db: Db, conversationId: number): Promise<AiThreadRow> {
  const existing = await getThread(db, conversationId);
  if (existing) return existing;
  await db
    .insert(aiThreads)
    .values({ conversationId })
    .catch((err: unknown) => {
      // Dua permintaan pertama datang bersamaan: pakai baris yang sudah dibuat.
      if (!isDuplicateKey(err)) throw err;
    });
  return (await getThread(db, conversationId))!;
}

export async function threadDTO(db: Db, conversationId: number): Promise<AosThreadDTO> {
  const thread = await getThread(db, conversationId);
  if (!thread) return { conversationId: String(conversationId), topicStartedAt: null, messages: [], openOfferId: null };
  const rows = (await db.select().from(aiMessages).where(eq(aiMessages.threadId, thread.id)).orderBy(desc(aiMessages.id)).limit(THREAD_LIMIT)).reverse();
  const names = await authorNames(db, rows);
  const open = [...rows].reverse().find((r) => r.kind === 'offer' && r.offerState === 'open');
  return {
    conversationId: String(conversationId),
    topicStartedAt: thread.topicStartedAt?.toISOString() ?? null,
    messages: rows.map((r) => messageDTO(r, conversationId, r.createdByUserId ? (names.get(r.createdByUserId) ?? null) : null)),
    openOfferId: open ? String(open.id) : null,
  };
}

export async function loadAiMessage(db: Db, id: number): Promise<{ row: AiMessageRow; thread: AiThreadRow } | null> {
  const [found] = await db
    .select({ row: aiMessages, thread: aiThreads })
    .from(aiMessages)
    .innerJoin(aiThreads, eq(aiThreads.id, aiMessages.threadId))
    .where(eq(aiMessages.id, id))
    .limit(1);
  return found ?? null;
}

export async function aiMessageDTO(db: Db, id: number): Promise<AosMessageDTO | null> {
  const found = await loadAiMessage(db, id);
  if (!found) return null;
  const names = await authorNames(db, [found.row]);
  return messageDTO(found.row, found.thread.conversationId, found.row.createdByUserId ? (names.get(found.row.createdByUserId) ?? null) : null);
}

/** Kabari browser bahwa satu pesan sesi AOS dibuat atau berubah. */
export async function emitAiMessage(deps: AppDeps, id: number): Promise<AosMessageDTO | null> {
  const dto = await aiMessageDTO(deps.database.db, id);
  if (dto) deps.bus.emit({ type: 'assistant.updated', conversationId: dto.conversationId, message: dto });
  return dto;
}

export async function emitConversation(deps: AppDeps, conversationId: number): Promise<void> {
  const dto = await loadConversation(deps.database.db, conversationId);
  if (dto) deps.bus.emit({ type: 'conversation.updated', conversation: dto });
}

/**
 * Menutup tawaran yang masih terbuka di sesi ini (dijawab, ditolak, atau digantikan tawaran baru) dan menghapus
 * tanda tawaran di percakapan. Mengembalikan id tawaran yang ditutup.
 */
export async function closeOpenOffers(
  deps: AppDeps,
  thread: AiThreadRow,
  state: 'answered' | 'dismissed',
  opts: { emitConversation?: boolean } = {},
): Promise<number[]> {
  const { db } = deps.database;
  const open = await db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(and(eq(aiMessages.threadId, thread.id), eq(aiMessages.kind, 'offer'), eq(aiMessages.offerState, 'open')));
  const ids = open.map((o) => o.id);
  if (ids.length > 0) await db.update(aiMessages).set({ offerState: state }).where(inArray(aiMessages.id, ids));
  const [conv] = await db
    .select({ offer: conversations.aosOfferMessageId })
    .from(conversations)
    .where(eq(conversations.id, thread.conversationId))
    .limit(1);
  if (conv?.offer != null) {
    await db.update(conversations).set({ aosOfferMessageId: null }).where(eq(conversations.id, thread.conversationId));
    if (opts.emitConversation !== false) await emitConversation(deps, thread.conversationId);
  }
  for (const id of ids) await emitAiMessage(deps, id);
  return ids;
}
