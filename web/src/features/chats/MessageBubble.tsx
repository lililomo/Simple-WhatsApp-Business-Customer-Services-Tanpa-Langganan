import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Download, FileText, MapPin, RefreshCw, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import type { MessageDTO } from '@wa/shared';
import { libraryKeys } from '@/features/library/queries';
import { api, errorMessage } from '@/lib/api';
import { upsertMessage } from './queries';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { FormattedText } from '@/lib/whatsapp-format';
import { formatBytes, StatusTicks } from './bits';

type Payload = Record<string, unknown>;
const field = <T,>(payload: Payload | null, ...path: string[]): T | undefined => {
  let cur: unknown = payload;
  for (const p of path) cur = cur && typeof cur === 'object' ? (cur as Payload)[p] : undefined;
  return cur as T | undefined;
};

function MediaState({ message }: { message: MessageDTO }) {
  const retry = useMutation({ mutationFn: () => api(`/api/media/${message.media!.id}/retry`, { method: 'POST' }) });
  if (message.media?.status === 'pending') {
    return <div className="flex h-24 w-56 animate-pulse items-center justify-center rounded-md bg-black/5 text-xs text-muted-foreground dark:bg-white/10">Mengunduh media…</div>;
  }
  return (
    <div className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
      <span>Media tidak tersedia.</span>
      {message.direction === 'in' && (
        <button className="inline-flex items-center gap-1 font-medium underline" disabled={retry.isPending} onClick={() => retry.mutate()}>
          <RefreshCw className={cn('size-3', retry.isPending && 'animate-spin')} /> Coba unduh lagi
        </button>
      )}
    </div>
  );
}

function MediaContent({ message }: { message: MessageDTO }) {
  const m = message.media;
  if (!m || m.status !== 'ready') return <MediaState message={message} />;
  switch (message.type) {
    case 'image':
      return (
        <a href={m.url} target="_blank" rel="noreferrer">
          <img src={m.url} alt={message.text ?? 'Gambar'} loading="lazy" className="max-h-80 max-w-full rounded-md object-contain" />
        </a>
      );
    case 'sticker':
      return <img src={m.url} alt="Stiker" loading="lazy" className="size-32 object-contain" />;
    case 'video':
      return <video src={m.url} controls preload="metadata" className="max-h-80 max-w-full rounded-md" />;
    case 'audio':
      return <audio src={m.url} controls preload="metadata" className="w-64 max-w-full" />;
    default:
      return (
        <a href={`${m.url}?download=1`} className="flex items-center gap-3 rounded-md bg-black/5 px-3 py-2 dark:bg-white/10">
          <FileText className="size-8 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{m.fileName ?? 'Dokumen'}</div>
            <div className="text-xs text-muted-foreground">{[m.mimeType, formatBytes(m.fileSize)].filter(Boolean).join(' · ')}</div>
          </div>
          <Download className="size-4 shrink-0" />
        </a>
      );
  }
}

function Body({ message }: { message: MessageDTO }) {
  const p = message.payload;
  switch (message.type) {
    case 'text':
    case 'template':
      return message.text ? <FormattedText text={message.text} /> : null;
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
      return (
        <div className="flex flex-col gap-1">
          <MediaContent message={message} />
          {message.text && <FormattedText text={message.text} />}
        </div>
      );
    case 'location': {
      const lat = field<number>(p, 'location', 'latitude');
      const lng = field<number>(p, 'location', 'longitude');
      return (
        <a
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 rounded-md bg-black/5 px-3 py-2 dark:bg-white/10"
        >
          <MapPin className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span className="text-sm">{message.text || `${lat}, ${lng}`}</span>
        </a>
      );
    }
    case 'contacts': {
      const list = field<{ name?: { formatted_name?: string }; phones?: { phone?: string }[] }[]>(p, 'contacts') ?? [];
      return (
        <div className="flex flex-col gap-1">
          {list.map((c, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
              <UserRound className="size-4 shrink-0" />
              <span>
                {c.name?.formatted_name} {c.phones?.map((ph) => ph.phone).filter(Boolean).join(', ')}
              </span>
            </div>
          ))}
        </div>
      );
    }
    case 'interactive':
    case 'button':
      return (
        <div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase">Pilihan tombol</div>
          {message.text && <FormattedText text={message.text} />}
        </div>
      );
    default:
      return <span className="text-sm text-muted-foreground italic">{message.text || 'Jenis pesan ini belum didukung WhatsApp Cloud API.'}</span>;
  }
}

