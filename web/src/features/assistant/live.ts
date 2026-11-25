import { useCallback, useSyncExternalStore } from 'react';

/** Jawaban AOS yang sedang ditulis: teks lengkap sejauh ini dan langkah kerja terakhir (event SSE `assistant.delta`). */
export interface AosLive {
  text: string;
  steps: string[];
}

// Disimpan di luar cache TanStack Query: delta datang berkali-kali per detik, dan hanya gelembung jawaban
// yang sedang berjalan yang perlu dirender ulang, bukan seluruh linimasa.
const live = new Map<string, AosLive>();
const listeners = new Map<string, Set<() => void>>();

const emit = (messageId: string) => listeners.get(messageId)?.forEach((listener) => listener());

export function setAosLive(messageId: string, value: AosLive) {
  live.set(messageId, value);
  emit(messageId);
}

export function clearAosLive(messageId: string) {
  if (live.delete(messageId)) emit(messageId);
}

export function useAosLive(messageId: string): AosLive | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(messageId) ?? new Set();
      listeners.set(messageId, set);
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0 && listeners.get(messageId) === set) listeners.delete(messageId);
      };
    },
    [messageId],
  );
  return useSyncExternalStore(subscribe, () => live.get(messageId));
}
