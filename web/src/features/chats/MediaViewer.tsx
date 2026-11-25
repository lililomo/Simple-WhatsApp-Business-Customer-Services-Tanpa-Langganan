import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { MessageDTO } from '@wa/shared';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { closeMediaViewer, isViewable, openMediaViewer, useMediaViewerTarget } from './mediaViewerStore';
import { flattenMessages, useMessages } from './queries';

const iconButton =
  'flex size-10 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/15 hover:text-white focus-visible:bg-white/15 focus-visible:outline-none disabled:opacity-30 [&_svg]:size-5';

function sender(message: MessageDTO, contactName: string): string {
  if (message.direction === 'in') return contactName;
  return message.sentBy?.name ?? 'Anda';
}

/**
 * Penampil media chat: gambar dan video dibuka sebagai popup di atas ruang chat, bukan di tab baru. Ditutup dengan
 * klik di luar media, tombol ×, atau Esc. Panah kiri/kanan berpindah ke media lain di percakapan yang sama.
 */
export function MediaViewer({ conversationId, contactName }: { conversationId: string; contactName: string }) {
  const target = useMediaViewerTarget();
  const open = target?.conversationId === conversationId;
  // Pindah chat selagi penampil terbuka: tutup, supaya tidak muncul lagi saat kembali ke chat itu.
  useEffect(() => () => closeMediaViewer(), [conversationId]);
  if (!open) return null;
  return <OpenViewer conversationId={conversationId} messageId={target.messageId} contactName={contactName} />;
}

function OpenViewer({ conversationId, messageId, contactName }: { conversationId: string; messageId: string; contactName: string }) {
  const query = useMessages(conversationId);
  const items = useMemo(() => flattenMessages(query.data).filter(isViewable), [query.data]);
  const index = items.findIndex((m) => m.id === messageId);
  const message = index >= 0 ? items[index] : undefined;
  const [zoomed, setZoomed] = useState(false);
  // Titik yang diklik menjadi pusat pembesaran.
  const [origin, setOrigin] = useState('50% 50%');

  useEffect(() => setZoomed(false), [messageId]);
  // Pesannya sudah tidak ada (mis. percakapan dimuat ulang): tutup saja.
  useEffect(() => {
    if (!message && !query.isPending) closeMediaViewer();
  }, [message, query.isPending]);

  if (!message?.media) return null;
  const media = message.media;
  const go = (step: number) => {
    const next = items[index + step];
    if (next) openMediaViewer(conversationId, next.id);
  };
  const pointAt = (e: MouseEvent<HTMLImageElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const clamp = (n: number) => Math.min(100, Math.max(0, n));
    setOrigin(`${clamp(((e.clientX - box.left) / box.width) * 100)}% ${clamp(((e.clientY - box.top) / box.height) * 100)}%`);
  };
  const toggleZoom = (e?: MouseEvent<HTMLImageElement>) => {
    // Saat diperbesar lewat klik, titik yang diklik menjadi pusatnya; lewat tombol, pusat gambar.
    if (!zoomed) {
      if (e) pointAt(e);
      else setOrigin('50% 50%');
    }
    setZoomed((z) => !z);
  };
  const isImage = message.type === 'image';

  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && closeMediaViewer()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="media-viewer-overlay fixed inset-0 z-50 bg-black/85" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="media-viewer fixed inset-0 z-50 flex flex-col outline-none"
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') go(-1);
            else if (e.key === 'ArrowRight') go(1);
          }}
          // Kursor tetap di kotak balas setelah penampil ditutup dengan tombol dari gelembung mana pun.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 py-2 text-white sm:px-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">{sender(message, contactName)}</DialogPrimitive.Title>
              <p className="truncate text-xs text-white/70">
                {formatDateTime(message.timestamp)}
                {items.length > 1 && ` · ${index + 1} dari ${items.length}`}
              </p>
            </div>
            {isImage && (
              <button type="button" className={iconButton} onClick={() => toggleZoom()} aria-label={zoomed ? 'Perkecil' : 'Perbesar'} title={zoomed ? 'Perkecil' : 'Perbesar'}>
                {zoomed ? <ZoomOut /> : <ZoomIn />}
              </button>
            )}
            <a className={iconButton} href={`${media.url}?download=1`} aria-label="Unduh" title="Unduh">
              <Download />
            </a>
            <DialogPrimitive.Close className={iconButton} aria-label="Tutup" title="Tutup (Esc)">
              <X />
            </DialogPrimitive.Close>
          </div>

          {/* Klik di area kosong di sekitar media menutup penampil. */}
          <div
            data-testid="media-viewer-stage"
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 pb-2 sm:px-14"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeMediaViewer();
            }}
          >
            {isImage ? (
              <img
                key={message.id}
                src={media.url}
                alt={message.text ?? 'Gambar'}
                draggable={false}
                onClick={toggleZoom}
                // Selagi diperbesar, menggerakkan kursor menggeser bagian gambar yang terlihat.
                onMouseMove={zoomed ? pointAt : undefined}
                style={{ transformOrigin: origin }}
                className={cn(
                  'media-viewer-item max-h-full max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-200 ease-out select-none',
                  zoomed ? 'scale-[2.2] cursor-zoom-out' : 'cursor-zoom-in',
                )}
              />
            ) : (
              <video
                key={message.id}
                src={media.url}
                controls
                autoPlay
                playsInline
                className="media-viewer-item max-h-full max-w-full rounded-lg bg-black shadow-2xl"
              />
            )}

            {items.length > 1 && (
              <>
                <button
                  type="button"
                  className={cn(iconButton, 'absolute top-1/2 left-2 -translate-y-1/2 bg-black/40 sm:left-3')}
                  onClick={() => go(-1)}
                  disabled={index === 0}
                  aria-label="Media sebelumnya"
                  title="Sebelumnya (←)"
                >
                  <ChevronLeft />
                </button>
                <button
                  type="button"
                  className={cn(iconButton, 'absolute top-1/2 right-2 -translate-y-1/2 bg-black/40 sm:right-3')}
                  onClick={() => go(1)}
                  disabled={index === items.length - 1}
                  aria-label="Media berikutnya"
                  title="Berikutnya (→)"
                >
                  <ChevronRight />
                </button>
              </>
            )}
          </div>

          {message.text && (
            <p className="mx-auto max-h-24 max-w-3xl overflow-y-auto px-4 pb-4 text-center text-sm whitespace-pre-wrap text-white/90">{message.text}</p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
