import { useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AosAskBody, AosMessageDTO, AosThreadDTO, AssistantStatusDTO } from '@wa/shared';
import { libraryKeys } from '@/features/library/queries';
import { api, errorMessage } from '@/lib/api';
import { clearAosLive } from './live';

export const aosKeys = {
  /** Di bawah awalan ['assistant']: event SSE "library.updated" dengan resource `assistant` memuat ulangnya. */
  status: ['assistant', 'status'] as const,
  threads: ['assistant-thread'] as const,
  thread: (conversationId: string) => ['assistant-thread', conversationId] as const,
  /** Kunci mutasi "bertanya", untuk mengetahui apakah percakapan ini masih punya permintaan yang sedang dikirim. */
  ask: (conversationId: string) => ['assistant-ask', conversationId] as const,
};

/** Jawaban masih dikerjakan: teksnya dibaca dari event delta (live.ts), bukan dari pesannya. */
export const isAosRunning = (m: Pick<AosMessageDTO, 'status'>) => m.status === 'pending' || m.status === 'running';

export function useAssistantStatus() {
  return useQuery({
    queryKey: aosKeys.status,
    queryFn: () => api<AssistantStatusDTO>('/api/assistant/status'),
    staleTime: 60_000,
  });
}

/** Sesi AOS satu percakapan (dipakai bersama semua petugas). Setelah dimuat, dijaga tetap baru oleh event SSE. */
export function useAosThread(conversationId: string, enabled: boolean) {
  return useQuery({
    queryKey: aosKeys.thread(conversationId),
    queryFn: async () => {
      const thread = await api<AosThreadDTO>(`/api/conversations/${conversationId}/assistant`);
      // Teks mengalir milik jawaban yang ternyata sudah selesai (event penutupnya terlewat) tidak dipakai lagi.
      for (const m of thread.messages) if (!isAosRunning(m)) clearAosLive(m.id);
      return thread;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** `a` dibuat setelah `b`. Id pesan AOS adalah angka urut, dipakai bila waktunya sama. */
function createdAfter(a: AosMessageDTO, b: AosMessageDTO): boolean {
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);
  if (at !== bt && !Number.isNaN(at) && !Number.isNaN(bt)) return at > bt;
  return a.id.length !== b.id.length ? a.id.length > b.id.length : a.id > b.id;
}

/**
 * Pasang pesan ke sesi: ganti bila id-nya sudah ada, tambahkan bila baru. `openOfferId` ikut dijaga: diisi saat
 * tawaran terbuka datang, dikosongkan saat tawaran itu dijawab atau ditutup.
 */
export function applyAosMessage(thread: AosThreadDTO, message: AosMessageDTO): AosThreadDTO {
  let messages: AosMessageDTO[];
  if (thread.messages.some((m) => m.id === message.id)) {
    messages = thread.messages.map((m) => (m.id === message.id ? message : m));
  } else {
    // Biasanya di ujung. Jawaban POST dan event SSE bisa tiba tidak berurutan, jadi posisinya dicari dari belakang.
    let at = thread.messages.length;
    while (at > 0 && createdAfter(thread.messages[at - 1]!, message)) at--;
    messages = [...thread.messages.slice(0, at), message, ...thread.messages.slice(at)];
  }
  let openOfferId = thread.openOfferId;
  if (message.kind === 'offer' && message.offerState === 'open') openOfferId = message.id;
  else if (openOfferId === message.id) openOfferId = null;
  return { ...thread, messages, openOfferId };
}

/** Pasang pesan ke cache sesi percakapannya (bila sesi itu sudah dimuat) dan buang teks mengalir yang sudah usang. */
export function upsertAosMessage(qc: QueryClient, message: AosMessageDTO) {
  if (!isAosRunning(message)) clearAosLive(message.id);
  qc.setQueryData<AosThreadDTO>(aosKeys.thread(message.conversationId), (thread) => thread && applyAosMessage(thread, message));
}

/**
 * Bertanya ke AOS: teks bebas, pilihan dari tawaran, atau tindakan cepat. Server menjawab 202 dengan pesan yang
 * dibuat, yang langsung dipasang ke sesi. Selama satu permintaan masih dikirim, permintaan berikutnya diabaikan.
 */
export function useAosAsk(conversationId: string) {
  const qc = useQueryClient();
  const mutationKey = aosKeys.ask(conversationId);
  const { mutate } = useMutation({
    mutationKey,
    mutationFn: (body: AosAskBody) =>
      api<{ messages: AosMessageDTO[] }>(`/api/conversations/${conversationId}/assistant/messages`, { method: 'POST', body }),
    onSuccess: ({ messages }) => {
      const key = aosKeys.thread(conversationId);
      // Sesi belum ada di cache (mis. gagal dimuat): muat ulang, karena tidak ada tempat memasang pesannya.
      if (qc.getQueryData(key) === undefined) void qc.invalidateQueries({ queryKey: key });
      for (const m of messages) upsertAosMessage(qc, m);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  // Dibaca dari cache mutasi, bukan dari state komponen: tetap benar bila panel ditutup lalu dibuka lagi saat
  // permintaan masih berjalan, dan dua tekanan beruntun tidak lolos sebelum React sempat merender ulang.
  const busy = useIsMutating({ mutationKey }) > 0;
  const send = (body: AosAskBody, onSent?: () => void): boolean => {
    if (qc.isMutating({ mutationKey }) > 0) return false;
    mutate(body, { onSuccess: onSent });
    return true;
  };
  return { busy, send };
}

/** Topik baru: konteks lama diakhiri, pesan lama tetap ada di server sebagai sesi sebelumnya. */
export function useAosReset(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<AosThreadDTO>(`/api/conversations/${conversationId}/assistant/reset`, { method: 'POST' }),
    onSuccess: (thread) => qc.setQueryData(aosKeys.thread(conversationId), thread),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export type AosSaveTarget = 'library' | 'quick-reply';

export type AosMessageAction =
  | { action: 'cancel' | 'dismiss' | 'used' }
  | { action: 'feedback'; body: { value: 1 | -1 | null } }
  | { action: 'save'; body: { target: AosSaveTarget; title: string } };

/** Tindakan atas satu pesan AOS (batalkan, tutup tawaran, nilai, tandai dipakai, simpan). Server mengembalikan pesannya. */
export function useAosMessageAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...rest }: { id: string } & AosMessageAction) =>
      api<{ message: AosMessageDTO }>(`/api/assistant/messages/${id}/${rest.action}`, {
        method: 'POST',
        body: 'body' in rest ? rest.body : undefined,
      }),
    onSuccess: ({ message }, vars) => {
      upsertAosMessage(qc, message);
      if (vars.action === 'save') {
        void qc.invalidateQueries({ queryKey: vars.body.target === 'library' ? ['knowledge'] : libraryKeys.quickReplies });
      }
    },
    // "Dipakai" hanya catatan statistik; drafnya sudah masuk kotak balas, jadi kegagalannya tidak perlu mengganggu.
    onError: (err, vars) => {
      if (vars.action !== 'used') toast.error(errorMessage(err));
    },
  });
}
