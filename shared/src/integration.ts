import { z } from 'zod';
import { templateParams } from './templates';
import { TEXT_MAX, CAPTION_MAX } from './send';

export const API_SCOPES = ['messages:send', 'messages:read', 'conversations:read', 'templates:read', 'media:write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SCOPE_LABEL: Record<ApiScope, string> = {
  'messages:send': 'Kirim pesan',
  'messages:read': 'Baca pesan & media',
  'conversations:read': 'Baca percakapan & kontak',
  'templates:read': 'Baca template',
  'media:write': 'Unggah media',
};

export interface ApiKeyDTO {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export const createApiKeyBody = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Pilih minimal satu izin'),
});

export const WEBHOOK_EVENTS = ['message.received', 'message.sent', 'message.status'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface OutboundWebhookDTO {
  id: string;
  name: string;
  url: string;
  events: WebhookEventType[];
  isActive: boolean;
  failureCount: number;
  createdAt: string;
}

export interface WebhookDeliveryDTO {
  id: string;
  eventId: string;
  eventType: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  responseCode: number | null;
  responseSnippet: string | null;
  nextAttemptAt: string;
  createdAt: string;
  deliveredAt: string | null;
}

export const outboundWebhookBody = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(120),
  url: z.url('URL tidak valid').max(500),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Pilih minimal satu event'),
  isActive: z.boolean().optional(),
});

/** Body POST /api/v1/messages. */
export const apiSendMessageBody = z
  .object({
    to: z.string().trim().min(8).max(24).describe('Nomor tujuan: 08…, 62…, atau +62…'),
    type: z.enum(['text', 'template', 'image', 'document', 'audio', 'video']),
    text: z.string().trim().min(1).max(TEXT_MAX).optional().describe('Wajib untuk type=text'),
    template: z
      .object({
        name: z.string().min(1),
        language: z.string().min(2).default('id'),
        params: templateParams.default({}),
      })
      .optional()
      .describe('Wajib untuk type=template'),
    media: z
      .object({
        mediaId: z.string().regex(/^\d+$/).optional().describe('ID dari POST /api/v1/media'),
        link: z.url().optional().describe('URL HTTPS publik; dipakai jika mediaId kosong'),
        caption: z.string().trim().max(CAPTION_MAX).optional(),
        filename: z.string().trim().max(255).optional(),
      })
      .optional()
      .describe('Wajib untuk type=image|document|audio|video'),
    replyTo: z.string().optional().describe('ID pesan internal atau wamid yang dibalas'),
    clientRef: z.string().trim().max(64).optional().describe('ID dari sistem pemanggil'),
  })
  .superRefine((b, ctx) => {
    if (b.type === 'text' && !b.text) ctx.addIssue({ code: 'custom', path: ['text'], message: 'text wajib diisi untuk type=text' });
    if (b.type === 'template' && !b.template) ctx.addIssue({ code: 'custom', path: ['template'], message: 'template wajib diisi untuk type=template' });
    if (['image', 'document', 'audio', 'video'].includes(b.type) && !b.media?.mediaId && !b.media?.link) {
      ctx.addIssue({ code: 'custom', path: ['media'], message: 'media.mediaId atau media.link wajib diisi' });
    }
  });
export type ApiSendMessageBody = z.infer<typeof apiSendMessageBody>;
