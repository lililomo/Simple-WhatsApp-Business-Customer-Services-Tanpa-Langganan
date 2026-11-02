import { z } from 'zod';
import type { ConversationDTO, MessageDTO } from './messages';

export const conversationFilter = z.enum(['all', 'unread', 'open']);
export type ConversationFilter = z.infer<typeof conversationFilter>;

export const listConversationsQuery = z.object({
  filter: conversationFilter.default('all'),
  q: z.string().trim().max(100).optional(),
  /** Hanya percakapan dengan kontak berlabel ini. */
  label: z.coerce.number().int().positive().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const listMessagesQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const updateContactBody = z.object({
  displayName: z.string().trim().max(190).nullable(),
});

export interface ConversationPage {
  conversations: ConversationDTO[];
  nextCursor: string | null;
}

export interface MessagePage {
  messages: MessageDTO[];
  hasMore: boolean;
}

export interface InboxSummary {
  unreadConversations: number;
  unreadMessages: number;
}

/** Sisa jendela layanan 24 jam dalam milidetik (0 jika tertutup atau belum pernah dibuka). */
export function windowRemainingMs(cswExpiresAt: string | null, now = Date.now()): number {
  if (!cswExpiresAt) return 0;
  return Math.max(0, new Date(cswExpiresAt).getTime() - now);
}
