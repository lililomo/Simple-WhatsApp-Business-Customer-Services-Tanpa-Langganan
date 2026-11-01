import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, LayoutTemplate, Loader2, Paperclip, SendHorizontal, ShieldAlert, X } from 'lucide-react';
import {
  DOCUMENT_MIMES,
  MEDIA_LIMITS,
  mediaKindFor,
  messagePreview,
  looksLikeSensitiveNumber,
  TEXT_MAX,
  windowRemainingMs,
  type ConversationDTO,
  type MediaDTO,
  type MessageDTO,
  type SendMessageBody,
} from '@wa/shared';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/hooks';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatBytes, useNow } from './bits';
import { upsertMessage } from './queries';
import { TemplatePicker } from './TemplatePicker';

interface Attachment {
  file: File;
  media: MediaDTO | null;
  uploading: boolean;
  error: string | null;
}

function validateFile(file: File): string | null {
  const mime = file.type || 'application/octet-stream';
  const kind = mediaKindFor(mime);
  if (kind === 'document' && !DOCUMENT_MIMES.includes(mime)) return 'Jenis file ini tidak didukung WhatsApp. Kirim PDF, dokumen Office, atau gambar JPG/PNG.';
  if (file.size > MEDIA_LIMITS[kind].maxBytes) return `File terlalu besar. Batas: ${MEDIA_LIMITS[kind].label}.`;
  return null;
}

export function Composer({
  conversation,
  replyTo,
  onClearReply,
}: {
  conversation: ConversationDTO;
  replyTo: MessageDTO | null;
  onClearReply: () => void;
}) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const windowOpen = windowRemainingMs(conversation.cswExpiresAt, now) > 0;
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const send = useMutation({
    mutationFn: (body: SendMessageBody) =>
      api<{ message: MessageDTO }>(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body }),
    onSuccess: ({ message }) => upsertMessage(qc, message),
  });

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const pickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const invalid = validateFile(file);
    if (invalid) {
      setAttachment({ file, media: null, uploading: false, error: invalid });
      return;
    }
    setAttachment({ file, media: null, uploading: true, error: null });
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const { media } = await api<{ media: MediaDTO }>('/api/media', { method: 'POST', body: form });
      setAttachment({ file, media, uploading: false, error: null });
    } catch (err) {
      setAttachment({ file, media: null, uploading: false, error: errorMessage(err) });
    }
  };

  const canSend = windowOpen && !send.isPending && (attachment ? !!attachment.media : text.trim().length > 0);

  const submit = () => {
    if (!canSend) return;
    const clientRef = crypto.randomUUID();
    const trimmed = text.trim();
    const body: SendMessageBody = attachment?.media
      ? { type: 'media', mediaId: attachment.media.id, caption: trimmed || undefined, replyTo: replyTo?.id, clientRef }
      : { type: 'text', text: trimmed, replyTo: replyTo?.id, clientRef };
    // Tampilkan langsung (optimistis); diganti pesan dari server saat respons/event datang (dicocokkan lewat clientRef).
    const temp: MessageDTO = {
      id: `tmp-${clientRef}`,
      conversationId: conversation.id,
      wamid: null,
      direction: 'out',
      type: attachment?.media ? mediaKindFor(attachment.media.mimeType ?? '') : 'text',
      status: 'pending',
      text: trimmed || null,
      payload: null,
      media: attachment?.media ?? null,
      replyTo: replyTo?.wamid ? { wamid: replyTo.wamid, preview: messagePreview(replyTo.type, replyTo.text), direction: replyTo.direction } : null,
      reactionEmoji: null,
      templateName: null,
      sentBy: me ? { type: 'user', id: me.id, name: me.name } : null,
      clientRef,
      error: null,
      pricingCategory: null,
      timestamp: new Date().toISOString(),
    };
    upsertMessage(qc, temp);
    send.mutate(body, {
      onError: (err) =>
        upsertMessage(qc, { ...temp, status: 'failed', error: { code: null, title: null, detail: null, message: errorMessage(err) } }),
    });
    setText('');
    setAttachment(null);
    onClearReply();
    requestAnimationFrame(resize);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  if (!windowOpen) {
    return (
      <div className="flex flex-col items-center gap-2 border-t bg-card px-4 py-3 text-center text-sm">
        <p className="text-muted-foreground">
          Jendela 24 jam sudah tertutup. WhatsApp hanya mengizinkan <b>template</b> yang disetujui sampai kontak membalas lagi.
        </p>
        <Button size="sm" onClick={() => setTemplatesOpen(true)}>
          <LayoutTemplate /> Kirim template
        </Button>
        <TemplatePicker open={templatesOpen} onOpenChange={setTemplatesOpen} conversationId={conversation.id} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t bg-card px-3 py-2">
      {replyTo && (
        <div className="flex items-start gap-2 rounded-md border-l-4 border-primary bg-muted px-3 py-1.5 text-xs">
          <div className="min-w-0 flex-1">
            <div className="font-medium">Membalas {replyTo.direction === 'out' ? 'pesan Anda' : conversation.contact.name}</div>
            <div className="line-clamp-2 text-muted-foreground">{messagePreview(replyTo.type, replyTo.text)}</div>
          </div>
          <button onClick={onClearReply} aria-label="Batal membalas">
            <X className="size-4" />
          </button>
        </div>
      )}
      {attachment && (
        <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2 text-sm', attachment.error && 'border-destructive/50')}>
          {attachment.uploading ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{attachment.file.name}</div>
            <div className={cn('text-xs', attachment.error ? 'text-destructive' : 'text-muted-foreground')}>
              {attachment.error ?? (attachment.uploading ? 'Mengunggah…' : `${formatBytes(attachment.file.size)} · tulis keterangan (opsional) lalu kirim`)}
            </div>
          </div>
          <button onClick={() => setAttachment(null)} aria-label="Hapus lampiran">
            <X className="size-4" />
          </button>
        </div>
      )}
      {looksLikeSensitiveNumber(text) && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Pesan berisi deretan angka seperti NIK/NPWP. Kebijakan WhatsApp melarang meminta atau membagikan nomor identitas
            pribadi lewat chat. Pastikan memang perlu.
          </span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" className="hidden" onChange={pickFile} />
        <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Lampirkan file" disabled={!!attachment?.uploading}>
          <Paperclip />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => setTemplatesOpen(true)} aria-label="Kirim template">
          <LayoutTemplate />
        </Button>
        <textarea
          ref={textareaRef}
          rows={1}
          maxLength={TEXT_MAX}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            resize();
          }}
          onKeyDown={onKeyDown}
          placeholder={attachment ? 'Keterangan (opsional)' : 'Ketik pesan… (Enter kirim, Shift+Enter baris baru)'}
          className="max-h-40 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button size="icon" onClick={submit} disabled={!canSend} aria-label="Kirim">
          <SendHorizontal />
        </Button>
      </div>
      <TemplatePicker open={templatesOpen} onOpenChange={setTemplatesOpen} conversationId={conversation.id} />
    </div>
  );
}
