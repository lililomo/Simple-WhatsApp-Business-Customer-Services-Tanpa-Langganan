// Bentuk payload webhook WhatsApp Cloud API (hanya field yang dipakai aplikasi).

export interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}

export interface WebhookEntry {
  id: string; // WABA ID
  changes?: { field: string; value: Record<string, unknown> }[];
}

export interface MessagesValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: InboundMessage[];
  statuses?: StatusUpdate[];
}

export interface MediaRef {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
  animated?: boolean;
}

export interface InboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  context?: { from?: string; id?: string; forwarded?: boolean; frequently_forwarded?: boolean };
  text?: { body: string };
  image?: MediaRef;
  video?: MediaRef;
  audio?: MediaRef;
  document?: MediaRef;
  sticker?: MediaRef;
  location?: { latitude: number; longitude: number; name?: string; address?: string; url?: string };
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string; wa_id?: string }[] }[];
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
    nfm_reply?: { body?: string; name?: string; response_json?: string };
  };
  button?: { text: string; payload?: string };
  reaction?: { message_id: string; emoji?: string };
  order?: { catalog_id?: string; text?: string };
  system?: { body?: string; type?: string };
  errors?: MetaStatusError[];
}

export interface MetaStatusError {
  code: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}

export interface StatusUpdate {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | string;
  timestamp: string;
  recipient_id?: string;
  errors?: MetaStatusError[];
  pricing?: { billable?: boolean; category?: string; pricing_model?: string; type?: string; subtype?: string };
}

export const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
