import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import { Bell, MessageSquarePlus, Search } from 'lucide-react';
import { NewChatDialog } from './TemplatePicker';
import type { ConversationDTO, ConversationFilter } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatListTime } from '@/lib/format';
import { notificationsSupported } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { Avatar, WindowBadge } from './bits';
import { useConversations } from './queries';

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
        cn('flex gap-3 border-b px-3 py-2.5 transition-colors hover:bg-accent/60', isActive && 'bg-accent')
      }
    >
      <Avatar name={conv.contact.name} seed={conv.contact.waId} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate', conv.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>{conv.contact.name}</span>
          {conv.lastMessageAt && (
            <span className={cn('shrink-0 text-xs', conv.unreadCount > 0 ? 'font-medium text-primary' : 'text-muted-foreground')}>
              {formatListTime(conv.lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-muted-foreground">
            {conv.lastMessageDirection === 'out' && 'Anda: '}
            {conv.lastMessagePreview}
          </span>
          {conv.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
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
  const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : 'denied'));
  const [newChat, setNewChat] = useState(false);
  const query = useConversations(filter, q);
  const items = query.data?.pages.flatMap((p) => p.conversations) ?? [];

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Chat</h1>
          <div className="flex gap-1">
            {permission === 'default' && (
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Aktifkan notifikasi"
                title="Aktifkan notifikasi"
                onClick={() => void Notification.requestPermission().then(setPermission)}
              >
                <Bell />
              </Button>
            )}
            <Button size="sm" onClick={() => setNewChat(true)}>
              <MessageSquarePlus /> Chat baru
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Cari nama, nomor, atau isi pesan" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filter === f.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent',
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
