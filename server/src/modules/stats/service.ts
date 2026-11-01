import { and, asc, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import type { AgentStatsDTO, MonthlyStatsDTO } from '@wa/shared';
import { contacts, messages, users } from '../../db/schema';
import type { AppDeps } from '../../types';
import { localParts } from '../business-hours/schedule';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
// Giliran yang dimulai sebelum awal bulan ikut dibaca agar status "sudah dijawab" benar.
const LOOKBACK_MS = 3 * DAY;
// Pertanyaan di akhir bulan yang baru dijawab awal bulan berikutnya tetap dihitung terjawab.
const LOOKAHEAD_MS = 3 * DAY;
// Pesan masuk ini bukan pertanyaan (reaksi, notifikasi sistem).
const NOT_A_QUESTION = new Set(['reaction', 'system']);
const MEDIA = new Set(['image', 'video', 'audio', 'document']);

/** Awal bulan WIB (UTC+7) dalam UTC. */
function monthStartWib(year: number, month1: number): Date {
  return new Date(Date.UTC(year, month1 - 1, 1) - 7 * HOUR);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

interface AgentAcc {
  messagesSent: number;
  conversations: Set<number>;
  responses: number[];
  mediaSent: number;
  stickersSent: number;
  templatesSent: number;
  days: Set<string>;
  last: Date | null;
}

/** Statistik layanan satu bulan (WIB). Definisi "pertanyaan" dan "dijawab": lihat shared/src/stats.ts. */
export async function computeMonthlyStats(deps: AppDeps, month: string, now = new Date()): Promise<MonthlyStatsDTO> {
  const { db } = deps.database;
  const [year, month1] = month.split('-').map(Number) as [number, number];
  const from = monthStartWib(year, month1);
  const to = monthStartWib(month1 === 12 ? year + 1 : year, month1 === 12 ? 1 : month1 + 1);
  const scanTo = new Date(Math.min(now.getTime(), to.getTime() + LOOKAHEAD_MS));
  const at = sql<Date>`coalesce(${messages.waTimestamp}, ${messages.createdAt})`;

  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      direction: messages.direction,
      type: messages.type,
      status: messages.status,
      userId: messages.sentByUserId,
      apiKeyId: messages.sentByApiKeyId,
      system: messages.sentBySystem,
      at: messages.waTimestamp,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(gte(at, new Date(from.getTime() - LOOKBACK_MS)), lt(at, scanTo), ne(messages.status, 'failed')))
    .orderBy(asc(messages.conversationId), asc(at), asc(messages.id));

  const inMonth = (d: Date) => d >= from && d < to;
  const agents = new Map<number, AgentAcc>();
  const agent = (id: number) => {
    let a = agents.get(id);
    if (!a) {
      a = { messagesSent: 0, conversations: new Set(), responses: [], mediaSent: 0, stickersSent: 0, templatesSent: 0, days: new Set(), last: null };
      agents.set(id, a);
    }
    return a;
  };
  const totals = {
    inboundMessages: 0,
    conversations: 0,
    newContacts: 0,
    questions: 0,
    questionsAnswered: 0,
    questionsAnsweredByApi: 0,
    questionsUnanswered: 0,
    responseMedianSec: null as number | null,
    agentMessages: 0,
    autoReplies: 0,
    apiMessages: 0,
  };
  const conversations = new Set<number>();
  const allResponses: number[] = [];

  let currentConv = -1;
  let openTurn: Date | null = null;
  for (const r of rows) {
    if (r.conversationId !== currentConv) {
      currentConv = r.conversationId;
      openTurn = null;
    }
    const ts = r.at ?? r.createdAt;

    if (r.direction === 'in') {
      if (NOT_A_QUESTION.has(r.type)) continue;
      if (inMonth(ts)) {
        totals.inboundMessages++;
        conversations.add(r.conversationId);
      }
      if (!openTurn) {
        openTurn = ts;
        if (inMonth(ts)) totals.questions++;
      }
      continue;
    }

    const turnInMonth = openTurn !== null && inMonth(openTurn);
    if (r.userId) {
      if (inMonth(ts)) {
        const a = agent(r.userId);
        a.messagesSent++;
        a.conversations.add(r.conversationId);
        a.days.add(localParts(ts).day);
        if (!a.last || ts > a.last) a.last = ts;
        if (MEDIA.has(r.type)) a.mediaSent++;
        if (r.type === 'sticker') a.stickersSent++;
        if (r.type === 'template') a.templatesSent++;
        totals.agentMessages++;
      }
      if (openTurn && turnInMonth) {
        const sec = Math.round((ts.getTime() - openTurn.getTime()) / 1000);
        agent(r.userId).responses.push(sec);
        allResponses.push(sec);
        totals.questionsAnswered++;
      }
      openTurn = null;
    } else if (r.apiKeyId) {
      if (inMonth(ts)) totals.apiMessages++;
      if (openTurn && turnInMonth) totals.questionsAnsweredByApi++;
      openTurn = null;
    } else if (r.system && inMonth(ts)) {
      // Balasan otomatis tidak dianggap menjawab: pertanyaannya tetap menunggu petugas.
      totals.autoReplies++;
    }
  }

  totals.conversations = conversations.size;
  totals.questionsUnanswered = totals.questions - totals.questionsAnswered - totals.questionsAnsweredByApi;
  totals.responseMedianSec = median(allResponses);
  totals.newContacts = await db.$count(contacts, and(gte(contacts.firstSeenAt, from), lt(contacts.firstSeenAt, to)));

  const ids = [...agents.keys()];
  const people = ids.length
    ? await db.select({ id: users.id, nip: users.nip, name: users.name, seksi: users.seksi }).from(users).where(inArray(users.id, ids))
    : [];
  const result: AgentStatsDTO[] = people.map((u) => {
    const a = agents.get(u.id)!;
    return {
      userId: String(u.id),
      nip: u.nip,
      name: u.name,
      seksi: u.seksi,
      messagesSent: a.messagesSent,
      conversationsHandled: a.conversations.size,
      questionsAnswered: a.responses.length,
      responseMedianSec: median(a.responses),
      responseAvgSec: a.responses.length ? Math.round(a.responses.reduce((s, x) => s + x, 0) / a.responses.length) : null,
      mediaSent: a.mediaSent,
      stickersSent: a.stickersSent,
      templatesSent: a.templatesSent,
      activeDays: a.days.size,
      lastActivityAt: a.last?.toISOString() ?? null,
    };
  });
  result.sort((x, y) => y.questionsAnswered - x.questionsAnswered || y.messagesSent - x.messagesSent);

  return { month, from: from.toISOString(), to: to.toISOString(), totals, agents: result };
}
