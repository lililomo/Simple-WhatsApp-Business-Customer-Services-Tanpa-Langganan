import { useState } from 'react';
import { Popover } from 'radix-ui';
import { Link } from 'react-router';
import { Search, Settings2, Zap } from 'lucide-react';
import type { QuickReplyDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { useQuickReplies } from '@/features/library/queries';
import { cn } from '@/lib/utils';

export function filterQuickReplies(items: QuickReplyDTO[], query: string): QuickReplyDTO[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  // Pintasan yang diawali kata kunci didahulukan, lalu judul/isi yang mengandungnya.
  const starts = items.filter((r) => r.shortcut?.startsWith(q));
  const rest = items.filter((r) => !starts.includes(r) && [r.shortcut ?? '', r.title, r.body].some((s) => s.toLowerCase().includes(q)));
  return [...starts, ...rest];
}

export function QuickReplyList({
  items,
  activeIndex,
  onPick,
  onHover,
}: {
  items: QuickReplyDTO[];
  activeIndex: number;
  onPick: (r: QuickReplyDTO) => void;
  onHover?: (i: number) => void;
}) {
  return (
    <ul role="listbox" className="flex flex-col py-1">
      {items.map((r, i) => (
        <li key={r.id} role="option" aria-selected={i === activeIndex}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(r)}
            onMouseEnter={() => onHover?.(i)}
            className={cn('flex w-full flex-col gap-0.5 px-3 py-2 text-left', i === activeIndex ? 'bg-gold-soft' : 'hover:bg-accent')}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              {r.shortcut && <span className="rounded bg-secondary px-1.5 font-mono text-xs text-secondary-foreground">/{r.shortcut}</span>}
              <span className="truncate">{r.title}</span>
            </span>
            <span className="line-clamp-1 text-xs text-muted-foreground">{r.body}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Tombol ⚡ di kotak balas: cari dan pilih balasan cepat. */
export function QuickReplyButton({ onPick }: { onPick: (r: QuickReplyDTO) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const list = useQuickReplies();
  const items = filterQuickReplies(list.data ?? [], q);
  const pick = (r: QuickReplyDTO) => {
    onPick(r);
    setOpen(false);
    setQ('');
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Balasan cepat" title="Balasan cepat (atau ketik /)">
          <Zap />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="top" align="start" sideOffset={8} className="z-50 flex max-h-96 w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
          <div className="relative border-b p-2">
            <Search className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') setIndex((i) => Math.min(i + 1, items.length - 1));
                else if (e.key === 'ArrowUp') setIndex((i) => Math.max(i - 1, 0));
                else if (e.key === 'Enter' && items[index]) pick(items[index]);
                else return;
                e.preventDefault();
              }}
              placeholder="Cari balasan cepat"
              className="h-9 w-full rounded-lg bg-muted pr-3 pl-8 text-sm outline-none"
            />
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
            {items.length ? (
              <QuickReplyList items={items} activeIndex={index} onPick={pick} onHover={setIndex} />
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {list.data?.length ? 'Tidak ada yang cocok.' : 'Belum ada balasan cepat.'}
              </p>
            )}
          </div>
          <Link to="/settings/quick-replies" onClick={() => setOpen(false)} className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <Settings2 className="size-3.5" /> Kelola balasan cepat
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
