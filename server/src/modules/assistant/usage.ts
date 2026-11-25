import { and, count, eq, gte, lt, sql, sum } from 'drizzle-orm';
import type { AosProvider, AosUsageDTO } from '@wa/shared';
import { aiCalls, aiMessages } from '../../db/schema';
import type { AppDeps } from '../../types';
import { localParts } from '../business-hours/schedule';
import { monthStartWib } from '../stats/service';

const usd = (micro: unknown) => Number(micro ?? 0) / 1_000_000;

/** Rentang satu bulan menurut WIB; `month` berformat YYYY-MM, kosong = bulan berjalan. */
export function monthRange(month?: string, now = new Date()): { month: string; from: Date; to: Date } {
  const value = month && /^\d{4}-\d{2}$/.test(month) ? month : localParts(now).day.slice(0, 7);
  const [y, m] = value.split('-').map(Number) as [number, number];
  return { month: value, from: monthStartWib(y, m), to: monthStartWib(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1) };
}

/** Pemakaian AOS satu bulan: panggilan, biaya, seberapa sering jawabannya dipakai, dan apa yang paling sering ditanyakan. */
export async function computeUsage(deps: AppDeps, monthInput?: string): Promise<AosUsageDTO> {
  const { db } = deps.database;
  const { month, from, to } = monthRange(monthInput);
  const inMonth = and(gte(aiCalls.createdAt, from), lt(aiCalls.createdAt, to));
  const calls = count(aiCalls.id);
  const cost = sum(aiCalls.costMicroUsd);
  // Hari menurut WIB (waktu disimpan dalam UTC).
  const day = sql<string>`DATE_FORMAT(DATE_ADD(${aiCalls.createdAt}, INTERVAL 7 HOUR), '%Y-%m-%d')`;

  const [totals, byDay, byProvider, byPurpose, byModel, triageMeta, answers, offers] = await Promise.all([
    db.select({ calls, input: sum(aiCalls.inputTokens), output: sum(aiCalls.outputTokens), cost }).from(aiCalls).where(inMonth),
    db.select({ day, calls, cost }).from(aiCalls).where(inMonth).groupBy(day).orderBy(day),
    db
      .select({ provider: aiCalls.provider, calls, cost, failed: sql<number>`SUM(CASE WHEN ${aiCalls.ok} THEN 0 ELSE 1 END)` })
      .from(aiCalls)
      .where(inMonth)
      .groupBy(aiCalls.provider),
    db.select({ purpose: aiCalls.purpose, calls, cost }).from(aiCalls).where(inMonth).groupBy(aiCalls.purpose),
    db.select({ model: aiCalls.model, calls, cost }).from(aiCalls).where(inMonth).groupBy(aiCalls.model),
    db
      .select({ meta: aiCalls.meta })
      .from(aiCalls)
      .where(and(inMonth, eq(aiCalls.purpose, 'triage'), eq(aiCalls.ok, true))),
    db
      .select({
        made: count(aiMessages.id),
        used: sql<number>`SUM(CASE WHEN ${aiMessages.usedAt} IS NULL THEN 0 ELSE 1 END)`,
        up: sql<number>`SUM(CASE WHEN ${aiMessages.feedback} = 1 THEN 1 ELSE 0 END)`,
        down: sql<number>`SUM(CASE WHEN ${aiMessages.feedback} = -1 THEN 1 ELSE 0 END)`,
      })
      .from(aiMessages)
      .where(and(eq(aiMessages.kind, 'answer'), eq(aiMessages.status, 'done'), gte(aiMessages.createdAt, from), lt(aiMessages.createdAt, to))),
    db
      .select({
        made: count(aiMessages.id),
        answered: sql<number>`SUM(CASE WHEN ${aiMessages.offerState} = 'answered' THEN 1 ELSE 0 END)`,
        dismissed: sql<number>`SUM(CASE WHEN ${aiMessages.offerState} = 'dismissed' THEN 1 ELSE 0 END)`,
      })
      .from(aiMessages)
      .where(and(eq(aiMessages.kind, 'offer'), gte(aiMessages.createdAt, from), lt(aiMessages.createdAt, to))),
  ]);

  // Topik dan kategori dihitung dari hasil deteksi awal; "diam" (sapaan dsb.) tidak dihitung sebagai pertanyaan.
  const topics = new Map<string, number>();
  const categories = new Map<string, number>();
  for (const { meta } of triageMeta) {
    const m = (meta ?? {}) as { topik?: unknown; kategori?: unknown; tindakan?: unknown };
    if (typeof m.kategori === 'string' && m.kategori) categories.set(m.kategori, (categories.get(m.kategori) ?? 0) + 1);
    if (m.tindakan !== 'diam' && typeof m.topik === 'string' && m.topik) topics.set(m.topik, (topics.get(m.topik) ?? 0) + 1);
  }
  const ranked = (map: Map<string, number>, limit: number) =>
    [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);

  return {
    month,
    totals: {
      calls: Number(totals[0]?.calls ?? 0),
      inputTokens: Number(totals[0]?.input ?? 0),
      outputTokens: Number(totals[0]?.output ?? 0),
      costUsd: usd(totals[0]?.cost),
    },
    byDay: byDay.map((r) => ({ day: r.day, calls: Number(r.calls), costUsd: usd(r.cost) })),
    byProvider: byProvider.map((r) => ({ provider: r.provider as AosProvider, calls: Number(r.calls), costUsd: usd(r.cost), failed: Number(r.failed ?? 0) })),
    byPurpose: byPurpose.map((r) => ({ purpose: r.purpose, calls: Number(r.calls), costUsd: usd(r.cost) })),
    byModel: byModel.map((r) => ({ model: r.model, calls: Number(r.calls), costUsd: usd(r.cost) })),
    answers: {
      made: Number(answers[0]?.made ?? 0),
      used: Number(answers[0]?.used ?? 0),
      up: Number(answers[0]?.up ?? 0),
      down: Number(answers[0]?.down ?? 0),
    },
    offers: {
      made: Number(offers[0]?.made ?? 0),
      answered: Number(offers[0]?.answered ?? 0),
      dismissed: Number(offers[0]?.dismissed ?? 0),
    },
    topics: ranked(topics, 15).map(([topic, n]) => ({ topic, count: n })),
    categories: ranked(categories, 10).map(([category, n]) => ({ category, count: n })),
  };
}
