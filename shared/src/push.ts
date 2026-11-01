import { z } from 'zod';

/** Bentuk PushSubscription.toJSON() dari browser. */
export const pushSubscribeBody = z.object({
  endpoint: z.url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(255), auth: z.string().min(1).max(255) }),
});
export type PushSubscribeBody = z.infer<typeof pushSubscribeBody>;

export const pushUnsubscribeBody = z.object({ endpoint: z.url().max(2000) });

/** Isi notifikasi yang dikirim ke service worker. */
export interface PushPayload {
  title: string;
  body: string;
  conversationId: string;
  url: string;
}
