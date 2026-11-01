import { useImperativeHandle, useRef, useState, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Paperclip, SendHorizontal, ShieldAlert, Smile, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  fillVariables,
  greetingFor,
  looksLikeSensitiveNumber,
  mediaKindFor,
  messagePreview,
  TEXT_MAX,
  windowRemainingMs,
  type ConversationDTO,
  type MediaDTO,
  type MessageDTO,
  type QuickReplyDTO,
  type SendMessageBody,
  type StickerDTO,
} from '@wa/shared';
import { Button } from '@/components/ui/button';
import { useMe } from '@/features/auth/hooks';
import { AttachmentDialog, type PreparedAttachment } from '@/features/composer/AttachmentDialog';
import { extractEmojis } from '@/features/composer/emoji-data';
import { EmojiStickerPanel } from '@/features/composer/EmojiStickerPanel';
import { filterQuickReplies, QuickReplyButton, QuickReplyList } from '@/features/composer/QuickReplyMenu';
import { recordQuickReplyUse, useQuickReplies } from '@/features/library/queries';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useNow } from './bits';
import { upsertMessage } from './queries';
import { TemplatePicker } from './TemplatePicker';

export interface ComposerHandle {
  /** Tambahkan file (dari drag & drop di area chat) ke pratinjau lampiran. */
  addFiles: (files: File[]) => void;
}

