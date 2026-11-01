export type MessageDirection = 'in' | 'out';
export type MessageStatus = 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
export type MediaStatus = 'pending' | 'ready' | 'failed' | 'expired';

export interface MediaDTO {
  id: string;
  mimeType: string | null;
  fileName: string | null;
  fileSize: number | null;
  status: MediaStatus;
  url: string;
}

export interface SenderDTO {
  type: 'user' | 'api' | 'system';
  id: string;
  name: string;
}

export interface MessageErrorDTO {
  code: number | null;
  title: string | null;
  detail: string | null;
  message: string;
}

export interface MessageDTO {
  id: string;
  conversationId: string;
  wamid: string | null;
  direction: MessageDirection;
  type: string;
  status: MessageStatus;
  text: string | null;
  payload: Record<string, unknown> | null;
  media: MediaDTO | null;
  replyTo: { wamid: string; preview: string | null; direction: MessageDirection | null } | null;
  reactionEmoji: string | null;
  templateName: string | null;
  sentBy: SenderDTO | null;
  clientRef: string | null;
  error: MessageErrorDTO | null;
  pricingCategory: string | null;
  timestamp: string;
}

export interface ContactDTO {
  id: string;
  waId: string;
  name: string;
  profileName: string | null;
  displayName: string | null;
  firstSeenAt: string;
}

export interface ConversationDTO {
  id: string;
  contact: ContactDTO;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: MessageDirection | null;
  lastInboundAt: string | null;
  cswExpiresAt: string | null;
  unreadCount: number;
}

/** Event real-time (SSE) dari server ke browser. */
export type RealtimeEvent =
  | { type: 'message.created'; message: MessageDTO; conversation: ConversationDTO }
  | { type: 'message.updated'; message: MessageDTO }
  | { type: 'conversation.updated'; conversation: ConversationDTO }
  | { type: 'connection.updated' }
  /** Data bersama berubah (balasan cepat, stiker, riwayat emoji, jam kerja); browser memuat ulang daftarnya. */
  | { type: 'library.updated'; resource: SharedResource };

export type SharedResource = 'quick-replies' | 'stickers' | 'emoji' | 'business-hours';

/** Nomor WhatsApp (format internasional tanpa +) menjadi bentuk yang enak dibaca. */
export function formatWaId(waId: string): string {
  if (waId.startsWith('62') && waId.length >= 10) {
    const rest = waId.slice(2);
    return `+62 ${rest.slice(0, 3)}-${rest.slice(3, 7)}-${rest.slice(7)}`.replace(/-$/, '');
  }
  return `+${waId}`;
}

const MEDIA_LABEL: Record<string, string> = {
  image: '📷 Foto',
  video: '🎥 Video',
  audio: '🎵 Audio',
  voice: '🎤 Pesan suara',
  document: '📄 Dokumen',
  sticker: '💟 Stiker',
  location: '📍 Lokasi',
  contacts: '👤 Kontak',
  order: '🛒 Pesanan',
};

/** Cuplikan satu baris untuk daftar percakapan. */
export function messagePreview(type: string, text: string | null, extra?: { voice?: boolean; fileName?: string | null }): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (type === 'text' || type === 'interactive' || type === 'button' || type === 'template') return clean || 'Pesan';
  const key = type === 'audio' && extra?.voice ? 'voice' : type;
  const label = MEDIA_LABEL[key];
  if (label) {
    const detail = clean || (type === 'document' ? (extra?.fileName ?? '') : '');
    return detail ? `${label}: ${detail}` : label;
  }
  if (type === 'reaction') return `Reaksi ${clean}`.trim();
  return clean || 'Pesan tidak didukung';
}
