import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import { MessageSquarePlus, Search } from 'lucide-react';
import { NewChatDialog } from './TemplatePicker';
import type { ConversationDTO, ConversationFilter } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatListTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar, WindowBadge } from './bits';
import { useConversations } from './queries';
import { QuotaChip } from './QuotaChip';

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'unread', label: 'Belum dibaca' },
  { value: 'open', label: 'Jendela terbuka' },
];

function ConversationItem({ conv }: { conv: ConversationDTO }) {
  return (
    <NavLink
      to={`/chats/${conv.id}`}
      className={({ isActive }) =>
        cn(
          'relative mx-2 my-0.5 flex gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent',
          // Penanda aktif bergaya Coretax: latar emas lembut + garis emas di kiri.
          isActive && 'bg-gold-soft before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-gold hover:bg-gold-soft',
        )
      }
    >
      <Avatar name={conv.contact.name} seed={conv.contact.waId} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate', conv.unreadCount > 0 ? 'font-bold' : 'font-semibold')}>{conv.contact.name}</span>
          {conv.lastMessageAt && (
            <span className={cn('shrink-0 text-xs', conv.unreadCount > 0 ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {formatListTime(conv.lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={cn('truncate text-sm', conv.unreadCount > 0 ? 'text-foreground' : 'text-muted-foreground')}>
            {conv.lastMessageDirection === 'out' && 'Anda: '}
            {conv.lastMessagePreview}
          </span>
          {conv.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-bold text-gold-foreground">
              {conv.unreadCount}
            </span>
          )}
        </div>
        <WindowBadge cswExpiresAt={conv.cswExpiresAt} compact />
      </div>
    </NavLink>
  );
}

export function ConversationList() {
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [newChat, setNewChat] = useState(false);
  const query = useConversations(filter, q);
  const items = query.data?.pages.flatMap((p) => p.conversations) ?? [];

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Chat</h1>
          <Button size="sm" onClick={() => setNewChat(true)}>
            <MessageSquarePlus /> Chat baru
          </Button>
        </div>
        <QuotaChip />
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="rounded-xl border-transparent bg-muted pl-9" placeholder="Cari nama, nomor, atau isi pesan" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                filter === f.value ? 'border-gold bg-gold text-gold-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {query.isError && <Alert variant="destructive" className="m-3 w-auto">{errorMessage(query.error)}</Alert>}
      {query.isPending ? (
        <div className="flex flex-col gap-3 p-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {q ? 'Tidak ada percakapan yang cocok.' : filter === 'all' ? 'Belum ada percakapan.' : 'Tidak ada percakapan untuk filter ini.'}
        </p>
      ) : (
        <Virtuoso
          className="flex-1"
          data={items}
          computeItemKey={(_, c) => c.id}
          itemContent={(_, c) => <ConversationItem conv={c} />}
          endReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
        />
      )}
      <NewChatDialog open={newChat} onOpenChange={setNewChat} />
    </div>
  );
}
