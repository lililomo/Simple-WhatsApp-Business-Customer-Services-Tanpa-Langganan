import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { Popover } from 'radix-ui';
import { ChevronDown, Gauge } from 'lucide-react';
import type { UsageDTO } from '@wa/shared';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const angka = (n: number) => n.toLocaleString('id-ID');
const tanggalReset = (iso: string) => format(new Date(iso), "d MMMM yyyy 'pukul' HH.mm", { locale: id });

export function useUsage() {
  return useQuery({
    queryKey: ['usage'],
    queryFn: () => api<UsageDTO>('/api/usage'),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

type Tone = 'ok' | 'low' | 'out';

function toneOf(data: UsageDTO): Tone {
  if (data.remaining > 200) return 'ok';
  if (data.servicePricingPolicy === 'PAID_EXEMPT') return 'ok';
  return data.remaining > 0 ? 'low' : 'out';
}

/** Apa yang terjadi setelah kuota habis, menurut status pengecualian instansi pemerintah di Meta. */
function afterLimit(data: UsageDTO): string {
  if (data.servicePricingPolicy === 'PAID_EXEMPT')
    return 'Tetap gratis. Akun ini tercatat sebagai instansi pemerintah (PAID_EXEMPT) sampai 31 Des 2027.';
  if (data.servicePricingPolicy === 'REGULAR')
    return `Balasan tetap terkirim, tetapi pesan ke-${angka(data.freeLimit + 1)} dan seterusnya bulan ini ditagih Meta per pesan (status akun REGULAR).`;
  return 'Status pengecualian instansi pemerintah belum bisa dibaca dari Meta.';
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={cn('rounded-lg px-3 py-2', strong ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
      <div className={cn('text-xs', strong ? 'opacity-80' : 'text-muted-foreground')}>{label}</div>
      <div className="text-xl leading-tight font-bold tabular-nums">{angka(value)}</div>
    </div>
  );
}

/** Sisa kuota pesan service gratis bulan ini (nomor kantor), dengan rincian saat diklik. */
export function QuotaChip() {
  const { data } = useUsage();
  if (!data) return null;
  const tone = toneOf(data);
  const pct = Math.min(100, (data.used / data.freeLimit) * 100);
  const templates = Math.max(data.local.templates, data.meta?.templates ?? 0);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            'group w-full rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40',
            tone === 'low' && 'border-amber-500/60 bg-amber-500/10',
            tone === 'out' && 'border-destructive/60 bg-destructive/10',
          )}
          aria-label={`Pesan gratis bulan ini: ${angka(data.remaining)} dari ${angka(data.freeLimit)} tersisa. Klik untuk rincian.`}
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Gauge className="size-4 shrink-0" />
            <span className="flex-1">Pesan gratis bulan ini</span>
            <span className="flex items-center gap-0.5 font-medium group-hover:text-foreground">
              Rincian <ChevronDown className="size-3.5" />
            </span>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-3xl leading-none font-bold tabular-nums',
                tone === 'out' && 'text-destructive',
              )}
            >
              {angka(data.remaining)}
            </span>
            <span className="text-sm text-muted-foreground">tersisa dari {angka(data.freeLimit)}</span>
          </div>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted" role="presentation">
            <div
              className={cn(
                'h-full rounded-full',
                tone === 'ok' ? 'bg-emerald-500' : tone === 'low' ? 'bg-amber-500' : 'bg-destructive',
              )}
              style={{ width: `${Math.max(pct, data.used > 0 ? 1.5 : 0)}%` }}
            />
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {tone === 'out' ? (
              <span className="font-semibold text-destructive">
                Kuota habis. Balasan berikutnya ditagih Meta.
              </span>
            ) : tone === 'low' ? (
              <span className="font-semibold text-amber-700 dark:text-amber-400">
                Kuota hampir habis. {angka(data.used)} sudah terpakai.
              </span>
            ) : (
              <>
                {angka(data.used)} terpakai · direset{' '}
                {format(new Date(data.resetsAt), 'd MMM', { locale: id })}
              </>
            )}
          </div>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-lg"
        >
          <div className="text-base font-bold">Kuota pesan gratis WhatsApp</div>
          <p className="mt-0.5 text-muted-foreground">Bulan ini, untuk nomor kantor</p>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Sisa" value={data.remaining} strong />
            <Stat label="Terpakai" value={data.used} />
            <Stat label="Batas gratis" value={data.freeLimit} />
          </div>

          <div className="mt-4 font-semibold">Apa yang dihitung?</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Setiap balasan ke warga di dalam jendela 24 jam (teks, gambar, dokumen, stiker, termasuk balasan
              otomatis) = <b className="text-foreground">1 pesan</b>, dihitung saat sampai di HP warga.
            </li>
            <li>Pesan masuk dari warga tidak dihitung.</li>
            <li>Pesan dari aplikasi lain yang memakai nomor ini (mis. Kirimdev) ikut dihitung.</li>
            <li>
              Pesan template tidak memakai kuota ini; Meta menagihnya terpisah.
              {templates > 0 && ` Bulan ini: ${angka(templates)} template.`}
            </li>
          </ul>

          <div className="mt-4 font-semibold">Kalau kuota habis?</div>
          <p className="mt-1 text-muted-foreground">{afterLimit(data)}</p>

          <div className="mt-4 rounded-lg bg-muted px-3 py-2">
            Kuota kembali penuh pada <b>{tanggalReset(data.resetsAt)}</b>.
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Angka terpakai diambil dari yang terbesar antara hitungan realtime WA Inbox (
            {angka(data.local.service)}) dan laporan resmi Meta (
            {data.meta
              ? `${angka(data.meta.service)}, diambil ${formatDateTime(data.meta.fetchedAt)}`
              : data.metaError
                ? `belum tersedia: ${data.metaError}`
                : 'belum tersedia'}
            ). Laporan Meta bisa tertunda beberapa jam.
            {data.meta &&
              data.meta.cost > 0 &&
              ` Perkiraan biaya bulan ini menurut Meta: ${data.meta.currency ?? ''} ${angka(data.meta.cost)}.`}
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
