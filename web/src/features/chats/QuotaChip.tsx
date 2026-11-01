import { useQuery } from '@tanstack/react-query';
import { Popover } from 'radix-ui';
import { Gauge } from 'lucide-react';
import type { UsageDTO } from '@wa/shared';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const angka = (n: number) => n.toLocaleString('id-ID');

export function useUsage() {
  return useQuery({ queryKey: ['usage'], queryFn: () => api<UsageDTO>('/api/usage'), refetchInterval: 30_000, staleTime: 15_000 });
}

/** Sisa kuota 1.000 pesan service gratis bulan ini (nomor kantor), dengan rincian saat diklik. */
export function QuotaChip() {
  const { data } = useUsage();
  if (!data) return null;
  const exempt = data.servicePricingPolicy === 'PAID_EXEMPT';
  const tone = data.remaining > 200 ? 'ok' : data.remaining > 0 ? 'low' : exempt ? 'ok' : 'out';
  const pct = Math.min(100, Math.round((data.used / data.freeLimit) * 100));

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent',
            tone === 'low' && 'border-amber-500/50 bg-amber-500/10',
            tone === 'out' && 'border-destructive/50 bg-destructive/10',
          )}
          aria-label="Kuota pesan gratis bulan ini"
        >
          <Gauge className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{angka(data.remaining)}</span> dari {angka(data.freeLimit)} pesan gratis tersisa
            <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
              <span
                className={cn('block h-full rounded-full', tone === 'ok' ? 'bg-emerald-500' : tone === 'low' ? 'bg-amber-500' : 'bg-destructive')}
                style={{ width: `${pct}%` }}
              />
            </span>
          </span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="bottom" align="start" sideOffset={6} className="z-50 w-80 rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
          <div className="font-semibold">Kuota pesan service bulan ini</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Meta menggratiskan {angka(data.freeLimit)} pesan service (balasan biasa, bukan template) per nomor per bulan. Dihitung saat pesan
            sampai di HP warga, dari semua aplikasi yang memakai nomor ini.
          </p>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
            <dt>Terpakai</dt>
            <dd className="text-right font-semibold">{angka(data.used)}</dd>
            <dt className="text-muted-foreground">Hitungan realtime WA Inbox</dt>
            <dd className="text-right">{angka(data.local.service)}</dd>
            <dt className="text-muted-foreground">Laporan Meta</dt>
            <dd className="text-right">{data.meta ? angka(data.meta.service) : '—'}</dd>
            <dt className="text-muted-foreground">Template terkirim (berbayar terpisah)</dt>
            <dd className="text-right">{angka(Math.max(data.local.templates, data.meta?.templates ?? 0))}</dd>
            {data.meta && data.meta.cost > 0 && (
              <>
                <dt className="text-muted-foreground">Perkiraan biaya Meta</dt>
                <dd className="text-right">
                  {data.meta.currency ?? ''} {angka(data.meta.cost)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Kuota direset</dt>
            <dd className="text-right">{formatDateTime(data.resetsAt)}</dd>
          </dl>
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs">
            {exempt
              ? 'Status Meta: PAID_EXEMPT (instansi pemerintah). Pesan service di atas kuota tetap gratis sampai 31 Des 2027.'
              : data.servicePricingPolicy === 'REGULAR'
                ? 'Status Meta: REGULAR. Pesan service ke-1.001 dan seterusnya bulan ini akan ditagih.'
                : 'Status pengecualian instansi pemerintah belum bisa dibaca dari Meta.'}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {data.meta ? `Laporan Meta diambil ${formatDateTime(data.meta.fetchedAt)} (bisa tertunda beberapa jam).` : `Laporan Meta belum tersedia${data.metaError ? `: ${data.metaError}` : '.'}`}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
