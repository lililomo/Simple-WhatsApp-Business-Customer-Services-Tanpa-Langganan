import { useState, type FormEvent } from 'react';
import { Check, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { LABEL_COLORS, LABEL_NAME_MAX, type LabelWithUsageDTO } from '@wa/shared';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton } from '@/components/ui/misc';
import { LabelChip } from '@/features/chats/labels';
import { useDeleteLabel, useLabels, useSaveLabel } from '@/features/library/queries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

function LabelDialog({
  initial,
  used,
  onClose,
}: {
  initial: LabelWithUsageDTO | null;
  used: string[];
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  // Label baru mendapat warna siap pakai pertama yang belum dipakai.
  const [color, setColor] = useState(
    initial?.color ?? LABEL_COLORS.find((c) => !used.includes(c)) ?? LABEL_COLORS[0],
  );
  const save = useSaveLabel();
  const custom = !(LABEL_COLORS as readonly string[]).includes(color);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: initial?.id, body: { name: name.trim(), color } },
      {
        onSuccess: () => {
          toast.success(initial ? 'Label diperbarui.' : 'Label ditambahkan.');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? 'Ubah label' : 'Label baru'}</DialogTitle>
          <DialogDescription>
            Label dipakai bersama semua petugas untuk menandai lawan chat.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="label-name">Nama label</Label>
            <Input
              id="label-name"
              required
              autoFocus
              maxLength={LABEL_NAME_MAX}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Pelayanan"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Warna</Label>
            <div className="flex flex-wrap gap-2">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Warna ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-shadow',
                    color === c && 'ring-2 ring-foreground',
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="size-4 text-white drop-shadow" />}
                </button>
              ))}
              <label
                className={cn(
                  'relative flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium ring-offset-2 ring-offset-background hover:bg-accent',
                  custom && 'ring-2 ring-foreground',
                )}
                title="Pilih warna lain"
              >
                <span className="size-4 rounded-full border" style={{ backgroundColor: color }} />
                Lainnya
                <input
                  type="color"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={color.toLowerCase()}
                  onChange={(e) => setColor(e.target.value.toUpperCase())}
                />
              </label>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2.5 text-sm">
            <span className="text-muted-foreground">Contoh di daftar chat:</span>
            <LabelChip label={{ name: name.trim() || 'Nama label', color }} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LabelsPage() {
  const list = useLabels();
  const remove = useDeleteLabel();
  const [editing, setEditing] = useState<LabelWithUsageDTO | null | 'new'>(null);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Label</h2>
          <p className="text-sm text-muted-foreground">
            Tandai lawan chat, mis. untuk seksi yang menangani. Label tampil di pojok kanan bawah daftar chat
            dan bisa dipakai untuk menyaring.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus /> Tambah
        </Button>
      </div>
      {list.isError && <Alert variant="destructive">{errorMessage(list.error)}</Alert>}
      {list.isPending && <Skeleton className="h-24 w-full" />}
      {list.data?.length === 0 && (
        <EmptyState icon={<Tag />} title="Belum ada label">
          Tambahkan label seperti Pelayanan atau Penyuluh.
        </EmptyState>
      )}
      <div className="flex flex-col gap-2">
        {list.data?.map((l) => (
          <div key={l.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
            <LabelChip label={l} className="max-w-48 px-2.5 py-0.5 text-xs" />
            <span className="min-w-0 flex-1 text-sm text-muted-foreground">
              {l.contactCount > 0
                ? `Dipakai ${l.contactCount.toLocaleString('id-ID')} kontak`
                : 'Belum dipakai'}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Ubah ${l.name}`}
              onClick={() => setEditing(l)}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Hapus ${l.name}`}
              disabled={remove.isPending}
              onClick={() => {
                const usage =
                  l.contactCount > 0 ? ` Label ini akan dilepas dari ${l.contactCount} kontak.` : '';
                if (confirm(`Hapus label "${l.name}"?${usage}`)) {
                  remove.mutate(l.id, { onError: (err) => toast.error(errorMessage(err)) });
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      {editing && (
        <LabelDialog
          initial={editing === 'new' ? null : editing}
          used={(list.data ?? []).map((l) => l.color)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
