import { asc, eq } from 'drizzle-orm';
import type {
  ConnectionCheckItem,
  ConnectionDTO,
  PhoneNumberInfo,
  ValidateConnectionResult,
} from '@wa/shared';
import { waAccounts } from '../../db/schema';
import { decrypt, encrypt, randomBase62 } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { GraphClient, GraphError } from '../../meta/graph-client';
import type { AppDeps } from '../../types';

export type WaAccount = typeof waAccounts.$inferSelect;

const PHONE_FIELDS = 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status';
const WEBHOOK_STALE_MS = 7 * 24 * 60 * 60 * 1000;

interface MetaPhone {
  id: string;
  display_phone_number: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  platform_type?: string;
  status?: string;
}

export function graphClient(deps: AppDeps, token: string): GraphClient {
  return new GraphClient(token, { version: deps.config.GRAPH_API_VERSION, fetch: deps.fetch });
}

export function accountGraph(deps: AppDeps, account: WaAccount): GraphClient {
  return graphClient(deps, decrypt(account.accessTokenEnc, deps.config.appKey));
}

export async function getAccount(deps: AppDeps): Promise<WaAccount | undefined> {
  const [row] = await deps.database.db.select().from(waAccounts).orderBy(asc(waAccounts.id)).limit(1);
  return row;
}

export async function requireAccount(deps: AppDeps): Promise<WaAccount> {
  const account = await getAccount(deps);
  if (!account) throw new AppError(409, 'not_connected', 'Nomor WhatsApp belum terhubung. Admin perlu mengaturnya di Pengaturan → WhatsApp.');
  return account;
}

/** Ubah GraphError menjadi AppError yang aman ditampilkan. */
export function metaToAppError(err: unknown, override?: string): AppError {
  if (err instanceof GraphError) {
    const status = err.httpStatus >= 400 && err.httpStatus < 500 ? 400 : 502;
    return new AppError(status, 'meta_error', override ?? err.message, {
      metaCode: err.code,
      metaSubcode: err.subcode,
      metaDetails: err.details,
      fbtraceId: err.fbtraceId,
    });
  }
  return err instanceof AppError ? err : new AppError(502, 'meta_error', 'Permintaan ke Meta gagal.');
}

/** Tandai akun bermasalah bila token ditolak Meta (kode 190), lalu teruskan error-nya. */
export async function noteTokenError(deps: AppDeps, account: WaAccount, err: unknown): Promise<void> {
  if (err instanceof GraphError && err.code === 190) {
    await deps.database.db
      .update(waAccounts)
      .set({ status: 'error', lastError: err.message })
      .where(eq(waAccounts.id, account.id));
    deps.bus.emit({ type: 'connection.updated' });
  }
}

function toPhoneInfo(p: MetaPhone): PhoneNumberInfo {
  return {
    id: p.id,
    displayPhoneNumber: p.display_phone_number,
    verifiedName: p.verified_name ?? null,
    qualityRating: p.quality_rating ?? null,
    codeVerificationStatus: p.code_verification_status ?? null,
    platformType: p.platform_type ?? null,
    status: p.status ?? null,
  };
}

export async function validateCredentials(
  deps: AppDeps,
  input: { appId: string; appSecret: string; wabaId: string; accessToken: string },
): Promise<ValidateConnectionResult> {
  // App access token "APP_ID|APP_SECRET" hanya diterima Meta jika pasangan ID dan secret cocok.
  const app = await graphClient(deps, `${input.appId}|${input.appSecret}`)
    .get<{ id: string; name?: string }>(input.appId, { fields: 'id,name' })
    .catch((err) => {
      throw metaToAppError(err, 'App ID atau App Secret salah.');
    });

  const graph = graphClient(deps, input.accessToken);
  try {
    const waba = await graph.get<{ id: string; name?: string; currency?: string; timezone_id?: string }>(input.wabaId, {
      fields: 'id,name,currency,timezone_id',
    });
    const phones = await graph.get<{ data: MetaPhone[] }>(`${input.wabaId}/phone_numbers`, {
      fields: PHONE_FIELDS,
      limit: 100,
    });
    return {
      app: { id: app.id, name: app.name ?? null },
      waba: { id: waba.id, name: waba.name ?? null, currency: waba.currency ?? null, timezoneId: waba.timezone_id ?? null },
      phoneNumbers: phones.data.map(toPhoneInfo),
    };
  } catch (err) {
    throw metaToAppError(err);
  }
}

export async function saveConnection(
  deps: AppDeps,
  input: { label?: string; appId: string; appSecret?: string; wabaId: string; accessToken?: string; phoneNumberId: string },
): Promise<WaAccount> {
  const { db } = deps.database;
  const { appKey } = deps.config;
  const existing = await getAccount(deps);
  const appSecret = input.appSecret || (existing && decrypt(existing.appSecretEnc, appKey));
  const accessToken = input.accessToken || (existing && decrypt(existing.accessTokenEnc, appKey));
  if (!appSecret) throw new AppError(400, 'missing_app_secret', 'App Secret wajib diisi.');
  if (!accessToken) throw new AppError(400, 'missing_token', 'System user access token wajib diisi.');

  const result = await validateCredentials(deps, { appId: input.appId, appSecret, wabaId: input.wabaId, accessToken });
  const phone = result.phoneNumbers.find((p) => p.id === input.phoneNumberId);
  if (!phone) throw new AppError(400, 'phone_not_in_waba', 'Nomor yang dipilih tidak ada di WABA ini.');

  const values = {
    label: input.label || phone.verifiedName || phone.displayPhoneNumber,
    appId: input.appId,
    appSecretEnc: encrypt(appSecret, appKey),
    wabaId: input.wabaId,
    phoneNumberId: phone.id,
    displayPhoneNumber: phone.displayPhoneNumber,
    verifiedName: phone.verifiedName,
    qualityRating: phone.qualityRating,
    accessTokenEnc: encrypt(accessToken, appKey),
    tokenLast4: accessToken.slice(-4),
    status: 'active' as const,
    lastError: null,
  };
  if (existing) {
    await db.update(waAccounts).set(values).where(eq(waAccounts.id, existing.id));
  } else {
    await db.insert(waAccounts).values({ ...values, verifyToken: randomBase62(32) });
  }
  return (await getAccount(deps))!;
}

