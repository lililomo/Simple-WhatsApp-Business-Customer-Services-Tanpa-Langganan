import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Crop, FileText, Loader2, Music, Plus, SendHorizontal, X } from 'lucide-react';
import { CAPTION_MAX, DOCUMENT_MIMES, MEDIA_LIMITS, mediaKindFor } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatBytes } from '../chats/bits';
import { CropEditor } from './CropEditor';
import { cropImage, normalizeImage } from './image-tools';

export const MAX_ATTACHMENTS = 10;

export interface PreparedAttachment {
  file: File;
  caption: string;
}

interface Item {
  id: string;
  file: File;
  url: string;
  caption: string;
  error: string | null;
  processing: boolean;
}

const isImage = (f: File) => f.type.startsWith('image/');

function validate(file: File): string | null {
  const mime = file.type || 'application/octet-stream';
  const kind = mediaKindFor(mime);
  if (kind === 'document' && !DOCUMENT_MIMES.includes(mime)) {
    return 'Jenis file ini tidak didukung WhatsApp. Kirim PDF, dokumen Office, gambar, video MP4, atau audio.';
  }
  if (file.size > MEDIA_LIMITS[kind].maxBytes) return `File terlalu besar. Batas: ${MEDIA_LIMITS[kind].label}.`;
  return null;
}

let seq = 0;
function makeItem(file: File): Item {
  const image = isImage(file);
  return { id: `att-${++seq}`, file, url: URL.createObjectURL(file), caption: '', error: image ? null : validate(file), processing: image };
}

/**
 * Pratinjau lampiran sebelum dikirim (seperti WhatsApp Web): beberapa file sekaligus, keterangan per file,
 * crop/putar foto. Gambar selain JPG/PNG atau di atas 5 MB otomatis diubah agar diterima WhatsApp.
 */