function FailedNotice({ message }: { message: MessageDTO }) {
  const qc = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api<{ message: MessageDTO }>(`/api/messages/${message.id}/retry`, { method: 'POST' }),
    onSuccess: ({ message: updated }) => upsertMessage(qc, updated),
    onError: (err) => toast.error(errorMessage(err)),
  });
  // Pesan sementara (gagal sebelum sampai server) tidak bisa dikirim ulang dari sini.
  const canRetry = message.direction === 'out' && !message.id.startsWith('tmp-');
  return (
    <div className="mt-1 flex items-start gap-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
      <span className="flex-1">{message.error?.message}</span>
      {canRetry && (
        <button className="shrink-0 font-medium underline" disabled={retry.isPending} onClick={() => retry.mutate()}>
          {retry.isPending ? 'Mengirim…' : 'Coba lagi'}
        </button>
      )}
    </div>
  );
}

/** Simpan stiker dari pesan (mis. kiriman warga) ke koleksi stiker bersama. */
function SaveStickerButton({ message }: { message: MessageDTO }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api(`/api/stickers/from-message/${message.id}`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Stiker disimpan ke koleksi.');
      qc.invalidateQueries({ queryKey: libraryKeys.stickers });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (message.media?.status !== 'ready' || message.id.startsWith('tmp-')) return null;
  return (
    <button disabled={save.isPending} onClick={() => save.mutate()} className="rounded bg-background/90 px-1.5 text-[11px] text-muted-foreground shadow-sm hover:text-foreground">
      Simpan stiker
    </button>
  );
}

function senderLabel(m: MessageDTO): string | null {
  if (!m.sentBy) return null;
  return m.sentBy.type === 'api' ? `API: ${m.sentBy.name}` : m.sentBy.name;
}

export function MessageBubble({ message, onReply }: { message: MessageDTO; onReply?: (m: MessageDTO) => void }) {
  const out = message.direction === 'out';
  const sticker = message.type === 'sticker';
  return (
    <div className={cn('group flex px-3 py-0.5 md:px-6', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'relative max-w-[85%] rounded-xl px-2.5 py-1.5 text-sm md:max-w-[65%]',
          // Stiker tampil tanpa gelembung, seperti di WhatsApp.
          sticker ? 'bg-transparent shadow-none' : out ? 'rounded-tr-sm bg-bubble-out shadow-sm' : 'rounded-tl-sm bg-bubble-in shadow-sm',
          message.reactionEmoji && 'mb-3',
        )}
        onDoubleClick={() => onReply?.(message)}
      >
        {message.replyTo && (
          <div className={cn('mb-1 rounded-md border-l-4 bg-black/5 px-2 py-1 text-xs dark:bg-white/10', message.replyTo.direction === 'out' ? 'border-gold' : 'border-primary/60')}>
            <div className="font-medium">{message.replyTo.direction === 'out' ? 'Anda' : 'Kontak'}</div>
            <div className="line-clamp-2 text-muted-foreground">{message.replyTo.preview ?? 'Pesan tidak tersedia'}</div>
          </div>
        )}
        {message.templateName && <div className="text-[11px] font-medium text-muted-foreground">Template · {message.templateName}</div>}
        <Body message={message} />
        <div className={cn('mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted-foreground', sticker && 'w-fit self-end rounded-full bg-background/80 px-1.5 ml-auto')}>
          {out && message.sentBy?.type === 'system' && <Bot className="size-3" />}
          {out && senderLabel(message) && <span className="mr-1 truncate">{senderLabel(message)}</span>}
          <span>{formatTime(message.timestamp)}</span>
          {out && <StatusTicks status={message.status} />}
        </div>
        {message.status === 'failed' && message.error && <FailedNotice message={message} />}
        {message.reactionEmoji && (
          <span className="absolute -bottom-3.5 left-2 rounded-full border bg-background px-1 text-sm shadow-sm">{message.reactionEmoji}</span>
        )}
        <div className="absolute top-1 right-1 hidden gap-1 group-hover:flex">
          {sticker && <SaveStickerButton message={message} />}
          {onReply && (
            <button onClick={() => onReply(message)} className="rounded bg-background/90 px-1.5 text-[11px] text-muted-foreground shadow-sm hover:text-foreground">
              Balas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
