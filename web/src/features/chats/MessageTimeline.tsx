import { useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { MessageDTO } from '@wa/shared';
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
    <Virtuoso
      className="flex-1"
      data={items}
      firstItemIndex={START_INDEX - olderCount}
      initialTopMostItemIndex={items.length - 1}
      computeItemKey={(_, m) => m.clientRef ?? m.id}
      followOutput={(atBottom) => (atBottom ? 'smooth' : false)}
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
  );
}
