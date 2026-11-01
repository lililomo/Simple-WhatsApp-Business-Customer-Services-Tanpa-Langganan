import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { formatWaId, type ContactDTO, type ConversationDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Avatar, WindowBadge } from './bits';

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
    <aside className="flex h-full w-full flex-col border-l bg-card md:w-80">
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
