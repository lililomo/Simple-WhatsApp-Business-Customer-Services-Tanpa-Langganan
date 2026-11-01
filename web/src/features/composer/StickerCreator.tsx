import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import type { StickerDTO } from '@wa/shared';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { libraryKeys } from '@/features/library/queries';
import { api, errorMessage } from '@/lib/api';
import { CropEditor } from './CropEditor';
import { makeSticker } from './image-tools';

/** Buat stiker dari gambar: pilih file, crop persegi, lalu disimpan sebagai WebP 512×512 ke koleksi bersama. */
export function StickerCreator({ initialFile, onClose, onCreated }: { initialFile?: File; onClose: () => void; onCreated?: (s: StickerDTO) => void }) {
  const qc = useQueryClient();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Pilih file gambar (JPG, PNG, WebP, atau GIF).');
      return;
    }
    // URL lama dilepas oleh efek pembersih di bawah.
    setSrc(URL.createObjectURL(file));
  };

  useEffect(() => {
    pick(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  const create = async (area: { x: number; y: number; width: number; height: number }) => {
    if (!src) return;
    setBusy(true);
    try {
      const blob = await makeSticker(src, area);
      const form = new FormData();
      form.append('file', blob, 'stiker.webp');
      const { sticker } = await api<{ sticker: StickerDTO }>('/api/stickers', { method: 'POST', body: form });
      await qc.invalidateQueries({ queryKey: libraryKeys.stickers });
      toast.success('Stiker ditambahkan ke koleksi.');
      onCreated?.(sticker);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error && !('status' in err) ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[min(40rem,90svh)] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Buat stiker</DialogTitle>
          <DialogDescription>Stiker tersimpan untuk semua petugas. Bagian transparan pada PNG tetap transparan.</DialogDescription>
        </DialogHeader>
        {src ? (
          <CropEditor src={src} aspects={[{ label: '1:1', value: 1 }]} rotatable={false} busy={busy} applyLabel={busy ? 'Menyimpan…' : 'Simpan stiker'} onCancel={onClose} onApply={create} />
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files[0]);
            }}
            className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed text-muted-foreground hover:bg-accent"
          >
            <ImagePlus className="size-10" />
            <span className="text-sm">Klik atau tarik gambar ke sini</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      </DialogContent>
    </Dialog>
  );
}
