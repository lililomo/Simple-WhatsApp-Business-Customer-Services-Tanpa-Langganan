import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import type { RealtimeEvent } from '@wa/shared';
import { api, ApiError } from '@/lib/api';
import { playIncomingSound, showBrowserNotification } from '@/lib/notify';
import { pushState } from '@/lib/push';
import { applyConversation, keys, upsertMessage } from './queries';

/** Jeda sebelum menyambung lagi setelah browser menyerah: cepat dulu, lalu tiap 30 detik sampai server kembali. */
export const RECONNECT_DELAYS_MS = [1_000, 3_000, 5_000, 10_000, 30_000];

/** Sambungan SSE ke /api/events; memperbarui cache TanStack Query dan memberi notifikasi pesan masuk. */
export function useRealtime() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => {
    let source: EventSource | null = null;
    let disconnected = false;
    let summaryTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshSummary = () => {
      clearTimeout(summaryTimer);
      summaryTimer = setTimeout(() => qc.invalidateQueries({ queryKey: keys.summary }), 300);
    };

    // Fetch yang sedang berjalan dimulai sebelum event ini dan akan menimpa cache saat selesai; ambil ulang.
    const refetchIfInFlight = (queryKey: QueryKey) => {
      if (qc.isFetching({ queryKey }) > 0) void qc.invalidateQueries({ queryKey });
    };

    const handle = (raw: MessageEvent<string>) => {
      const event = JSON.parse(raw.data) as RealtimeEvent;
      switch (event.type) {
        case 'message.created': {
          upsertMessage(qc, event.message);
          applyConversation(qc, event.conversation, true);
          refetchIfInFlight(keys.messages(event.conversation.id));
          refetchIfInFlight(['conversations']);
          refreshSummary();
          if (event.message.direction === 'in') {
            const viewing = pathRef.current === `/chats/${event.conversation.id}`;
            if (document.hidden || !viewing) {
              playIncomingSound();
              // Bila Web Push aktif, notifikasi ditampilkan service worker (juga saat tab ditutup); jangan dobel.
              if (pushState() !== 'on') {
                showBrowserNotification(event.conversation.contact.name, event.conversation.lastMessagePreview ?? 'Pesan baru', () =>
                  navigate(`/chats/${event.conversation.id}`),
                );
              }
            }
          }
          break;
        }
        case 'message.updated':
          upsertMessage(qc, event.message);
          refetchIfInFlight(keys.messages(event.message.conversationId));
          break;
        case 'conversation.updated':
          applyConversation(qc, event.conversation, false);
          refetchIfInFlight(['conversations']);
          refreshSummary();
          break;
        case 'connection.updated':
          qc.invalidateQueries({ queryKey: ['connection-status'] });
          break;
        case 'library.updated':
          qc.invalidateQueries({ queryKey: [event.resource] });
          // Nama/warna label tampil di setiap percakapan; label yang dihapus ikut hilang dari kontak.
          if (event.resource === 'labels') {
            qc.invalidateQueries({ queryKey: ['conversations'] });
            qc.invalidateQueries({ queryKey: ['conversation'] });
          }
          break;
      }
    };

    let stopped = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
      clearTimeout(retryTimer);
      const delay = RECONNECT_DELAYS_MS[Math.min(attempts, RECONNECT_DELAYS_MS.length - 1)]!;
      attempts++;
      retryTimer = setTimeout(() => void reconnect(), delay);
    };

    /**
     * EventSource menyambung ulang sendiri saat jaringan putus, tetapi menyerah untuk selamanya bila server menjawab
     * selain 200 (502/503 saat aplikasi di-restart atau halaman pemeliharaan terpasang). Sambungan dibuat ulang di
     * sini. Sesi dicek dulu, supaya sesi yang sudah berakhir berujung ke halaman login, bukan dicoba terus.
     */
    const reconnect = async () => {
      if (stopped) return;
      try {
        await api('/api/auth/me');
      } catch (err) {
        if (stopped) return;
        if (err instanceof ApiError && err.status === 401) qc.setQueryData(['me'], null);
        else scheduleReconnect();
        return;
      }
      if (!stopped) connect();
    };

    const connect = () => {
      source?.close();
      const es = new EventSource('/api/events');
      source = es;
      for (const type of ['message.created', 'message.updated', 'conversation.updated', 'connection.updated', 'library.updated']) {
        es.addEventListener(type, handle as EventListener);
      }
      es.addEventListener('hello', () => {
        attempts = 0;
        // Setelah tersambung ulang, ambil ulang data agar event yang terlewat tidak hilang.
        if (disconnected) {
          qc.invalidateQueries({ queryKey: ['conversations'] });
          qc.invalidateQueries({ queryKey: ['messages'] });
          qc.invalidateQueries({ queryKey: keys.summary });
        }
        disconnected = false;
      });
      es.onerror = () => {
        disconnected = true;
        // CONNECTING berarti browser masih mencoba sendiri; CLOSED berarti ia sudah menyerah.
        if (source === es && es.readyState === EventSource.CLOSED) scheduleReconnect();
      };
    };

    // Saat tab dilihat lagi atau jaringan kembali, jangan menunggu jeda berikutnya.
    const wake = () => {
      if (document.hidden || source?.readyState !== EventSource.CLOSED) return;
      attempts = 0;
      clearTimeout(retryTimer);
      void reconnect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);

    connect();
    return () => {
      stopped = true;
      clearTimeout(summaryTimer);
      clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      source?.close();
    };
  }, [qc, navigate]);
}
