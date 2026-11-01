import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';
import type { RealtimeEvent } from '@wa/shared';
import { playIncomingSound, showBrowserNotification } from '@/lib/notify';
import { pushState } from '@/lib/push';
import { applyConversation, keys, upsertMessage } from './queries';

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
          break;
      }
    };

    const connect = () => {
      source = new EventSource('/api/events');
      for (const type of ['message.created', 'message.updated', 'conversation.updated', 'connection.updated', 'library.updated']) {
        source.addEventListener(type, handle as EventListener);
      }
      source.addEventListener('hello', () => {
        // Setelah tersambung ulang, ambil ulang data agar event yang terlewat tidak hilang.
        if (disconnected) {
          qc.invalidateQueries({ queryKey: ['conversations'] });
          qc.invalidateQueries({ queryKey: ['messages'] });
          qc.invalidateQueries({ queryKey: keys.summary });
        }
        disconnected = false;
      });
      source.onerror = () => {
        disconnected = true;
      };
    };
    connect();
    return () => {
      clearTimeout(summaryTimer);
      source?.close();
    };
  }, [qc, navigate]);
}
