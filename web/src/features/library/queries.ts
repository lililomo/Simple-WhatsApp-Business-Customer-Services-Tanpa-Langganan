import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BusinessHoursDTO, LabelBody, LabelWithUsageDTO, QuickReplyBody, QuickReplyDTO, RecentEmojiDTO, StickerDTO } from '@wa/shared';
import { api } from '@/lib/api';

// Kunci query sama dengan nama resource di event SSE "library.updated", sehingga semua browser ikut diperbarui.
export const libraryKeys = {
  quickReplies: ['quick-replies'] as const,
  stickers: ['stickers'] as const,
  recentEmoji: ['emoji', 'recent'] as const,
  businessHours: ['business-hours'] as const,
  labels: ['labels'] as const,
};

export function useQuickReplies() {
  return useQuery({
    queryKey: libraryKeys.quickReplies,
    queryFn: async () => (await api<{ quickReplies: QuickReplyDTO[] }>('/api/quick-replies')).quickReplies,
    staleTime: 5 * 60_000,
  });
}

export function useSaveQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: QuickReplyBody }) =>
      api<{ quickReply: QuickReplyDTO }>(id ? `/api/quick-replies/${id}` : '/api/quick-replies', { method: id ? 'PUT' : 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.quickReplies }),
  });
}

export function useDeleteQuickReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/quick-replies/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.quickReplies }),
  });
}

/** Catat pemakaian (untuk urutan "paling sering dipakai"); gagal tidak masalah. */
export function recordQuickReplyUse(id: string) {
  void api(`/api/quick-replies/${id}/use`, { method: 'POST' }).catch(() => undefined);
}

export function useStickers() {
  return useQuery({
    queryKey: libraryKeys.stickers,
    queryFn: async () => (await api<{ stickers: StickerDTO[] }>('/api/stickers')).stickers,
    staleTime: 5 * 60_000,
  });
}

export function useRecentEmoji() {
  return useQuery({
    queryKey: libraryKeys.recentEmoji,
    queryFn: async () => (await api<RecentEmojiDTO>('/api/emoji/recent')).emojis,
    staleTime: 5 * 60_000,
  });
}

export function useBusinessHours() {
  return useQuery({ queryKey: libraryKeys.businessHours, queryFn: () => api<BusinessHoursDTO>('/api/business-hours') });
}

export function useLabels() {
  return useQuery({
    queryKey: libraryKeys.labels,
    queryFn: async () => (await api<{ labels: LabelWithUsageDTO[] }>('/api/labels')).labels,
    staleTime: 5 * 60_000,
  });
}

/** Simpan label; daftar label dan percakapan diperbarui lewat event SSE "library.updated". */
export function useSaveLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: LabelBody }) =>
      api(id ? `/api/labels/${id}` : '/api/labels', { method: id ? 'PUT' : 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.labels }),
  });
}

export function useDeleteLabel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/labels/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.labels }),
  });
}
