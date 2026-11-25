import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AosConnectionTestDTO,
  AosLoginStartDTO,
  AosPlaygroundDTO,
  AosProvider,
  AosUsageDTO,
  AssistantSettings,
  AssistantSettingsDTO,
} from '@wa/shared';
import { api } from '@/lib/api';

// Awalan kunci sama dengan resource "assistant" di event SSE "library.updated", jadi admin lain ikut diperbarui.
export const assistantKeys = {
  all: ['assistant'] as const,
  settings: ['assistant', 'settings'] as const,
  usage: (month: string) => ['assistant', 'usage', month] as const,
};

export function useAssistantSettings() {
  return useQuery({
    queryKey: assistantKeys.settings,
    queryFn: ({ signal }) => api<AssistantSettingsDTO>('/api/assistant/settings', { signal }),
  });
}

/** Menyimpan seluruh pengaturan sekaligus; server membalas keadaan terbaru. */
export function useSaveAssistantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: AssistantSettings) =>
      api<AssistantSettingsDTO>('/api/assistant/settings', { method: 'PUT', body: settings }),
    onSuccess: (dto) => qc.setQueryData(assistantKeys.settings, dto),
  });
}

/** Menyimpan token/kunci satu jalur. Nilainya hanya dikirim, tidak pernah diterima kembali dari server. */
export function useSetCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, secret }: { provider: AosProvider; secret: string }) =>
      api<AssistantSettingsDTO>(`/api/assistant/credentials/${provider}`, {
        method: 'PUT',
        body: { secret },
      }),
    onSuccess: (dto) => qc.setQueryData(assistantKeys.settings, dto),
  });
}

/** Minta server menyiapkan tautan login Claude untuk jalur langganan (beberapa detik). */
export function useStartSubscriptionLogin() {
  return useMutation({
    mutationFn: () => api<AosLoginStartDTO>('/api/assistant/credentials/subscription/login', { method: 'POST' }),
  });
}

/** Kirim kode dari halaman login Claude; server menukarnya menjadi token dan menyimpannya. */
export function useFinishSubscriptionLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api<AssistantSettingsDTO>('/api/assistant/credentials/subscription/login/code', { method: 'POST', body: { code } }),
    onSuccess: (dto) => qc.setQueryData(assistantKeys.settings, dto),
  });
}

/** Hentikan sesi login yang belum selesai (dialog ditutup). Gagal pun tidak apa: sesi berakhir sendiri. */
export function cancelSubscriptionLogin(): void {
  void api('/api/assistant/credentials/subscription/login', { method: 'DELETE' }).catch(() => undefined);
}

export function useRemoveCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AosProvider) =>
      api<AssistantSettingsDTO>(`/api/assistant/credentials/${provider}`, { method: 'DELETE' }),
    onSuccess: (dto) => qc.setQueryData(assistantKeys.settings, dto),
  });
}

export function useTestCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (provider: AosProvider) =>
      api<AosConnectionTestDTO>(`/api/assistant/credentials/${provider}/test`, { method: 'POST' }),
    // Hasil uji mengubah status jalur (terhubung/ditolak) di server.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: assistantKeys.settings });
    },
  });
}

export function useAssistantUsage(month: string) {
  return useQuery({
    queryKey: assistantKeys.usage(month),
    queryFn: ({ signal }) =>
      api<AosUsageDTO>(`/api/assistant/usage?month=${encodeURIComponent(month)}`, { signal }),
  });
}

/** Jawaban percobaan dengan pengaturan yang tersimpan; bisa makan waktu sampai satu menit. */
export function usePlayground() {
  return useMutation({
    mutationFn: (text: string) =>
      api<AosPlaygroundDTO>('/api/assistant/playground', { method: 'POST', body: { text } }),
  });
}