export async function listPhoneNumbers(deps: AppDeps, account: WaAccount): Promise<PhoneNumberInfo[]> {
  try {
    const res = await accountGraph(deps, account).get<{ data: MetaPhone[] }>(`${account.wabaId}/phone_numbers`, {
      fields: PHONE_FIELDS,
      limit: 100,
    });
    return res.data.map(toPhoneInfo);
  } catch (err) {
    await noteTokenError(deps, account, err);
    throw metaToAppError(err);
  }
}

/** Cek token, langganan webhook app ke WABA, status nomor, dan webhook terakhir yang diterima. */
export async function checkConnection(deps: AppDeps, account: WaAccount): Promise<ConnectionCheckItem[]> {
  const graph = accountGraph(deps, account);
  const items: ConnectionCheckItem[] = [];
  const changes: Partial<typeof waAccounts.$inferInsert> = {};

  let phone: MetaPhone | undefined;
  try {
    phone = await graph.get<MetaPhone>(account.phoneNumberId, { fields: PHONE_FIELDS });
    items.push({ key: 'credentials', ok: true, message: 'Token valid dan punya akses ke nomor.' });
    Object.assign(changes, {
      status: 'active',
      lastError: null,
      displayPhoneNumber: phone.display_phone_number,
      verifiedName: phone.verified_name ?? account.verifiedName,
      qualityRating: phone.quality_rating ?? null,
    });
  } catch (err) {
    await noteTokenError(deps, account, err);
    items.push({ key: 'credentials', ok: false, message: metaToAppError(err).message });
  }

  if (phone) {
    try {
      await graph.post(`${account.wabaId}/subscribed_apps`);
      const subs = await graph.get<{ data: { whatsapp_business_api_data?: { id?: string } }[] }>(
        `${account.wabaId}/subscribed_apps`,
      );
      const subscribed = subs.data.some((s) => s.whatsapp_business_api_data?.id === account.appId);
      if (subscribed) changes.subscribedAt = new Date();
      items.push({
        key: 'subscription',
        ok: subscribed,
        message: subscribed
          ? 'App ter-subscribe ke WABA; Meta akan mengirim webhook ke aplikasi ini.'
          : 'Subscribe berhasil dikirim, tetapi App ID ini belum muncul di daftar subscribed_apps.',
      });
    } catch (err) {
      items.push({ key: 'subscription', ok: false, message: metaToAppError(err).message });
    }

    const onCloud = phone.platform_type === 'CLOUD_API';
    // code_verification_status hanya relevan saat mendaftarkan nomor; nomor lama yang sudah CONNECTED wajar berstatus EXPIRED.
    const connected = phone.status === undefined || phone.status === 'CONNECTED';
    items.push({
      key: 'phone',
      ok: onCloud,
      warning: onCloud && !connected,
      message: !onCloud
        ? `Nomor belum terdaftar di Cloud API (platform: ${phone.platform_type ?? 'tidak diketahui'}). Daftarkan dengan PIN.`
        : connected
          ? `Nomor aktif di Cloud API${phone.status ? ` (status ${phone.status})` : ''}.`
          : `Nomor terdaftar di Cloud API tetapi berstatus ${phone.status}. Periksa di WhatsApp Manager.`,
    });
  }

  const last = account.lastWebhookAt;
  const fresh = last !== null && Date.now() - last.getTime() < WEBHOOK_STALE_MS;
  items.push({
    key: 'webhook',
    ok: fresh,
    warning: !fresh,
    message: fresh
      ? `Webhook terakhir diterima ${last!.toISOString()}.`
      : last
        ? 'Tidak ada webhook dalam 7 hari terakhir. Pastikan konfigurasi webhook di Meta App masih benar.'
        : 'Belum ada webhook diterima. Simpan Callback URL & Verify Token di Meta App, subscribe field "messages", lalu kirim pesan uji dari HP.',
  });

  if (Object.keys(changes).length > 0) {
    await deps.database.db.update(waAccounts).set(changes).where(eq(waAccounts.id, account.id));
  }
  return items;
}

export async function registerPhone(deps: AppDeps, account: WaAccount, pin: string): Promise<void> {
  try {
    await accountGraph(deps, account).post(`${account.phoneNumberId}/register`, { messaging_product: 'whatsapp', pin });
  } catch (err) {
    await noteTokenError(deps, account, err);
    throw metaToAppError(err);
  }
}

export function toConnectionDTO(account: WaAccount, appUrl: string): ConnectionDTO {
  return {
    id: String(account.id),
    label: account.label,
    appId: account.appId,
    wabaId: account.wabaId,
    phoneNumberId: account.phoneNumberId,
    displayPhoneNumber: account.displayPhoneNumber,
    verifiedName: account.verifiedName,
    qualityRating: account.qualityRating,
    messagingLimit: account.messagingLimit,
    tokenLast4: account.tokenLast4,
    status: account.status,
    lastError: account.lastError,
    lastWebhookAt: account.lastWebhookAt?.toISOString() ?? null,
    subscribedAt: account.subscribedAt?.toISOString() ?? null,
    callbackUrl: `${appUrl.replace(/\/$/, '')}/webhooks/meta`,
    verifyToken: account.verifyToken,
  };
}
