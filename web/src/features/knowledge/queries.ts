import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KbDocumentDTO, KbListDTO, kbNoteBody, kbUpdateBody } from '@wa/shared';
import { api } from '@/lib/api';

export type KbNoteBody = ReturnType<typeof kbNoteBody.parse>;
export type KbUpdateBody = ReturnType<typeof kbUpdateBody.parse>;

export interface KnowledgeFilter {
  q: string;
  tag: string;
  trash: boolean;
}

// Awalan kunci sama dengan resource "knowledge" di event SSE "library.updated", jadi semua browser ikut diperbarui.
export const knowledgeKeys = {
  all: ['knowledge'] as const,
  list: (filter: KnowledgeFilter) => ['knowledge', filter] as const,
};

/** Selama masih ada dokumen yang diproses, daftar diambil ulang berkala sampai statusnya berubah. */
const PROCESSING_POLL_MS = 5_000;

export function useKnowledge(filter: KnowledgeFilter) {
  return useQuery({
    queryKey: knowledgeKeys.list(filter),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (filter.q) params.set('q', filter.q);
      if (filter.tag) params.set('tag', filter.tag);
      if (filter.trash) params.set('trash', '1');
      const qs = params.toString();
      return api<KbListDTO>(`/api/knowledge${qs ? `?${qs}` : ''}`, { signal });
    },
    // Saat mengetik pencarian atau memilih tag, daftar lama tetap tampil sampai hasil baru datang.
    // Tidak dipakai saat berpindah ke/dari tempat sampah, supaya isi keduanya tidak tertukar.
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[1] as KnowledgeFilter | undefined;
      return before?.trash === filter.trash ? previous : undefined;
    },
    refetchInterval: (query) =>
      query.state.data?.documents.some((d) => d.status === 'processing') ? PROCESSING_POLL_MS : false,
  });
}

export function uploadDocument(file: File) {
  const form = new FormData();
  form.append('file', file);
  return api<{ document: KbDocumentDTO }>('/api/knowledge', { method: 'POST', body: form });
}

function useKnowledgeMutation<TInput>(run: (input: TInput) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    // Tidak ditunggu: baris yang dihapus/dipulihkan hilang dari daftar begitu daftar dimuat ulang, dan
    // callback di mutate() (toast) tidak akan jalan bila komponennya sudah lepas.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: knowledgeKeys.all });
    },
  });
}

export function useCreateNote() {
  return useKnowledgeMutation((body: KbNoteBody) =>
    api<{ document: KbDocumentDTO }>('/api/knowledge/notes', { method: 'POST', body }),
  );
}

export function useUpdateDocument() {
  return useKnowledgeMutation(({ id, body }: { id: string; body: KbUpdateBody }) =>
    api<{ document: KbDocumentDTO }>(`/api/knowledge/${id}`, { method: 'PATCH', body }),
  );
}

/** Memindahkan ke tempat sampah (bisa dipulihkan selama 30 hari). */
export function useDeleteDocument() {
  return useKnowledgeMutation((id: string) => api(`/api/knowledge/${id}`, { method: 'DELETE' }));
}

export function useRestoreDocument() {
  return useKnowledgeMutation((id: string) =>
    api<{ document: KbDocumentDTO }>(`/api/knowledge/${id}/restore`, { method: 'POST' }),
  );
}

export function useReprocessDocument() {
  return useKnowledgeMutation((id: string) =>
    api<{ document: KbDocumentDTO }>(`/api/knowledge/${id}/reprocess`, { method: 'POST' }),
  );
}