export function Composer({
  ref,
  conversation,
  replyTo,
  onClearReply,
}: {
  ref?: Ref<ComposerHandle>;
  conversation: ConversationDTO;
  replyTo: MessageDTO | null;
  onClearReply: () => void;
}) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const windowOpen = windowRemainingMs(conversation.cswExpiresAt, now) > 0;
  const [text, setText] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [panel, setPanel] = useState<'emoji' | 'sticker' | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const quickReplies = useQuickReplies();

  // Ketik "/" di awal kotak balas untuk memilih balasan cepat (seperti WhatsApp Business).
  const slashQuery = !slashDismissed && /^\/\S*$/.test(text) ? text.slice(1) : null;
  const slashItems = slashQuery === null ? [] : filterQuickReplies(quickReplies.data ?? [], slashQuery).slice(0, 8);

  const send = useMutation({
    mutationFn: (body: SendMessageBody) => api<{ message: MessageDTO }>(`/api/conversations/${conversation.id}/messages`, { method: 'POST', body }),
    onSuccess: ({ message }) => upsertMessage(qc, message),
  });

  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const setTextAndCaret = (next: string, caret: number) => {
    setText(next);
    setSlashDismissed(false);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      resize();
    });
  };

  const insertAtCursor = (insert: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setTextAndCaret(text.slice(0, start) + insert + text.slice(end), start + insert.length);
  };

  const applyQuickReply = (r: QuickReplyDTO) => {
    const filled = fillVariables(r.body, { salam: greetingFor(new Date()), nama: conversation.contact.name, petugas: me?.name });
    recordQuickReplyUse(r.id);
    if (slashQuery !== null) setTextAndCaret(filled, filled.length);
    else insertAtCursor(filled);
    setSlashIndex(0);
  };

  /** Pesan sementara agar langsung tampil; diganti pesan dari server (dicocokkan lewat clientRef). */
  const optimistic = (clientRef: string, patch: Partial<MessageDTO>): MessageDTO => {
    const temp: MessageDTO = {
      id: `tmp-${clientRef}`,
      conversationId: conversation.id,
      wamid: null,
      direction: 'out',
      type: 'text',
      status: 'pending',
      text: null,
      payload: null,
      media: null,
      replyTo: replyTo?.wamid ? { wamid: replyTo.wamid, preview: messagePreview(replyTo.type, replyTo.text), direction: replyTo.direction } : null,
      reactionEmoji: null,
      templateName: null,
      sentBy: me ? { type: 'user', id: me.id, name: me.name } : null,
      clientRef,
      error: null,
      pricingCategory: null,
      timestamp: new Date().toISOString(),
      ...patch,
    };
    upsertMessage(qc, temp);
    return temp;
  };
  const failed = (temp: MessageDTO, err: unknown) =>
    upsertMessage(qc, { ...temp, status: 'failed', error: { code: null, title: null, detail: null, message: errorMessage(err) } });

  const sendText = () => {
    const trimmed = text.trim();
    if (!windowOpen || !trimmed) return;
    const clientRef = crypto.randomUUID();
    const temp = optimistic(clientRef, { text: trimmed });
    send.mutate({ type: 'text', text: trimmed, replyTo: replyTo?.id, clientRef }, { onError: (err) => failed(temp, err) });
    // Riwayat emoji bersama: dicatat dari emoji yang benar-benar dikirim.
    const emojis = extractEmojis(trimmed);
    if (emojis.length) void api('/api/emoji/usage', { method: 'POST', body: { emojis: emojis.slice(0, 50) } }).catch(() => undefined);
    setText('');
    onClearReply();
    requestAnimationFrame(resize);
  };

  const sendSticker = (sticker: StickerDTO) => {
    if (!windowOpen) return;
    const clientRef = crypto.randomUUID();
    const media: MediaDTO = { id: `tmp-${sticker.id}`, mimeType: 'image/webp', fileName: null, fileSize: null, status: 'ready', url: sticker.url };
    const temp = optimistic(clientRef, { type: 'sticker', media });
    send.mutate({ type: 'sticker', stickerId: sticker.id, replyTo: replyTo?.id, clientRef }, { onError: (err) => failed(temp, err) });
    onClearReply();
  };

  /** Kirim lampiran satu per satu agar urutannya sama dengan urutan di pratinjau. */
  const sendAttachments = async (items: PreparedAttachment[]) => {
    let reply = replyTo;
    onClearReply();
    for (const { file, caption } of items) {
      const clientRef = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      const local: MediaDTO = { id: `tmp-${clientRef}`, mimeType: file.type, fileName: file.name, fileSize: file.size, status: 'ready', url: previewUrl };
      const temp = optimistic(clientRef, { type: mediaKindFor(file.type || 'application/octet-stream'), text: caption || null, media: local });
      try {
        const form = new FormData();
        form.append('file', file, file.name);
        const { media } = await api<{ media: MediaDTO }>('/api/media', { method: 'POST', body: form });
        await send.mutateAsync({ type: 'media', mediaId: media.id, caption: caption || undefined, replyTo: reply?.id, clientRef });
      } catch (err) {
        failed(temp, err);
      } finally {
        reply = null;
        // URL pratinjau dilepas setelah gelembung diganti versi server.
        setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
      }
    }
  };

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!windowOpen) {
      toast.error('Jendela 24 jam sudah tertutup: lampiran tidak bisa dikirim. Kirim template dulu.');
      return;
    }
    setPendingFiles((cur) => [...(cur ?? []), ...files]);
  };
  useImperativeHandle(ref, () => ({ addFiles }));

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashItems.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyQuickReply(slashItems[Math.min(slashIndex, slashItems.length - 1)]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (e.key === 'Escape' && panel) setPanel(null);
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendText();
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
    <div className="flex flex-col">
      {panel && (
        <EmojiStickerPanel
          tab={panel}
          onTab={setPanel}
          onClose={() => setPanel(null)}
          onEmoji={insertAtCursor}
          onSticker={sendSticker}
        />
      )}
      <div className="relative flex flex-col gap-2 border-t bg-card px-3 py-2">
        {slashItems.length > 0 && (
          <div className="absolute right-3 bottom-full left-3 z-20 mb-2 max-h-80 overflow-y-auto rounded-xl border bg-popover shadow-lg">
            <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">Balasan cepat · ↑↓ pilih, Enter pakai, Esc tutup</div>
            <QuickReplyList items={slashItems} activeIndex={Math.min(slashIndex, slashItems.length - 1)} onPick={applyQuickReply} onHover={setSlashIndex} />
          </div>
        )}
        {replyTo && (
          <div className="flex items-start gap-2 rounded-lg border-l-4 border-gold bg-muted px-3 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Membalas {replyTo.direction === 'out' ? 'pesan Anda' : conversation.contact.name}</div>
              <div className="line-clamp-2 text-muted-foreground">{messagePreview(replyTo.type, replyTo.text)}</div>
            </div>
            <button onClick={onClearReply} aria-label="Batal membalas">
              <X className="size-4" />
            </button>
          </div>
        )}
        {looksLikeSensitiveNumber(text) && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Pesan berisi deretan angka seperti NIK/NPWP. Kebijakan WhatsApp melarang meminta atau membagikan nomor identitas pribadi lewat
              chat. Pastikan memang perlu.
            </span>
          </div>
        )}
        <div className="flex items-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPanel(panel ? null : 'emoji')}
            aria-label="Emoji dan stiker"
            aria-pressed={!!panel}
            className={cn(panel && 'bg-gold-soft text-foreground')}
          >
            {panel ? <X /> : <Smile />}
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" size="icon" onClick={() => fileRef.current?.click()} aria-label="Lampirkan file" title="Lampirkan file (atau tarik ke area chat)">
            <Paperclip />
          </Button>
          <QuickReplyButton onPick={applyQuickReply} />
          <Button variant="ghost" size="icon" onClick={() => setTemplatesOpen(true)} aria-label="Kirim template" title="Template Meta">
            <LayoutTemplate />
          </Button>
          <textarea
            ref={textareaRef}
            rows={1}
            maxLength={TEXT_MAX}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSlashDismissed(false);
              setSlashIndex(0);
              resize();
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Ketik pesan · / balasan cepat"
            className="ml-1 max-h-40 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <Button
            size="icon"
            onClick={sendText}
            disabled={!text.trim() || send.isPending}
            aria-label="Kirim"
            className="ml-1 size-10 rounded-full bg-gold text-gold-foreground shadow-sm hover:bg-gold-hover"
          >
            <SendHorizontal />
          </Button>
        </div>
      </div>
      <TemplatePicker open={templatesOpen} onOpenChange={setTemplatesOpen} conversationId={conversation.id} />
      {pendingFiles && <AttachmentDialog files={pendingFiles} onClose={() => setPendingFiles(null)} onSend={(items) => void sendAttachments(items)} />}
    </div>
  );
}
