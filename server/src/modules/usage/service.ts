import { and, count, gte, lt, sql } from 'drizzle-orm';
import { FREE_SERVICE_MESSAGES, type UsageDTO } from '@wa/shared';
import { messagePricing } from '../../db/schema';
import type { AppDeps } from '../../types';
import { localParts } from '../business-hours/schedule';
import { accountGraph, getAccount, metaToAppError } from '../connection/service';
import { monthStartWib } from '../stats/service';

// pricing_analytics dibatasi Meta (±10 permintaan/jam per nomor); laporan resminya pun tertunda.
const META_CACHE_MS = 15 * 60 * 1000;
const POLICY_CACHE_MS = 6 * 60 * 60 * 1000;

interface MetaReport {
  month: string;
  service: number;
  serviceBillable: number;
  templates: number;
  cost: number;
  currency: string | null;
  fetchedAt: Date;
}

interface DataPoint {
  pricing_category?: string;
  pricing_type?: string;
  volume?: number;
  cost?: number;
}

let metaCache: { at: number; report: MetaReport | null; error: string | null } | null = null;
let policyCache: { at: number; value: UsageDTO['servicePricingPolicy'] } | null = null;

/** Untuk test: buang cache laporan Meta. */
export function resetUsageCache() {
  metaCache = null;
  policyCache = null;
}

function currentMonth(now: Date) {
  const day = localParts(now).day;
  const [y, m] = day.split('-').map(Number) as [number, number];
  const from = monthStartWib(y, m);
  const to = monthStartWib(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
  return { month: day.slice(0, 7), from, to };
}

async function fetchMetaReport(deps: AppDeps, from: Date, now: Date, month: string): Promise<MetaReport> {
  const account = await getAccount(deps);
  if (!account) throw new Error('Nomor WhatsApp belum terhubung.');
  const start = Math.floor(from.getTime() / 1000);
  const end = Math.floor(now.getTime() / 1000);
  const res = await accountGraph(deps, account).get<{ currency?: string; pricing_analytics?: { data?: { data_points?: DataPoint[] }[] } }>(
    account.wabaId,
    { fields: `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(PRICING_CATEGORY,PRICING_TYPE)` },
  );
  const report: MetaReport = { month, service: 0, serviceBillable: 0, templates: 0, cost: 0, currency: res.currency ?? null, fetchedAt: now };
  for (const p of res.pricing_analytics?.data?.flatMap((d) => d.data_points ?? []) ?? []) {
    const volume = p.volume ?? 0;
    report.cost += p.cost ?? 0;
    if (p.pricing_category === 'SERVICE') {
      report.service += volume;
      if (p.pricing_type === 'REGULAR') report.serviceBillable += volume;
    } else {
      report.templates += volume;
    }
  }
  report.cost = Math.round(report.cost * 100) / 100;
  return report;
}

async function fetchPolicy(deps: AppDeps): Promise<UsageDTO['servicePricingPolicy']> {
  const account = await getAccount(deps);
  if (!account) return null;
  const res = await accountGraph(deps, account).get<{ service_pricing_policy?: string }>(account.wabaId, { fields: 'service_pricing_policy' });
  return res.service_pricing_policy === 'PAID_EXEMPT' || res.service_pricing_policy === 'REGULAR' ? res.service_pricing_policy : null;
}

/** Pemakaian kuota pesan service bulan ini: hitungan realtime lokal digabung laporan Meta. */
export async function computeUsage(deps: AppDeps, now = new Date()): Promise<UsageDTO> {
  const { db } = deps.database;
  const { month, from, to } = currentMonth(now);
  const inMonth = and(gte(messagePricing.deliveredAt, from), lt(messagePricing.deliveredAt, to));

  const [local] = await db
    .select({
      service: sql<number>`sum(${messagePricing.category} = 'service')`,
      serviceBillable: sql<number>`sum(${messagePricing.category} = 'service' and ${messagePricing.billable} = 1)`,
      templates: sql<number>`sum(${messagePricing.category} <> 'service')`,
      total: count(),
    })
    .from(messagePricing)
    .where(inMonth);

  if (!metaCache || now.getTime() - metaCache.at > META_CACHE_MS || metaCache.report?.month !== month) {
    try {
      metaCache = { at: now.getTime(), report: await fetchMetaReport(deps, from, now, month), error: null };
    } catch (err) {
      metaCache = { at: now.getTime(), report: metaCache?.report?.month === month ? metaCache.report : null, error: metaToAppError(err).message };
    }
  }
  if (!policyCache || now.getTime() - policyCache.at > POLICY_CACHE_MS) {
    policyCache = { at: now.getTime(), value: await fetchPolicy(deps).catch(() => policyCache?.value ?? null) };
  }

  const localCounts = {
    service: Number(local?.service ?? 0),
    serviceBillable: Number(local?.serviceBillable ?? 0),
    templates: Number(local?.templates ?? 0),
  };
  const meta = metaCache.report;
  const used = Math.max(localCounts.service, meta?.service ?? 0);
  return {
    month,
    resetsAt: to.toISOString(),
    freeLimit: FREE_SERVICE_MESSAGES,
    used,
    remaining: Math.max(0, FREE_SERVICE_MESSAGES - used),
    local: localCounts,
    meta: meta ? { ...meta, fetchedAt: meta.fetchedAt.toISOString() } : null,
    metaError: metaCache.error,
    servicePricingPolicy: policyCache.value,
  };
}
