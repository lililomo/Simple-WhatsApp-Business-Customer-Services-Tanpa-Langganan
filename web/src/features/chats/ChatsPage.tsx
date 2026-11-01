import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useParams } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { clampListWidth, LIST_WIDTH, setPrefs, usePrefs } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { ChatPane } from './ChatPane';
import { ConversationList } from './ConversationList';

/** Pembatas yang bisa digeser (mouse/sentuh/keyboard) untuk mengatur lebar kolom daftar chat. Klik ganda = lebar awal. */
function ResizeHandle({ width }: { width: number }) {
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    // Sisakan ruang minimal untuk kolom chat.
    const max = Math.min(LIST_WIDTH.max, window.innerWidth - 420);
    setPrefs({ listWidth: Math.min(max, clampListWidth(start.current.width + e.clientX - start.current.x)) });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowLeft') setPrefs({ listWidth: clampListWidth(width - step) });
    if (e.key === 'ArrowRight') setPrefs({ listWidth: clampListWidth(width + step) });
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Geser untuk mengubah lebar daftar chat"
      aria-valuemin={LIST_WIDTH.min}
      aria-valuemax={LIST_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={() => setPrefs({ listWidth: LIST_WIDTH.default })}
      onKeyDown={onKeyDown}
      title="Geser untuk mengubah lebar · klik ganda untuk lebar awal"
      className="group relative hidden w-2 shrink-0 cursor-col-resize touch-none outline-none select-none md:block after:absolute after:inset-y-8 after:left-1/2 after:w-1 after:-translate-x-1/2 after:rounded-full after:transition-colors hover:after:bg-gold focus-visible:after:bg-gold active:after:bg-gold"
    />
  );
}

export function ChatsPage() {
  const { conversationId } = useParams();
  const { listWidth } = usePrefs();
  return (
    <div className="flex h-full md:p-2" style={{ '--list-w': `${listWidth}px` } as CSSProperties}>
      {/* Di layar sempit hanya satu panel yang tampil; di layar lebar keduanya berupa kartu. */}
      <div className={cn('h-full w-full shrink-0 overflow-hidden bg-card md:w-[var(--list-w)] md:rounded-2xl md:border md:shadow-sm', conversationId ? 'hidden md:block' : 'block')}>
        <ConversationList />
      </div>
      <ResizeHandle width={listWidth} />
      <div className={cn('h-full min-w-0 flex-1 overflow-hidden md:rounded-2xl md:border md:shadow-sm', conversationId ? 'flex' : 'hidden md:flex')}>
        {conversationId ? (
          <ChatPane conversationId={conversationId} />
        ) : (
          <div className="chat-surface flex-1">
            <EmptyState icon={<MessageCircle />} title="WA Inbox">
              Pilih percakapan di sebelah kiri untuk membaca dan membalas pesan.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
