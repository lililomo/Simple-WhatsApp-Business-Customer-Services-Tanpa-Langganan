import { and, desc, eq, gte, like, lte } from 'drizzle-orm';
import {
  DEFAULT_BUSINESS_HOURS,
  businessHoursSettings,
  describeSchedule,
  fillVariables,
  greetingFor,
  type BusinessHoursDTO,
  type BusinessHoursSettings,
  type HolidayDTO,
} from '@wa/shared';
import { autoReplyLog, holidays } from '../../db/schema';
import { decrypt, encrypt } from '../../lib/crypto';
import { getSetting, setSetting } from '../../lib/settings';
import type { AppDeps } from '../../types';
import { textSpec } from '../messages/build';
import { sendToConversation } from '../messages/service';
import { evaluate, localParts } from './schedule';

const SETTINGS_KEY = 'business_hours';
const API_KEY_KEY = 'holiday_api_key';
const SYNC_KEY = 'holidays_sync';
const HOLIDAY_API = 'https://use.api.co.id/holidays/indonesia/';
// Pesan lama (antrean webhook tertunda) tidak dibalas otomatis lagi.
const AUTO_REPLY_MAX_AGE_MS = 15 * 60 * 1000;
// Mode "setiap pesan": rentetan pesan beruntun dari nomor yang sama cukup dibalas sekali.
const AUTO_REPLY_COOLDOWN_MS = 60 * 1000;
// Jenis pesan masuk yang tidak dibalas otomatis.
const NO_AUTO_REPLY_TYPES = new Set(['reaction', 'system', 'unsupported']);

interface SyncState {
  fetchedAt: string | null;
  error: string | null;
}

export async function getBusinessHours(deps: AppDeps): Promise<BusinessHoursSettings> {
  const stored = await getSetting<unknown>(deps.database.db, SETTINGS_KEY, null);
  const parsed = businessHoursSettings.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_BUSINESS_HOURS;
}

async function getApiKey(deps: AppDeps): Promise<string | null> {
  const stored = await getSetting<{ enc: string } | null>(deps.database.db, API_KEY_KEY, null);
  return stored ? decrypt(stored.enc, deps.config.appKey) : null;
}

export async function saveBusinessHours(
  deps: AppDeps,
  settings: BusinessHoursSettings,
  apiKey: string | null | undefined,
  userId: number,
): Promise<void> {
  const { db } = deps.database;
  await setSetting(db, SETTINGS_KEY, settings, userId);
  if (apiKey === null) await setSetting(db, API_KEY_KEY, null, userId);
  else if (apiKey) await setSetting(db, API_KEY_KEY, { enc: encrypt(apiKey, deps.config.appKey) }, userId);
  deps.bus.emit({ type: 'library.updated', resource: 'business-hours' });
}

export async function holidaysOn(deps: AppDeps, day: string): Promise<HolidayDTO[]> {
  return deps.database.db.select({ date: holidays.date, name: holidays.name, type: holidays.type }).from(holidays).where(eq(holidays.date, day));
}

interface ApiHoliday {
  date: string;
  name: string;
  type: string;
}

