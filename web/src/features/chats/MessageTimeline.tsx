import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ArrowDown } from 'lucide-react';
import type { MessageDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatDayLabel } from '@/lib/format';
import { MessageBubble } from './MessageBubble';
import { flattenMessages, useMessages } from './queries';

// Indeks awal besar agar pesan lama bisa ditambahkan di atas tanpa melompat (pola "prepend" react-virtuoso).
const START_INDEX = 1_000_000;

export function MessageTimeline({ conversationId, onReply }: { conversationId: string; onReply: (m: MessageDTO) => void }) {
  const query = useMessages(conversationId);
  const items = useMemo(() => flattenMessages(query.data), [query.data]);
  const olderCount = items.length - (query.data?.pages[0]?.messages.length ?? 0);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const lastId = items.at(-1)?.id;

  // Pesan baru saat pengguna sedang membaca pesan lama: tampilkan tombol, jangan melompat.
  useEffect(() => {
    if (lastId && !atBottomRef.current) setUnseen(true);
  }, [lastId]);

  // Selama tab tersembunyi, Virtuoso tidak bisa mengukur pesan baru sehingga followOutput tidak menggulir.
  // Ingat posisi saat tab disembunyikan, lalu gulir ke pesan terakhir saat tab terlihat lagi.
  useEffect(() => {
    let stick = true;
    const onVisibility = () => {
      if (document.hidden) stick = atBottomRef.current;
      else if (stick) requestAnimationFrame(() => virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end' }));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (query.isPending) {
    return (
      <div className="flex flex-1 flex-col justify-end gap-2 p-6">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="ml-auto h-10 w-1/2" />
        <Skeleton className="h-10 w-3/5" />
      </div>
    );
  }
  if (query.isError) return <Alert variant="destructive" className="m-4 w-auto">{errorMessage(query.error)}</Alert>;
  if (items.length === 0) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Belum ada pesan.</div>;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Virtuoso
        ref={virtuoso}
        className="flex-1"
        data={items}
        firstItemIndex={START_INDEX - olderCount}
        initialTopMostItemIndex={items.length - 1}
        computeItemKey={(_, m) => m.clientRef ?? m.id}
        atBottomThreshold={80}
        atBottomStateChange={(bottom) => {
          atBottomRef.current = bottom;
          setAtBottom(bottom);
          if (bottom) setUnseen(false);
        }}
        followOutput={(bottom) => (bottom ? (document.hidden ? 'auto' : 'smooth') : false)}
        startReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
        components={{
          Header: () => (
            <div className="py-3 text-center text-xs text-muted-foreground">
              {query.isFetchingNextPage ? 'Memuat pesan lama…' : query.hasNextPage ? '' : 'Awal percakapan'}
            </div>
          ),
          Footer: () => <div className="h-3" />,
        }}
        itemContent={(index, m) => {
          const prev = items[index - (START_INDEX - olderCount) - 1];
          const newDay = !prev || new Date(prev.timestamp).toDateString() !== new Date(m.timestamp).toDateString();
          return (
            <>
              {newDay && (
                <div className="flex justify-center py-2">
                  <span className="rounded-md bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">{formatDayLabel(m.timestamp)}</span>
                </div>
              )}
              <MessageBubble message={m} onReply={onReply} />
            </>
          );
        }}
      />
      {!atBottom && (
        <Button
          variant={unseen ? 'default' : 'outline'}
          size={unseen ? 'sm' : 'icon-sm'}
          className="absolute right-4 bottom-3 rounded-full shadow-md"
          onClick={() => virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })}
          aria-label={unseen ? undefined : 'Ke pesan terbaru'}
        >
          <ArrowDown />
          {unseen && 'Pesan baru'}
        </Button>
      )}
    </div>
  );
}
