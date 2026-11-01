import { useInfiniteQuery, useMutation, useQuery, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import {
  windowRemainingMs,
  type ConversationDTO,
  type ConversationFilter,
  type ConversationPage,
  type InboxSummary,
  type MessageDTO,
  type MessagePage,
} from '@wa/shared';
import { api } from '@/lib/api';

export const keys = {
  conversations: (filter: ConversationFilter, q: string) => ['conversations', filter, q] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  summary: ['inbox-summary'] as const,
};

export function useConversations(filter: ConversationFilter, q: string) {
  return useInfiniteQuery({
    queryKey: keys.conversations(filter, q),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ filter });
      if (q) params.set('q', q);
      if (pageParam) params.set('cursor', pageParam);
      return api<ConversationPage>(`/api/conversations?${params}`);
    },
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: keys.conversation(id ?? ''),
    queryFn: async () => (await api<{ conversation: ConversationDTO }>(`/api/conversations/${id}`)).conversation,
    enabled: !!id,
  });
}

export function useMessages(conversationId: string) {
  return useInfiniteQuery({
    queryKey: keys.messages(conversationId),
    queryFn: ({ pageParam }) =>
      api<MessagePage>(`/api/conversations/${conversationId}/messages?limit=50${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: '' as string,
    // Halaman disusun dari terbaru ke terlama; halaman berikutnya = pesan lebih lama.
    getNextPageParam: (last) => (last.hasMore && last.messages[0] ? last.messages[0].id : undefined),
    staleTime: 5 * 60_000,
  });
}

export function useInboxSummary() {
  return useQuery({ queryKey: keys.summary, queryFn: () => api<InboxSummary>('/api/conversations/summary') });
}

export function useMarkRead() {
  return useMutation({ mutationFn: (id: string) => api(`/api/conversations/${id}/read`, { method: 'POST' }) });
}

/** Pesan dari halaman infinite query, urut lama → baru. */
export function flattenMessages(data: InfiniteData<MessagePage> | undefined): MessageDTO[] {
  if (!data) return [];
  return [...data.pages].reverse().flatMap((p) => p.messages);
}

function matchesFilter(conv: ConversationDTO, filter: ConversationFilter): boolean {
  if (filter === 'unread') return conv.unreadCount > 0;
  if (filter === 'open') return windowRemainingMs(conv.cswExpiresAt) > 0;
  return true;
}

/** Perbarui percakapan di semua daftar yang sedang dimuat. moveToTop untuk pesan baru. */
export function applyConversation(qc: QueryClient, conv: ConversationDTO, moveToTop: boolean) {
  qc.setQueryData(keys.conversation(conv.id), conv);
  for (const [key, data] of qc.getQueriesData<InfiniteData<ConversationPage>>({ queryKey: ['conversations'] })) {
    if (!data) continue;
    const [, filter, q] = key as unknown as [string, ConversationFilter, string];
    const exists = data.pages.some((p) => p.conversations.some((c) => c.id === conv.id));
    let pages = data.pages.map((p) => ({ ...p, conversations: p.conversations.filter((c) => c.id !== conv.id) }));
    const keep = matchesFilter(conv, filter);
    if (keep && (exists || (moveToTop && !q))) {
      if (moveToTop || !exists) {
        pages = pages.map((p, i) => (i === 0 ? { ...p, conversations: [conv, ...p.conversations] } : p));
      } else {
        pages = data.pages.map((p) => ({ ...p, conversations: p.conversations.map((c) => (c.id === conv.id ? conv : c)) }));
      }
    }
    qc.setQueryData(key, { ...data, pages });
  }
}

/** Tambah atau ganti pesan di cache percakapan (cocokkan id, atau clientRef untuk pesan optimistis). */
export function upsertMessage(qc: QueryClient, msg: MessageDTO) {
  qc.setQueryData<InfiniteData<MessagePage>>(keys.messages(msg.conversationId), (data) => {
    if (!data) return data;
    const same = (m: MessageDTO) => m.id === msg.id || (!!msg.clientRef && m.clientRef === msg.clientRef);
    const found = data.pages.some((p) => p.messages.some(same));
    if (found) {
      return { ...data, pages: data.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (same(m) ? msg : m)) })) };
    }
    const [first, ...rest] = data.pages;
    if (!first) return data;
    return { ...data, pages: [{ ...first, messages: [...first.messages, msg] }, ...rest] };
  });
}
