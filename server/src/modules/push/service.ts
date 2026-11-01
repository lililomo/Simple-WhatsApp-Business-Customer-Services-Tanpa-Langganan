import { and, eq, gt } from 'drizzle-orm';
import webpush from 'web-push';
import type { ConversationDTO, PushPayload, PushSubscribeBody } from '@wa/shared';
import { pushSubscriptions, sessions, users } from '../../db/schema';
import { decrypt, encrypt, sha256Hex } from '../../lib/crypto';
import { getSetting, setSetting } from '../../lib/settings';
import type { AppDeps } from '../../types';

const VAPID_KEY = 'vapid';

interface StoredVapid {
  publicKey: string;
  privateKeyEnc: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Kunci VAPID dibuat sekali lalu disimpan terenkripsi; tidak perlu diatur di .env. */
export async function getVapidKeys(deps: AppDeps): Promise<VapidKeys> {
  const { db } = deps.database;
  const stored = await getSetting<StoredVapid | null>(db, VAPID_KEY, null);
  if (stored) return { publicKey: stored.publicKey, privateKey: decrypt(stored.privateKeyEnc, deps.config.appKey) };
  const keys = webpush.generateVAPIDKeys();
  await setSetting(db, VAPID_KEY, { publicKey: keys.publicKey, privateKeyEnc: encrypt(keys.privateKey, deps.config.appKey) });
  // Bila dua request membuat kunci bersamaan, pakai yang tersimpan terakhir.
  return getVapidKeys(deps);
}

export async function subscribe(deps: AppDeps, userId: number, sessionTokenHash: string, body: PushSubscribeBody, userAgent?: string) {
  const { db } = deps.database;
  const [session] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.tokenHash, sessionTokenHash)).limit(1);
  if (!session) return;
  const row = {
    userId,
    sessionId: session.id,
    endpointHash: sha256Hex(body.endpoint),
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
    userAgent: userAgent?.slice(0, 255) ?? null,
  };
  // Endpoint yang sama bisa berpindah sesi (login ulang di browser yang sama).
  await db.insert(pushSubscriptions).values(row).onDuplicateKeyUpdate({ set: row });
}

export async function unsubscribe(deps: AppDeps, endpoint: string) {
  await deps.database.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, sha256Hex(endpoint)));
}

export type PushSender = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapid: VapidKeys,
) => Promise<unknown>;

export const webPushSender =
  (subject: string): PushSender =>
  (subscription, payload, vapid) =>
    webpush.sendNotification(subscription, payload, {
      vapidDetails: { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 60 * 60,
      urgency: 'high',
    });

/** Kirim notifikasi ke browser yang berlangganan (sesi masih berlaku, pengguna aktif). */
export async function sendPush(deps: AppDeps, payload: PushPayload, send: PushSender, onlyUserId?: number): Promise<number> {
  const { db } = deps.database;
  const subs = await db
    .select({ sub: pushSubscriptions })
    .from(pushSubscriptions)
    .innerJoin(sessions, eq(sessions.id, pushSubscriptions.sessionId))
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(and(gt(sessions.expiresAt, new Date()), eq(users.isActive, true), onlyUserId ? eq(users.id, onlyUserId) : undefined));
  if (subs.length === 0) return 0;
  const vapid = await getVapidKeys(deps);
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async ({ sub }) => {
      try {
        await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, vapid);
        sent++;
        await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: langganan sudah dicabut browser.
        if (status === 404 || status === 410) await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        else deps.log?.warn({ err: (err as Error).message, status }, 'web push failed');
      }
    }),
  );
  return sent;
}

export function messagePushPayload(conversation: ConversationDTO): PushPayload {
  return {
    title: conversation.contact.name,
    body: conversation.lastMessagePreview ?? 'Pesan baru',
    conversationId: conversation.id,
    url: `/chats/${conversation.id}`,
  };
}

/** Kirim notifikasi Windows/Android untuk setiap pesan masuk baru. */
export class PushNotifier {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly deps: AppDeps,
    private readonly send: PushSender = webPushSender(deps.config.APP_URL),
  ) {}

  start() {
    this.unsubscribe = this.deps.bus.on((event) => {
      if (event.type !== 'message.created' || event.message.direction !== 'in') return;
      void sendPush(this.deps, messagePushPayload(event.conversation), this.send).catch((err: unknown) =>
        this.deps.log?.warn({ err }, 'web push dispatch failed'),
      );
    });
  }

  stop() {
    this.unsubscribe?.();
  }
}
