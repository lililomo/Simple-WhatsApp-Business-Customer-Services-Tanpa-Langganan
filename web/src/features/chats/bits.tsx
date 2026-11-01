import { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCheck, Clock } from 'lucide-react';
import { windowRemainingMs, type MessageStatus } from '@wa/shared';
import { cn } from '@/lib/utils';

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function initials(name: string): string {
  const letters = name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (letters || '#').toUpperCase();
}

const AVATAR_COLORS = ['bg-emerald-600', 'bg-sky-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600', 'bg-indigo-600'];

export function Avatar({ name, seed, className }: { name: string; seed: string; className?: string }) {
  const color = AVATAR_COLORS[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return (
    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white', color, className)}>
      {initials(name)}
    </div>
  );
}

export function formatRemaining(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} j ${m} m` : `${m} m`;
}

/** Penanda jendela layanan 24 jam. */
export function WindowBadge({ cswExpiresAt, compact = false }: { cswExpiresAt: string | null; compact?: boolean }) {
  const now = useNow();
  const ms = windowRemainingMs(cswExpiresAt, now);
  if (ms <= 0) {
    return compact ? null : <span className="text-xs text-muted-foreground">Jendela 24 jam tertutup · balas dengan template</span>;
  }
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-xs', ms < 3_600_000 ? 'text-amber-600' : 'text-emerald-600')}
      title="Sisa jendela layanan 24 jam"
    >
      <Clock className="size-3" />
      {compact ? formatRemaining(ms) : `Jendela 24 jam: sisa ${formatRemaining(ms)}`}
    </span>
  );
}

export function StatusTicks({ status, className }: { status: MessageStatus; className?: string }) {
  const cls = cn('size-3.5 shrink-0', className);
  switch (status) {
    case 'pending':
      return <Clock className={cls} aria-label="Mengirim" />;
    case 'accepted':
    case 'sent':
      return <Check className={cls} aria-label="Terkirim" />;
    case 'delivered':
      return <CheckCheck className={cls} aria-label="Diterima" />;
    case 'read':
      return <CheckCheck className={cn(cls, 'text-sky-500')} aria-label="Dibaca" />;
    case 'failed':
      return <AlertCircle className={cn(cls, 'text-destructive')} aria-label="Gagal" />;
    default:
      return null;
  }
}

export function formatBytes(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
