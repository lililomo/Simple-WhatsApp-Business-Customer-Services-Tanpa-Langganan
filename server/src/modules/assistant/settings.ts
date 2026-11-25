import { and, eq, gte, sum } from 'drizzle-orm';
import {
  assistantSettings,
  type AosProvider,
  type AosProviderStatus,
  type AssistantSettings,
  type AssistantSettingsDTO,
  type AssistantStatusDTO,
} from '@wa/shared';
import { aiCalls } from '../../db/schema';
import { decrypt, encrypt } from '../../lib/crypto';
import { getSetting, setSetting } from '../../lib/settings';
import type { AppDeps } from '../../types';
import { localParts } from '../business-hours/schedule';
import { monthStartWib } from '../stats/service';

const SETTINGS_KEY = 'assistant';
const CREDENTIALS_KEY = 'assistant_credentials';
const STATE_KEY = 'assistant_provider_state';

export const PROVIDERS: AosProvider[] = ['subscription', 'api'];

interface StoredCredential {
  enc: string;
  last4: string;
}
type StoredCredentials = Partial<Record<AosProvider, StoredCredential>>;

export interface ProviderState {
  state: 'ok' | 'cooldown' | 'rejected' | 'unknown';
  cooldownUntil: string | null;
  lastError: string | null;
  lastUsedAt: string | null;
}
type StoredState = Partial<Record<AosProvider, ProviderState>>;

const EMPTY_STATE: ProviderState = { state: 'unknown', cooldownUntil: null, lastError: null, lastUsedAt: null };

export async function loadSettings(deps: AppDeps): Promise<AssistantSettings> {
  const raw = await getSetting<unknown>(deps.database.db, SETTINGS_KEY, {});
  const parsed = assistantSettings.safeParse(raw);
  // Pengaturan lama yang tidak lagi cocok dengan skema tidak boleh mematikan aplikasi: kembali ke bawaan.
  return parsed.success ? parsed.data : assistantSettings.parse({});
}

export async function saveSettings(deps: AppDeps, settings: AssistantSettings, userId: number): Promise<void> {
  // Jalur yang tidak disebut ditaruh di belakang agar urutan selalu memuat keduanya.
  const order = [...new Set([...settings.order, ...PROVIDERS])];
  await setSetting(deps.database.db, SETTINGS_KEY, { ...settings, order }, userId);
}

async function storedCredentials(deps: AppDeps): Promise<StoredCredentials> {
  return getSetting<StoredCredentials>(deps.database.db, CREDENTIALS_KEY, {});
}

/** Kredensial yang sudah didekripsi. Hanya dipakai untuk memanggil Claude; tidak pernah dikirim ke browser atau dicatat. */
export async function loadCredentials(deps: AppDeps): Promise<Partial<Record<AosProvider, string>>> {
  const stored = await storedCredentials(deps);
  const out: Partial<Record<AosProvider, string>> = {};
  for (const provider of PROVIDERS) {
    const item = stored[provider];
    if (!item) continue;
    try {
      out[provider] = decrypt(item.enc, deps.config.appKey);
    } catch {
      // APP_KEY berganti: kredensial lama tidak terbaca dan dianggap belum terhubung.
    }
  }
  return out;
}

export async function setCredential(deps: AppDeps, provider: AosProvider, secret: string, userId: number): Promise<void> {
  const stored = await storedCredentials(deps);
  stored[provider] = { enc: encrypt(secret, deps.config.appKey), last4: secret.slice(-4) };
  await setSetting(deps.database.db, CREDENTIALS_KEY, stored, userId);
  await patchProviderState(deps, provider, { ...EMPTY_STATE });
}

export async function removeCredential(deps: AppDeps, provider: AosProvider, userId: number): Promise<void> {
  const stored = await storedCredentials(deps);
  delete stored[provider];
  await setSetting(deps.database.db, CREDENTIALS_KEY, stored, userId);
  await patchProviderState(deps, provider, { ...EMPTY_STATE });
}

export async function loadProviderState(deps: AppDeps): Promise<Record<AosProvider, ProviderState>> {
  const stored = await getSetting<StoredState>(deps.database.db, STATE_KEY, {});
  const now = Date.now();
  const out = {} as Record<AosProvider, ProviderState>;
  for (const provider of PROVIDERS) {
    const s = { ...EMPTY_STATE, ...stored[provider] };
    // Masa istirahat yang sudah lewat tidak lagi berlaku.
    if (s.state === 'cooldown' && (!s.cooldownUntil || new Date(s.cooldownUntil).getTime() <= now)) {
      s.state = 'unknown';
      s.cooldownUntil = null;
    }
    out[provider] = s;
  }
  return out;
}

// Perubahan status ditulis berurutan agar dua panggilan yang selesai bersamaan tidak saling menimpa.
let stateWrites: Promise<unknown> = Promise.resolve();

export function patchProviderState(deps: AppDeps, provider: AosProvider, patch: Partial<ProviderState>): Promise<void> {
  const run = async () => {
    const stored = await getSetting<StoredState>(deps.database.db, STATE_KEY, {});
    stored[provider] = { ...EMPTY_STATE, ...stored[provider], ...patch };
    await setSetting(deps.database.db, STATE_KEY, stored);
  };
  const next = stateWrites.then(run, run);
  stateWrites = next.catch(() => undefined);
  return next;
}

/** Awal bulan berjalan menurut WIB. */
export function currentMonthStart(now = new Date()): Date {
  const [y, m] = localParts(now).day.split('-').map(Number) as [number, number];
  return monthStartWib(y, m);
}

/** Biaya jalur API bulan berjalan (USD). Jalur langganan tidak ditagih per pemakaian, jadi tidak dihitung. */
export async function monthApiCostUsd(deps: AppDeps): Promise<number> {
  const [row] = await deps.database.db
    .select({ total: sum(aiCalls.costMicroUsd) })
    .from(aiCalls)
    .where(and(eq(aiCalls.provider, 'api'), gte(aiCalls.createdAt, currentMonthStart())));
  return Number(row?.total ?? 0) / 1_000_000;
}

export async function providerStatuses(deps: AppDeps): Promise<AosProviderStatus[]> {
  const [stored, state, settings] = await Promise.all([storedCredentials(deps), loadProviderState(deps), loadSettings(deps)]);
  const order = [...new Set([...settings.order, ...PROVIDERS])];
  return order.map((provider) => ({
    provider,
    connected: !!stored[provider],
    last4: stored[provider]?.last4 ?? null,
    ...state[provider],
  }));
}

export async function assistantReady(deps: AppDeps): Promise<{ ready: boolean; settings: AssistantSettings }> {
  const [settings, stored] = await Promise.all([loadSettings(deps), storedCredentials(deps)]);
  return { ready: settings.enabled && PROVIDERS.some((p) => !!stored[p]), settings };
}

export async function statusDTO(deps: AppDeps): Promise<AssistantStatusDTO> {
  const { ready, settings } = await assistantReady(deps);
  return { ready, mode: settings.triage.enabled ? settings.triage.mode : 'manual' };
}

export async function settingsDTO(deps: AppDeps): Promise<AssistantSettingsDTO> {
  const [settings, providers, monthCostUsd] = await Promise.all([loadSettings(deps), providerStatuses(deps), monthApiCostUsd(deps)]);
  const order = [...new Set([...settings.order, ...PROVIDERS])];
  return {
    settings: { ...settings, order },
    providers,
    ready: settings.enabled && providers.some((p) => p.connected),
    monthCostUsd,
  };
}
