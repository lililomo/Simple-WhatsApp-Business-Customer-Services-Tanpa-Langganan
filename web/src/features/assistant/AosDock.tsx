import { useEffect, useState, type RefObject } from 'react';
import type { ConversationDTO } from '@wa/shared';
import type { ComposerHandle } from '@/features/chats/Composer';
import { usePrefs } from '@/lib/theme';
import { AosLauncher } from './AosLauncher';
import { AosPanel, isAosSheet } from './AosPanel';
import { useAosThread, useAssistantStatus } from './queries';

const HANDLED_KEY = 'wa-inbox-aos-offers';

function readHandled(): string[] {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(HANDLED_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Tawaran yang panelnya sudah pernah terbuka sendiri di tab ini. Panel terbuka sendiri sekali per tawaran:
 * menutupnya, pindah chat, atau memuat ulang halaman tidak membukanya lagi untuk tawaran yang sama.
 */
const handledOffers = new Set(readHandled());

function markHandled(offerId: string) {
  handledOffers.add(offerId);
  try {
    sessionStorage.setItem(HANDLED_KEY, JSON.stringify([...handledOffers].slice(-200)));
  } catch {
    // Penyimpanan diblokir: cukup diingat selama halaman ini terbuka.
  }
}

/**
 * AOS di ruang chat: tombol pembuka dan panel kaca di atas linimasa. Dipasang ulang per percakapan (`key` di
 * ChatPane) sehingga tidak ada yang terbawa antar-chat. Tidak menampilkan apa pun selama AOS belum siap
 * (dimatikan admin atau belum ada jalur yang terhubung).
 */
export function AosDock(props: { conversation: ConversationDTO; composerRef: RefObject<ComposerHandle | null> }) {
  const status = useAssistantStatus();
  return status.data?.ready === true ? <ReadyDock {...props} /> : null;
}

function ReadyDock({ conversation, composerRef }: { conversation: ConversationDTO; composerRef: RefObject<ComposerHandle | null> }) {
  const thread = useAosThread(conversation.id, true);
  const { aosWide, aosAutoOpen } = usePrefs();
  const [open, setOpen] = useState<false | 'auto' | 'manual'>(false);
  const openOfferId = thread.data?.openOfferId ?? null;

  useEffect(() => {
    if (!openOfferId || !aosAutoOpen || handledOffers.has(openOfferId)) return;
    // Lembar selayar penuh yang muncul sendiri akan menutupi balasan yang sedang diketik; di layar sempit
    // tawaran cukup ditandai di tombol pembuka.
    if (isAosSheet()) return;
    markHandled(openOfferId);
    setOpen((current) => current || 'auto');
  }, [openOfferId, aosAutoOpen]);

  // Sebelum sesinya termuat, tanda tawaran mengikuti data percakapan.
  const offer = thread.data ? openOfferId !== null : conversation.aosOffer;

  return (
    <div className="aos">
      {open && (
        <AosPanel
          conversation={conversation}
          thread={thread}
          wide={aosWide}
          focusInput={open === 'manual'}
          composerRef={composerRef}
          onClose={() => setOpen(false)}
        />
      )}
      <AosLauncher open={!!open} offer={offer} onToggle={() => setOpen((current) => (current ? false : 'manual'))} />
    </div>
  );
}
