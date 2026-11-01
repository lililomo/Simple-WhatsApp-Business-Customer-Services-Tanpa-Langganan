import { useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Search, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { TEXT_MAX, TEXT_VARIABLES, type QuickReplyDTO } from '@wa/shared';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/textarea';
import { useDeleteQuickReply, useQuickReplies, useSaveQuickReply } from '@/features/library/queries';
import { errorMessage } from '@/lib/api';

function QuickReplyDialog({ initial, onClose }: { initial: QuickReplyDTO | null; onClose: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const save = useSaveQuickReply();

  const insertVariable = (key: string) => {
    const el = bodyRef.current;
    const at = el?.selectionStart ?? body.length;
    const next = `${body.slice(0, at)}{${key}}${body.slice(el?.selectionEnd ?? at)}`;
    setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + key.length + 2, at + key.length + 2);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { id: initial?.id, body: { title, shortcut: shortcut.trim() || null, body } },
      {
        onSuccess: () => {
          toast.success(initial ? 'Balasan cepat diperbarui.' : 'Balasan cepat ditambahkan.');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Ubah balasan cepat' : 'Balasan cepat baru'}</DialogTitle>
          <DialogDescription>Dipakai bersama semua petugas. Di kotak balas, ketik / lalu pintasannya, atau klik ikon ⚡.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="qr-title">Judul</Label>
              <Input id="qr-title" required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="mis. Syarat buat NPWP" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="qr-shortcut">Pintasan (opsional)</Label>
              <div className="flex items-center rounded-md border border-input px-3 focus-within:ring-[3px] focus-within:ring-ring/50">
                <span className="text-muted-foreground">/</span>
                <input
                  id="qr-shortcut"
                  className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
                  maxLength={40}
                  pattern="[A-Za-z0-9_\-]*"
                  title="Huruf, angka, - dan _ tanpa spasi"
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value.replace(/\s/g, ''))}
                  placeholder="npwp"
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="qr-body">Isi pesan</Label>
            <Textarea id="qr-body" ref={bodyRef} required rows={7} maxLength={TEXT_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Sisipkan:
              {TEXT_VARIABLES.map((v) => (
                <button key={v.key} type="button" title={v.label} onClick={() => insertVariable(v.key)} className="rounded border bg-muted px-1.5 py-0.5 font-mono hover:bg-accent">
                  {`{${v.key}}`}
                </button>
              ))}
              <span>· *tebal* _miring_ ~coret~ seperti di WhatsApp</span>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function QuickRepliesPage() {
  const list = useQuickReplies();
  const remove = useDeleteQuickReply();
  const [editing, setEditing] = useState<QuickReplyDTO | null | 'new'>(null);
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const items = (list.data ?? []).filter(
    (r) => !needle || [r.title, r.shortcut ?? '', r.body].some((s) => s.toLowerCase().includes(needle)),
  );

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Balasan cepat</h2>
          <p className="text-sm text-muted-foreground">
            Teks siap pakai untuk menjawab lebih cepat. Bukan template Meta: hanya bisa dikirim saat jendela 24 jam masih terbuka.
          </p>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus /> Tambah
        </Button>
      </div>
      {list.isError && <Alert variant="destructive">{errorMessage(list.error)}</Alert>}
      {(list.data?.length ?? 0) > 5 && (
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Cari judul, pintasan, atau isi" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      )}
      {list.isPending && <Skeleton className="h-24 w-full" />}
      {list.data?.length === 0 && (
        <EmptyState icon={<Zap />} title="Belum ada balasan cepat">
          Tambahkan jawaban yang sering dipakai, mis. syarat layanan atau jam operasional.
        </EmptyState>
      )}
      <div className="flex flex-col gap-2">
        {items.map((r) => (
          <div key={r.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.title}</span>
                {r.shortcut && <Badge variant="secondary">/{r.shortcut}</Badge>}
                {r.usageCount > 0 && <span className="text-xs text-muted-foreground">dipakai {r.usageCount}×</span>}
              </div>
              <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">{r.body}</p>
            </div>
            <Button variant="ghost" size="icon-sm" aria-label={`Ubah ${r.title}`} onClick={() => setEditing(r)}>
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Hapus ${r.title}`}
              disabled={remove.isPending}
              onClick={() => {
                if (confirm(`Hapus balasan cepat "${r.title}"? Semua petugas tidak akan bisa memakainya lagi.`)) {
                  remove.mutate(r.id, { onError: (err) => toast.error(errorMessage(err)) });
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      {editing && <QuickReplyDialog initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
