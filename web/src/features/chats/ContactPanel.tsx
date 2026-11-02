import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Check, Settings2, X } from 'lucide-react';
import { toast } from 'sonner';
import { formatWaId, labelTextColor, type ContactDTO, type ConversationDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLabels } from '@/features/library/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar, WindowBadge } from './bits';
import { useLabelToggle } from './labels';

/** Semua label; yang terpasang berwarna penuh. Klik untuk memasang/melepas. */
function ContactLabels({ conversation }: { conversation: ConversationDTO }) {
  const labels = useLabels();
  const toggle = useLabelToggle(conversation.id);
  const attached = new Set(conversation.labels.map((l) => l.id));
  return (
    <div className="flex flex-col gap-2 border-t p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Label</span>
        <Link to="/settings/labels" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Settings2 className="size-3.5" /> Kelola
        </Link>
      </div>
      {labels.data?.length === 0 && <p className="text-xs text-muted-foreground">Belum ada label. Tambahkan di Pengaturan › Label.</p>}
      <div className="flex flex-wrap gap-1.5">
        {labels.data?.map((l) => {
          const on = attached.has(l.id);
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(l, !on)}
              className={cn(
                'flex items-center gap-1 rounded-full border-2 px-2.5 py-0.5 text-xs font-semibold transition-opacity',
                !on && 'bg-transparent opacity-70 hover:opacity-100',
              )}
              style={on ? { backgroundColor: l.color, borderColor: l.color, color: labelTextColor(l.color) } : { borderColor: l.color }}
            >
              {on && <Check className="size-3" />}
              {l.name}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Label menempel ke nomor ini dan terlihat oleh semua petugas.</p>
    </div>
  );
}

export function ContactPanel({ conversation, onClose }: { conversation: ConversationDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const c = conversation.contact;
  const [name, setName] = useState(c.displayName ?? '');
  const save = useMutation({
    mutationFn: () => api<{ contact: ContactDTO }>(`/api/contacts/${c.id}`, { method: 'PATCH', body: { displayName: name.trim() || null } }),
    onSuccess: () => {
      toast.success('Nama kontak disimpan.');
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <aside className="scrollbar-thin flex h-full w-full flex-col overflow-y-auto border-l bg-card md:w-80">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-semibold">Info kontak</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Tutup info kontak">
          <X />
        </Button>
      </div>
      <div className="flex flex-col items-center gap-2 border-b p-6 text-center">
        <Avatar name={c.name} seed={c.waId} className="size-20 text-2xl" />
        <div className="text-lg font-semibold">{c.name}</div>
        <div className="text-sm text-muted-foreground">{formatWaId(c.waId)}</div>
        <WindowBadge cswExpiresAt={conversation.cswExpiresAt} />
      </div>
      <dl className="flex flex-col gap-3 p-4 text-sm">
        <div>
          <dt className="text-muted-foreground">Nama profil WhatsApp</dt>
          <dd>{c.profileName ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Pertama menghubungi</dt>
          <dd>{formatDateTime(c.firstSeenAt)}</dd>
        </div>
      </dl>
      <ContactLabels conversation={conversation} />
      <form onSubmit={submit} className="flex flex-col gap-2 border-t p-4">
        <Label htmlFor="display-name">Nama tampilan</Label>
        <Input id="display-name" placeholder={c.profileName ?? 'Nama wajib pajak'} value={name} onChange={(e) => setName(e.target.value)} />
        <p className="text-xs text-muted-foreground">Hanya terlihat oleh petugas. Kosongkan untuk memakai nama profil WhatsApp.</p>
        <Button type="submit" size="sm" disabled={save.isPending} className="self-start">
          Simpan nama
        </Button>
      </form>
    </aside>
  );
}