/** Ambil hari libur satu tahun dari api.co.id (halaman berisi 100 data). */
async function fetchYear(deps: AppDeps, apiKey: string, year: number): Promise<ApiHoliday[]> {
  const doFetch = deps.fetch ?? fetch;
  const all: ApiHoliday[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await doFetch(`${HOLIDAY_API}?year=${year}&page=${page}`, {
      headers: { 'x-api-co-id': apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as {
      is_success?: boolean;
      message?: string;
      data?: ApiHoliday[];
      paging?: { total_page?: number };
    } | null;
    if (!res.ok || !body?.is_success) {
      throw new Error(res.status === 401 || res.status === 403 ? 'API key api.co.id ditolak.' : `API hari libur gagal (${res.status}): ${body?.message ?? 'tanpa keterangan'}`);
    }
    all.push(...(body.data ?? []));
    if (page >= (body.paging?.total_page ?? 1)) break;
  }
  return all;
}

/** Perbarui salinan hari libur tahun ini dan tahun depan. Gagal = data lama tetap dipakai. */
export async function syncHolidays(deps: AppDeps, now = new Date()): Promise<{ synced: number; error: string | null }> {
  const { db } = deps.database;
  const apiKey = await getApiKey(deps);
  if (!apiKey) {
    const error = 'API key api.co.id belum diisi.';
    await setSetting(db, SYNC_KEY, { ...(await getSyncState(deps)), error });
    return { synced: 0, error };
  }
  const year = Number(localParts(now).day.slice(0, 4));
  try {
    let synced = 0;
    for (const y of [year, year + 1]) {
      const rows = await fetchYear(deps, apiKey, y);
      // Tahun depan sering belum diumumkan; jangan hapus data lama bila API mengembalikan kosong.
      if (rows.length === 0) continue;
      const fetchedAt = new Date();
      await db.transaction(async (tx) => {
        await tx.delete(holidays).where(like(holidays.date, `${y}-%`));
        await tx.insert(holidays).values(rows.map((r) => ({ date: r.date, name: r.name.slice(0, 190), type: r.type.slice(0, 32), fetchedAt })));
      });
      synced += rows.length;
    }
    await setSetting(db, SYNC_KEY, { fetchedAt: new Date().toISOString(), error: null } satisfies SyncState);
    deps.bus.emit({ type: 'library.updated', resource: 'business-hours' });
    return { synced, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'API hari libur gagal.';
    await setSetting(db, SYNC_KEY, { ...(await getSyncState(deps)), error });
    return { synced: 0, error };
  }
}

async function getSyncState(deps: AppDeps): Promise<SyncState> {
  return getSetting<SyncState>(deps.database.db, SYNC_KEY, { fetchedAt: null, error: null });
}

export async function businessHoursDTO(deps: AppDeps, now = new Date()): Promise<BusinessHoursDTO> {
  const { db } = deps.database;
  const settings = await getBusinessHours(deps);
  const today = localParts(now).day;
  const [sync, apiKey, upcoming, todayHolidays] = await Promise.all([
    getSyncState(deps),
    getSetting<{ enc: string } | null>(db, API_KEY_KEY, null),
    db
      .select({ date: holidays.date, name: holidays.name, type: holidays.type })
      .from(holidays)
      .where(and(gte(holidays.date, today), lte(holidays.date, `${Number(today.slice(0, 4)) + 1}-12-31`)))
      .orderBy(holidays.date)
      .limit(30),
    holidaysOn(deps, today),
  ]);
  return {
    settings,
    holidayApiKeySet: !!apiKey,
    holidaysFetchedAt: sync.fetchedAt,
    holidayError: sync.error,
    upcomingHolidays: upcoming,
    status: evaluate(settings, todayHolidays, now),
  };
}

/**
 * Balas otomatis pesan yang masuk di luar jam kerja. Dipanggil sekali per pesan masuk baru (bukan saat
 * webhook diproses ulang), dan dicatat sebelum dikirim agar tidak pernah terkirim dua kali.
 */
export async function maybeAutoReply(
  deps: AppDeps,
  input: { conversationId: number; contactId: number; contactName: string; type: string; at: Date },
  now = new Date(),
): Promise<boolean> {
  if (NO_AUTO_REPLY_TYPES.has(input.type)) return false;
  if (now.getTime() - input.at.getTime() > AUTO_REPLY_MAX_AGE_MS) return false;
  const settings = await getBusinessHours(deps);
  const { enabled, message, mode } = settings.autoReply;
  if (!enabled || !message.trim()) return false;
  const { day } = localParts(input.at);
  if (evaluate(settings, await holidaysOn(deps, day), input.at).open) return false;

  const { db } = deps.database;
  const [last] = await db
    .select({ day: autoReplyLog.day, createdAt: autoReplyLog.createdAt })
    .from(autoReplyLog)
    .where(eq(autoReplyLog.contactId, input.contactId))
    .orderBy(desc(autoReplyLog.id))
    .limit(1);
  if (last && (mode === 'daily' ? last.day === day : now.getTime() - last.createdAt.getTime() < AUTO_REPLY_COOLDOWN_MS)) return false;

  const [entry] = await db.insert(autoReplyLog).values({ contactId: input.contactId, day });
  const text = fillVariables(message, {
    salam: greetingFor(input.at),
    nama: input.contactName,
    jam_kerja: describeSchedule(settings.days),
  });
  try {
    const result = await sendToConversation(deps, input.conversationId, textSpec(text), { system: 'auto_reply' });
    await db.update(autoReplyLog).set({ messageId: Number(result.message.id) }).where(eq(autoReplyLog.id, entry.insertId));
    return !result.error;
  } catch (err) {
    deps.log?.warn({ err, conversationId: input.conversationId }, 'auto reply failed');
    return false;
  }
}
