import { Check, CircleX, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBytes } from './helpers';
import type { UploadItem } from './useUploadQueue';

function StatusIcon({ status }: { status: UploadItem['status'] }) {
  if (status === 'uploading')
    return <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />;
  if (status === 'queued') return <Clock className="size-4 shrink-0 text-muted-foreground" />;
  if (status === 'done') return <Check className="size-4 shrink-0 text-emerald-600" />;
  return <CircleX className="size-4 shrink-0 text-destructive" />;
}

const STATUS_TEXT: Record<UploadItem['status'], string> = {
  queued: 'Menunggu giliran',
  uploading: 'Mengunggah…',
  done: 'Terunggah, sedang diproses',
  failed: 'Gagal diunggah',
  rejected: 'Tidak diunggah',
};

/** Hasil unggah per berkas: menunggu, sedang diunggah, berhasil, gagal (bisa dicoba lagi), atau ditolak sebelum diunggah. */
export function UploadList({
  items,
  busy,
  onRetry,
  onClear,
}: {
  items: UploadItem[];
  busy: boolean;
  onRetry: (item: UploadItem) => void;
  onClear: () => void;
}) {
  if (items.length === 0) return null;
  const finished = items.filter((i) => i.status !== 'queued' && i.status !== 'uploading').length;
  const failed = items.filter((i) => i.status === 'failed' || i.status === 'rejected').length;
  return (
    <section aria-label="Unggahan" className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <span className="text-sm font-medium" aria-live="polite">
          {busy
            ? `Mengunggah ${Math.min(finished + 1, items.length)} dari ${items.length} berkas…`
            : failed > 0
              ? `Selesai: ${items.length - failed} terunggah, ${failed} tidak`
              : `${items.length} berkas terunggah`}
        </span>
        {!busy && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Tutup
          </Button>
        )}
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto">
        {items.map((item) => {
          const problem = item.status === 'failed' || item.status === 'rejected';
          return (
            <li key={item.id} className="flex items-start gap-3 px-3 py-2 text-sm">
              <span className="mt-0.5">
                <StatusIcon status={item.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 font-medium break-all">{item.file.name}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(item.file.size)}</span>
                </div>
                <div className={cn('text-xs', problem ? 'text-destructive' : 'text-muted-foreground')}>
                  {STATUS_TEXT[item.status]}
                  {problem && item.message ? `: ${item.message}` : ''}
                </div>
              </div>
              {item.status === 'failed' && (
                <Button variant="outline" size="sm" onClick={() => onRetry(item)}>
                  Coba lagi
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
