import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@/lib/api';
import { checkFile } from './helpers';
import { knowledgeKeys, uploadDocument } from './queries';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'rejected';

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  /** Alasan ditolak (cek di browser) atau pesan galat dari server. */
  message: string | null;
}

/**
 * Antrean unggah Pustaka: berkas dicek dulu di browser (jenis dan ukuran), lalu diunggah satu per satu supaya
 * server tidak memproses banyak berkas besar sekaligus. Berkas yang gagal tidak diulang sendiri.
 */
export function useUploadQueue() {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const waiting = useRef<UploadItem[]>([]);
  const running = useRef(false);
  const seq = useRef(0);

  const patch = (id: string, change: Partial<UploadItem>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)));

  const pump = async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let next = waiting.current.shift(); next; next = waiting.current.shift()) {
        patch(next.id, { status: 'uploading', message: null });
        try {
          await uploadDocument(next.file);
          patch(next.id, { status: 'done' });
          void qc.invalidateQueries({ queryKey: knowledgeKeys.all });
        } catch (err) {
          patch(next.id, { status: 'failed', message: errorMessage(err) });
        }
      }
    } finally {
      running.current = false;
    }
  };

  const add = (files: File[]) => {
    const fresh = files.map((file): UploadItem => {
      const problem = checkFile(file);
      return { id: `u${++seq.current}`, file, status: problem ? 'rejected' : 'queued', message: problem };
    });
    if (fresh.length === 0) return;
    setItems((list) => [...list, ...fresh]);
    waiting.current.push(...fresh.filter((item) => item.status === 'queued'));
    void pump();
  };

  const retry = (item: UploadItem) => {
    if (item.status !== 'failed') return;
    patch(item.id, { status: 'queued', message: null });
    waiting.current.push(item);
    void pump();
  };

  /** Buang baris yang sudah selesai (berhasil, gagal, atau ditolak) dari daftar. */
  const clear = () =>
    setItems((list) => list.filter((item) => item.status === 'queued' || item.status === 'uploading'));

  const busy = items.some((item) => item.status === 'queued' || item.status === 'uploading');
  return { items, busy, add, retry, clear };
}
