import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  CATEGORY_LABEL,
  normalizePhone,
  renderTemplateText,
  type ConversationDTO,
  type MediaDTO,
  type MessageDTO,
  type TemplateDTO,
  type TemplateParams,
} from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { FormattedText } from '@/lib/whatsapp-format';
import { applyConversation, upsertMessage } from './queries';

function useTemplates() {
  return useQuery({
    queryKey: ['templates', 'APPROVED'],
    queryFn: async () => (await api<{ templates: TemplateDTO[] }>('/api/templates?status=APPROVED')).templates,
  });
}

function CategoryBadge({ category }: { category: string }) {
  const info = CATEGORY_LABEL[category];
  return (
    <Badge variant={category === 'MARKETING' ? 'warning' : 'secondary'} title={info?.hint}>
      {info?.label ?? category}
    </Badge>
  );
}

/** Pilih template, isi variabel, lihat preview, lalu kirim lewat onSubmit. */
function TemplateComposer({
  submitLabel,
  disabled,
  onSubmit,
}: {
  submitLabel: string;
  disabled?: boolean;
  onSubmit: (template: TemplateDTO, params: TemplateParams) => Promise<void>;
}) {
  const qc = useQueryClient();
  const templates = useTemplates();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TemplateDTO | null>(null);
  const [header, setHeader] = useState<Record<string, string>>({});
  const [body, setBody] = useState<Record<string, string>>({});
  const [buttons, setButtons] = useState<Record<string, string>>({});
  const [headerMedia, setHeaderMedia] = useState<MediaDTO | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sync = useMutation({
    mutationFn: () => api<{ synced: number }>('/api/templates/sync', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(`${r.synced} template disinkronkan dari Meta.`);
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const filtered = useMemo(
    () => (templates.data ?? []).filter((t) => t.name.toLowerCase().includes(search.toLowerCase())),
    [templates.data, search],
  );
  const params: TemplateParams = { header, body, buttons, ...(headerMedia ? { headerMediaId: headerMedia.id } : {}) };
  const mediaHeader = selected?.variables.header && selected.variables.header.format !== 'TEXT' ? selected.variables.header.format : null;

  const choose = (t: TemplateDTO) => {
    setSelected(t);
    setHeader({});
    setBody({});
    setButtons({});
    setHeaderMedia(null);
    setError(null);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      setHeaderMedia((await api<{ media: MediaDTO }>('/api/media', { method: 'POST', body: form })).media);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(selected, params);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!selected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Cari template" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={sync.isPending ? 'animate-spin' : ''} /> Sinkron
          </Button>
        </div>
        {templates.isPending && <Skeleton className="h-24 w-full" />}
        {templates.isError && <Alert variant="destructive">{errorMessage(templates.error)}</Alert>}
        {templates.data && filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada template yang disetujui. Buat template di WhatsApp Manager, lalu klik Sinkron.
          </p>
        )}
        <div className="flex max-h-[50svh] flex-col gap-2 overflow-y-auto">
          {filtered.map((t) => {
            const preview = t.components.find((c) => c.type === 'BODY')?.text ?? '';
            return (
              <button key={t.id} onClick={() => choose(t)} className="flex flex-col gap-1 rounded-lg border p-3 text-left hover:bg-accent">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs text-muted-foreground">{t.language}</span>
                  <CategoryBadge category={t.category} />
                </div>
                <span className="line-clamp-2 text-sm text-muted-foreground">{preview}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const v = selected.variables;
  const field = (label: string, value: string | undefined, onChange: (s: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Input required value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelected(null)} aria-label="Pilih template lain">
          <ArrowLeft />
        </Button>
        <span className="font-medium">{selected.name}</span>
        <CategoryBadge category={selected.category} />
      </div>
      {selected.category === 'MARKETING' && (
        <Alert variant="warning">Template kategori Marketing ditagih dengan tarif tertinggi oleh Meta.</Alert>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}
      {mediaHeader && (
        <div className="flex flex-col gap-1.5">
          <Label>Lampiran header ({mediaHeader.toLowerCase()})</Label>
          <Input type="file" onChange={(e) => void upload(e.target.files?.[0])} disabled={uploading} />
          {headerMedia && <span className="text-xs text-muted-foreground">Terunggah: {headerMedia.fileName}</span>}
        </div>
      )}
      {v.header?.keys.map((k) => field(`Header {{${k}}}`, header[k], (s) => setHeader({ ...header, [k]: s })))}
      {v.body.map((k) => field(`Isi {{${k}}}`, body[k], (s) => setBody({ ...body, [k]: s })))}
      {v.buttons.map((b) => b.keys.map((k) => field(`Tombol "${b.text}" {{${k}}}`, buttons[k], (s) => setButtons({ ...buttons, [k]: s }))))}
      <div className="rounded-lg bg-chat-bg p-3">
        <div className="ml-auto max-w-[90%] rounded-lg bg-bubble-out px-3 py-2 text-sm shadow-sm">
          <FormattedText text={renderTemplateText(selected.components, params)} />
        </div>
        {selected.components
          .find((c) => c.type === 'BUTTONS')
          ?.buttons?.map((b) => (
            <div key={b.text} className="mt-1 ml-auto max-w-[90%] rounded-lg bg-bubble-out px-3 py-1.5 text-center text-sm text-sky-700 shadow-sm dark:text-sky-400">
              {b.text}
            </div>
          ))}
      </div>
      <Button type="submit" disabled={disabled || busy || uploading || (!!mediaHeader && !headerMedia)}>
        {busy ? 'Mengirim…' : submitLabel}
      </Button>
    </form>
  );
}

/** Kirim template ke percakapan yang sedang dibuka. */
export function TemplatePicker({
  open,
  onOpenChange,
  conversationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId: string;
}) {
  const qc = useQueryClient();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Kirim template</DialogTitle>
          <DialogDescription>Template yang disetujui Meta boleh dikirim kapan saja, termasuk di luar jendela 24 jam.</DialogDescription>
        </DialogHeader>
        <TemplateComposer
          submitLabel="Kirim template"
          onSubmit={async (template, params) => {
            const { message } = await api<{ message: MessageDTO }>(`/api/conversations/${conversationId}/messages`, {
              method: 'POST',
              body: { type: 'template', templateId: template.id, params, clientRef: crypto.randomUUID() },
            });
            upsertMessage(qc, message);
            if (message.status === 'failed') toast.error(message.error?.message ?? 'Template gagal dikirim.');
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Mulai chat ke nomor yang belum pernah menghubungi (wajib template). */
export function NewChatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const normalized = normalizePhone(phone);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Chat baru</DialogTitle>
          <DialogDescription>Pesan pertama ke nomor baru harus memakai template yang disetujui Meta.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-phone">Nomor WhatsApp</Label>
          <Input id="new-phone" inputMode="tel" placeholder="0812-3456-7890" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <span className="text-xs text-muted-foreground">
            {phone && !normalized ? 'Nomor belum valid.' : normalized ? `Dikirim ke +${normalized}` : 'Boleh diawali 08, 62, atau +62.'}
          </span>
        </div>
        <TemplateComposer
          submitLabel="Mulai chat"
          disabled={!normalized}
          onSubmit={async (template, params) => {
            const res = await api<{ conversation: ConversationDTO; message: MessageDTO }>('/api/conversations/start', {
              method: 'POST',
              body: { phone, templateId: template.id, params, clientRef: crypto.randomUUID() },
            });
            applyConversation(qc, res.conversation, true);
            if (res.message.status === 'failed') toast.error(res.message.error?.message ?? 'Template gagal dikirim.');
            onOpenChange(false);
            setPhone('');
            navigate(`/chats/${res.conversation.id}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
