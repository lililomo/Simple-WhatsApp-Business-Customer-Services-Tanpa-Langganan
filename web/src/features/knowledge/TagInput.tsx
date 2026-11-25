import { useState } from 'react';
import { X } from 'lucide-react';
import { addTags, splitTags, TAG_MAX_LENGTH, TAGS_MAX } from './helpers';

/** Keadaan kolom tag: daftar tag yang sudah jadi dan teks yang masih diketik. */
export function useTagField(initial: string[] = []) {
  const [tags, setTags] = useState(initial);
  const [draft, setDraft] = useState('');
  return {
    tags,
    draft,
    setDraft,
    add: (incoming: string[]) => setTags((current) => addTags(current, incoming)),
    remove: (tag: string) => setTags((current) => current.filter((t) => t !== tag)),
    /** Jadikan teks yang masih diketik sebagai tag; mengembalikan daftar akhir (dipakai saat menyimpan). */
    commit: () => {
      const next = addTags(tags, splitTags(draft));
      setTags(next);
      setDraft('');
      return next;
    },
  };
}

export type TagField = ReturnType<typeof useTagField>;

/** Kolom tag: ketik lalu tekan koma atau Enter; setiap tag tampil sebagai chip yang bisa dihapus. */
export function TagInput({ id, field }: { id: string; field: TagField }) {
  const full = field.tags.length >= TAGS_MAX;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex min-h-9 cursor-text flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
        // Klik di area kosong kotak ikut memfokuskan kolom ketik.
        onClick={(e) => {
          if (e.target === e.currentTarget) document.getElementById(id)?.focus();
        }}
      >
        {field.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary py-0.5 pr-1 pl-2 text-xs font-medium text-secondary-foreground"
          >
            <span className="truncate">{tag}</span>
            <button
              type="button"
              aria-label={`Hapus tag ${tag}`}
              onClick={() => field.remove(tag)}
              className="rounded-sm p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="h-6 min-w-28 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          disabled={full}
          value={field.draft}
          placeholder={
            full ? `Maksimal ${TAGS_MAX} tag` : field.tags.length === 0 ? 'mis. npwp, spt tahunan' : ''
          }
          onChange={(e) => {
            const value = e.target.value;
            // Koma (diketik atau dari teks yang ditempel) langsung menutup tag sebelumnya.
            if (!/[,\n]/.test(value)) {
              field.setDraft(value.slice(0, TAG_MAX_LENGTH));
              return;
            }
            const parts = value.split(/[,\n]/);
            const rest = parts.pop() ?? '';
            field.add(splitTags(parts.join(',')));
            field.setDraft(rest.trimStart().slice(0, TAG_MAX_LENGTH));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && field.draft.trim()) {
              // Enter menutup tag, bukan mengirim formulir.
              e.preventDefault();
              field.commit();
            } else if (e.key === 'Backspace' && !field.draft && field.tags.length > 0) {
              field.remove(field.tags[field.tags.length - 1]!);
            }
          }}
          onBlur={() => {
            if (field.draft.trim()) field.commit();
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Pisahkan dengan koma. Maksimal {TAGS_MAX} tag, masing-masing {TAG_MAX_LENGTH} huruf.
      </p>
    </div>
  );
}