export function AttachmentDialog({
  files,
  onClose,
  onSend,
}: {
  files: File[];
  onClose: () => void;
  onSend: (items: PreparedAttachment[]) => void;
}) {
  const [items, setItems] = useState<Item[]>(() => files.slice(0, MAX_ATTACHMENTS).map(makeItem));
  const [current, setCurrent] = useState(0);
  const [cropping, setCropping] = useState(false);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  // Gambar yang sudah mulai dinormalisasi; mencegah proses ganda saat efek dijalankan ulang.
  const started = useRef(new Set<string>());

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  useEffect(() => {
    for (const it of items) {
      if (!it.processing || started.current.has(it.id)) continue;
      started.current.add(it.id);
      normalizeImage(it.file)
        .then((file) => {
          if (file === it.file) return update(it.id, { processing: false });
          URL.revokeObjectURL(it.url);
          update(it.id, { file, url: URL.createObjectURL(file), processing: false, error: null });
        })
        .catch((err: unknown) => update(it.id, { processing: false, error: err instanceof Error ? err.message : 'Gambar tidak bisa diproses.' }));
    }
  }, [items]);

  const add = (incoming: File[]) => {
    const fresh = incoming.slice(0, Math.max(0, MAX_ATTACHMENTS - items.length)).map(makeItem);
    if (fresh.length === 0) return;
    setCurrent(items.length);
    setItems([...items, ...fresh]);
  };

  // URL pratinjau dilepas saat dialog ditutup (bukan di cleanup efek, yang di mode dev React dijalankan dua kali).
  const close = () => {
    itemsRef.current.forEach((it) => URL.revokeObjectURL(it.url));
    onClose();
  };

  const item = items[Math.min(current, items.length - 1)];
  const remove = (id: string) => {
    const idx = items.findIndex((it) => it.id === id);
    const target = items[idx];
    if (target) URL.revokeObjectURL(target.url);
    const next = items.filter((it) => it.id !== id);
    setItems(next);
    if (next.length === 0) close();
    else setCurrent(Math.min(idx, next.length - 1));
  };

  const applyCrop = async (area: { x: number; y: number; width: number; height: number }, rotation: number) => {
    if (!item) return;
    setBusy(true);
    try {
      const file = await normalizeImage(await cropImage(item.file, area, rotation));
      URL.revokeObjectURL(item.url);
      update(item.id, { file, url: URL.createObjectURL(file), error: null });
      setCropping(false);
    } catch (err) {
      update(item.id, { error: err instanceof Error ? err.message : 'Gagal memotong gambar.' });
    } finally {
      setBusy(false);
    }
  };

  const sendable = items.filter((it) => !it.error && !it.processing);
  const waiting = items.some((it) => it.processing);
  const submit = () => {
    if (waiting || sendable.length === 0) return;
    onSend(sendable.map((it) => ({ file: it.file, caption: it.caption.trim() })));
    close();
  };

  const kind = item ? mediaKindFor(item.file.type || 'application/octet-stream') : 'document';

  return (
    <Dialog open onOpenChange={(v) => !v && close()}>
      <DialogContent className="flex h-[min(46rem,92svh)] flex-col gap-3 p-4 sm:max-w-3xl">
        <DialogTitle className="text-base">
          Kirim lampiran {items.length > 1 && <span className="font-normal text-muted-foreground">({items.length} file)</span>}
        </DialogTitle>
        <DialogDescription className="sr-only">Periksa lampiran, tambahkan keterangan, lalu kirim.</DialogDescription>

        {item && cropping && isImage(item.file) ? (
          <CropEditor src={item.url} busy={busy} onCancel={() => setCropping(false)} onApply={applyCrop} applyLabel="Pakai hasil crop" />
        ) : (
          item && (
            <>
              <div className="chat-surface relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border">
                {item.processing ? (
                  <Loader2 className="size-8 animate-spin text-muted-foreground" />
                ) : kind === 'image' || isImage(item.file) ? (
                  <img src={item.url} alt={item.file.name} className="max-h-full max-w-full object-contain" />
                ) : kind === 'video' ? (
                  <video src={item.url} controls className="max-h-full max-w-full" />
                ) : (
                  <div className="flex flex-col items-center gap-3 rounded-xl bg-card px-8 py-6 text-center shadow-sm">
                    {kind === 'audio' ? <Music className="size-12 text-muted-foreground" /> : <FileText className="size-12 text-muted-foreground" />}
                    <div className="max-w-xs truncate font-medium">{item.file.name}</div>
                    <div className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</div>
                    {kind === 'audio' && <audio src={item.url} controls className="w-64" />}
                  </div>
                )}
                {isImage(item.file) && !item.processing && !item.error && (
                  <Button type="button" size="sm" variant="secondary" className="absolute top-3 left-3 shadow" onClick={() => setCropping(true)}>
                    <Crop /> Crop & putar
                  </Button>
                )}
              </div>
              {item.error && <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{item.error} File ini tidak akan dikirim.</div>}
              {kind !== 'audio' && (
                <input
                  value={item.caption}
                  maxLength={CAPTION_MAX}
                  onChange={(e) => update(item.id, { caption: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
                  placeholder="Tambahkan keterangan…"
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  autoFocus
                />
              )}
            </>
          )
        )}

        {!cropping && (
          <div className="flex items-center gap-2">
            <div className="scrollbar-thin flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
              {items.map((it, i) => (
                <div key={it.id} className="group relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setCurrent(i)}
                    className={cn(
                      'flex size-14 items-center justify-center overflow-hidden rounded-lg border-2 bg-muted',
                      i === current ? 'border-gold' : 'border-transparent',
                      it.error && 'opacity-50',
                    )}
                    aria-label={it.file.name}
                  >
                    {isImage(it.file) ? <img src={it.url} alt="" className="size-full object-cover" /> : <FileText className="size-6 text-muted-foreground" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(it.id)}
                    aria-label={`Hapus ${it.file.name}`}
                    className="absolute -top-1.5 -right-1.5 hidden size-5 items-center justify-center rounded-full bg-foreground text-background group-hover:flex"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {items.length < MAX_ATTACHMENTS && (
                <button
                  type="button"
                  onClick={() => addRef.current?.click()}
                  className="flex size-14 shrink-0 items-center justify-center rounded-lg border-2 border-dashed text-muted-foreground hover:bg-accent"
                  aria-label="Tambah file"
                >
                  <Plus />
                </button>
              )}
              <input
                ref={addRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  add([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </div>
            <Button
              type="button"
              size="icon"
              className="size-12 shrink-0 rounded-full bg-gold text-gold-foreground shadow-md hover:bg-gold-hover"
              disabled={waiting || sendable.length === 0}
              onClick={submit}
              aria-label={`Kirim ${sendable.length} file`}
            >
              {waiting ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
