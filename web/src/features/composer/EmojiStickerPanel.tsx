import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Apple, Car, Clock, Dog, Flag, Hash, Lightbulb, Loader2, Plus, Search, Smile, Sticker, Trophy, X } from 'lucide-react';
import { toast } from 'sonner';
import type { StickerDTO } from '@wa/shared';
import { libraryKeys, useRecentEmoji, useStickers } from '@/features/library/queries';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EMOJI_CATEGORIES, loadEmojis, type EmojiItem } from './emoji-data';
import { StickerCreator } from './StickerCreator';

const CATEGORY_ICON: Record<string, typeof Smile> = {
  recent: Clock,
  smileys: Smile,
  animals: Dog,
  food: Apple,
  activity: Trophy,
  travel: Car,
  objects: Lightbulb,
  symbols: Hash,
  flags: Flag,
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section data-section={id}>
      <h3 className="sticky top-0 z-10 bg-card/95 px-1 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur">{title}</h3>
      {children}
    </section>
  );
}

function EmojiGrid({ items, onPick }: { items: { emoji: string; label?: string }[]; onPick: (e: string) => void }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(2.5rem,1fr))]">
      {items.map((e) => (
        <button
          key={e.emoji}
          type="button"
          title={e.label}
          onClick={() => onPick(e.emoji)}
          className="flex aspect-square items-center justify-center rounded-lg text-[1.6rem] leading-none transition-transform hover:scale-110 hover:bg-accent"
        >
          {e.emoji}
        </button>
      ))}
    </div>
  );
}

function EmojiTab({ onPick }: { onPick: (emoji: string) => void }) {
  const [emojis, setEmojis] = useState<EmojiItem[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState('recent');
  const recent = useRecentEmoji();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadEmojis().then(setEmojis, () => setError(true));
  }, []);

  const byCategory = useMemo(
    () => EMOJI_CATEGORIES.map((c) => ({ ...c, items: (emojis ?? []).filter((e) => c.groups.includes(e.group)) })),
    [emojis],
  );
  const needle = q.trim().toLowerCase();
  const results = useMemo(
    () => (needle && emojis ? emojis.filter((e) => e.search.includes(needle)).slice(0, 240) : null),
    [needle, emojis],
  );
  const recentItems = (recent.data ?? []).map((emoji) => ({ emoji }));

  // Ikon kategori aktif mengikuti posisi gulir.
  const onScroll = () => {
    const el = scroller.current;
    if (!el || results) return;
    const top = el.getBoundingClientRect().top;
    let current = 'recent';
    for (const s of el.querySelectorAll<HTMLElement>('[data-section]')) {
      if (s.getBoundingClientRect().top - top <= 8) current = s.dataset.section!;
    }
    setActive(current);
  };
  const jump = (id: string) => {
    setQ('');
    requestAnimationFrame(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-section="${id}"]`);
      if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 4 });
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2">
        {['recent', ...EMOJI_CATEGORIES.map((c) => c.id)].map((id) => {
          const Icon = CATEGORY_ICON[id]!;
          const label = id === 'recent' ? 'Sering dipakai' : EMOJI_CATEGORIES.find((c) => c.id === id)!.label;
          return (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => jump(id)}
              className={cn(
                'flex flex-1 justify-center border-b-[3px] py-2 text-muted-foreground transition-colors hover:text-foreground',
                active === id && !results ? 'border-gold text-foreground' : 'border-transparent',
              )}
            >
              <Icon className="size-5" />
            </button>
          );
        })}
      </div>
      <div className="relative px-3 pt-2">
        <Search className="absolute top-1/2 left-6 mt-1 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari emoji (Inggris/Melayu), mis. senyum, hati, kucing"
          className="h-9 w-full rounded-lg bg-muted pr-3 pl-9 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
      <div ref={scroller} onScroll={onScroll} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {error && <p className="p-4 text-sm text-destructive">Data emoji gagal dimuat. Muat ulang halaman.</p>}
        {!emojis && !error && <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />}
        {results ? (
          results.length ? (
            <EmojiGrid items={results} onPick={onPick} />
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">Emoji tidak ditemukan.</p>
          )
        ) : (
          emojis && (
            <>
              <Section id="recent" title="Sering dipakai (semua petugas)">
                {recentItems.length ? <EmojiGrid items={recentItems} onPick={onPick} /> : <p className="px-1 pb-2 text-xs text-muted-foreground">Belum ada. Emoji yang dikirim akan muncul di sini.</p>}
              </Section>
              {byCategory.map((c) => (
                <Section key={c.id} id={c.id} title={c.label}>
                  <EmojiGrid items={c.items} onPick={onPick} />
                </Section>
              ))}
            </>
          )
        )}
      </div>
    </div>
  );
}

function StickerTile({ sticker, onPick, onDelete }: { sticker: StickerDTO; onPick: () => void; onDelete?: () => void }) {
  return (
    <div className="group relative">
      <button type="button" onClick={onPick} className="flex aspect-square w-full items-center justify-center rounded-xl p-1.5 hover:bg-accent" aria-label="Kirim stiker">
        <img src={sticker.url} alt="Stiker" loading="lazy" className="max-h-full max-w-full object-contain" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Hapus stiker dari koleksi"
          className="absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full bg-foreground/80 text-background group-hover:flex"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function StickerTab({ onPick }: { onPick: (s: StickerDTO) => void }) {
  const stickers = useStickers();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/stickers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: libraryKeys.stickers }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const all = stickers.data ?? [];
  const recent = [...all]
    .filter((s) => s.lastUsedAt)
    .sort((a, b) => b.lastUsedAt!.localeCompare(a.lastUsedAt!))
    .slice(0, 12);
  const grid = 'grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-1';
  const del = (s: StickerDTO) => () => confirm('Hapus stiker ini dari koleksi semua petugas?') && remove.mutate(s.id);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {stickers.isPending && <Loader2 className="mx-auto mt-10 size-6 animate-spin text-muted-foreground" />}
      {recent.length > 0 && (
        <Section id="sticker-recent" title="Terakhir dipakai">
          <div className={grid}>
            {recent.map((s) => (
              <StickerTile key={s.id} sticker={s} onPick={() => onPick(s)} />
            ))}
          </div>
        </Section>
      )}
      <Section id="sticker-all" title="Koleksi stiker (semua petugas)">
        <div className={grid}>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed text-xs text-muted-foreground hover:bg-accent"
          >
            <Plus className="size-6" /> Buat stiker
          </button>
          {all.map((s) => (
            <StickerTile key={s.id} sticker={s} onPick={() => onPick(s)} onDelete={del(s)} />
          ))}
        </div>
      </Section>
      {creating && <StickerCreator onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Panel emoji & stiker di atas kotak balas, seperti WhatsApp Web. */
export function EmojiStickerPanel({
  tab,
  onTab,
  onEmoji,
  onSticker,
  onClose,
}: {
  tab: 'emoji' | 'sticker';
  onTab: (t: 'emoji' | 'sticker') => void;
  onEmoji: (emoji: string) => void;
  onSticker: (s: StickerDTO) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-80 flex-col border-t bg-card">
      <div className="flex items-center gap-1 px-2 pt-2">
        {(
          [
            { id: 'emoji', label: 'Emoji', icon: Smile },
            { id: 'sticker', label: 'Stiker', icon: Sticker },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTab(id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
              tab === id ? 'bg-gold text-gold-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
        <button type="button" onClick={onClose} aria-label="Tutup panel" className="ml-auto rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      {tab === 'emoji' ? <EmojiTab onPick={onEmoji} /> : <StickerTab onPick={onSticker} />}
    </div>
  );
}
