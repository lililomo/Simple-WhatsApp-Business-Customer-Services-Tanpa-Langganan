import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Virtuoso } from 'react-virtuoso';
import { Check, ChevronDown, MessageSquarePlus, Search, Settings2, Tag } from 'lucide-react';
import { NewChatDialog } from './TemplatePicker';
import type { ConversationDTO, ConversationFilter } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatListTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLabels } from '@/features/library/queries';
import { Avatar, WindowBadge } from './bits';
import { ConversationMenuContent, LabelChips, LabelDot } from './labels';
import { useConversations } from './queries';
import { QuotaChip } from './QuotaChip';

const FILTERS: { value: ConversationFilter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'unread', label: 'Belum dibaca' },
  { value: 'open', label: 'Jendela terbuka' },
];

const filterChip = (active: boolean) =>
  cn(
    'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
    active ? 'border-gold bg-gold text-gold-foreground' : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
  );

function ConversationItem({ conv, active }: { conv: ConversationDTO; active: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    // Tautan membentang menutupi seluruh baris (after:inset-0) agar tombol menu bisa berada di dalamnya.
    <div
      className={cn(
        'group relative mx-2 my-0.5 flex gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-accent',
        // Penanda aktif bergaya Coretax: latar emas lembut + garis emas di kiri.
        active && 'bg-gold-soft before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-gold hover:bg-gold-soft',
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <Avatar name={conv.contact.name} seed={conv.contact.waId} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <Link
            to={`/chats/${conv.id}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'truncate outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring',
              conv.unreadCount > 0 ? 'font-bold' : 'font-semibold',
            )}
          >
            {conv.contact.name}
          </Link>
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
          <span className="flex shrink-0 items-center gap-1">
            {conv.unreadCount > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-bold text-gold-foreground">
                {conv.unreadCount}
              </span>
            )}
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                className="relative z-10 hidden size-5 items-center justify-center rounded-full text-muted-foreground group-focus-within:flex group-hover:flex hover:bg-background hover:text-foreground data-[state=open]:flex"
                aria-label={`Menu percakapan ${conv.contact.name}`}
              >
                <ChevronDown className="size-4" />
              </DropdownMenuTrigger>
              {menuOpen && <ConversationMenuContent conv={conv} />}
            </DropdownMenu>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <WindowBadge cswExpiresAt={conv.cswExpiresAt} compact />
          <LabelChips labels={conv.labels} className="ml-auto" />
        </div>
      </div>
    </div>
  );
}

/** Filter daftar chat per label. */
function LabelFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const labels = useLabels();
  const selected = labels.data?.find((l) => l.id === value);

  // Label yang sedang dipakai filter dihapus petugas lain.
  useEffect(() => {
    if (value && labels.data && !selected) onChange('');
  }, [value, labels.data, selected, onChange]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={filterChip(!!selected)}>
        {selected ? <LabelDot color={selected.color} /> : <Tag className="size-3.5" />}
        <span className="max-w-28 truncate">{selected?.name ?? 'Label'}</span>
        <ChevronDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuItem onSelect={() => onChange('')}>
          <span className="flex-1">Semua label</span>
          {!value && <Check />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {labels.data?.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">Belum ada label.</div>}
        {labels.data?.map((l) => (
          <DropdownMenuItem key={l.id} onSelect={() => onChange(l.id)}>
            <LabelDot color={l.color} />
            <span className="flex-1 truncate">{l.name}</span>
            <span className="text-xs text-muted-foreground">{l.contactCount}</span>
            {value === l.id && <Check />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/labels">
            <Settings2 /> Kelola label
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConversationList() {
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [label, setLabel] = useState('');
  const [newChat, setNewChat] = useState(false);
  const { conversationId } = useParams();
  const query = useConversations(filter, q, label);
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
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.value} onClick={() => setFilter(f.value)} className={filterChip(filter === f.value)}>
              {f.label}
            </button>
          ))}
          <LabelFilter value={label} onChange={setLabel} />
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
          {q ? 'Tidak ada percakapan yang cocok.' : filter === 'all' && !label ? 'Belum ada percakapan.' : 'Tidak ada percakapan untuk filter ini.'}
        </p>
      ) : (
        <Virtuoso
          className="flex-1"
          data={items}
          computeItemKey={(_, c) => c.id}
          itemContent={(_, c) => <ConversationItem conv={c} active={c.id === conversationId} />}
          endReached={() => query.hasNextPage && !query.isFetchingNextPage && void query.fetchNextPage()}
        />
      )}
      <NewChatDialog open={newChat} onOpenChange={setNewChat} />
    </div>
  );
}
