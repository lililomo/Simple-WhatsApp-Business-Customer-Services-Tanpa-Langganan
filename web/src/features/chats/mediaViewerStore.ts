import { useSyncExternalStore } from 'react';
import type { MessageDTO } from '@wa/shared';

/**
 * Media chat yang sedang dibuka di penampil (popup). Disimpan di luar komponen karena gelembung pesan berada di
 * daftar virtual: gelembung bisa dilepas saat digulir, sedangkan penampilnya harus tetap terbuka.
 */
export interface MediaViewerTarget {
  conversationId: string;
  messageId: string;
}

let current: MediaViewerTarget | null = null;
const listeners = new Set<() => void>();

function set(next: MediaViewerTarget | null) {
  current = next;
  for (const listener of listeners) listener();
}

export const openMediaViewer = (conversationId: string, messageId: string) => set({ conversationId, messageId });
export const closeMediaViewer = () => set(null);

export function useMediaViewerTarget(): MediaViewerTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null,
  );
}

/** Pesan yang bisa dibuka di penampil: gambar dan video yang berkasnya sudah siap. */
export function isViewable(message: MessageDTO): boolean {
  return (message.type === 'image' || message.type === 'video') && message.media?.status === 'ready';
}
