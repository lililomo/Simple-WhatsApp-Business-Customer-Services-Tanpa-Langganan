import { format, formatDistanceToNowStrict, isSameDay, isSameYear, isYesterday } from 'date-fns';
import { id } from 'date-fns/locale';

export function formatDateTime(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy HH:mm', { locale: id });
}

export function formatTime(iso: string): string {
  return format(new Date(iso), 'HH:mm', { locale: id });
}

/** Waktu ringkas untuk daftar percakapan: jam (hari ini), "Kemarin", atau tanggal. */
export function formatListTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (isSameDay(d, now)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Kemarin';
  return format(d, isSameYear(d, now) ? 'd MMM' : 'd/M/yy', { locale: id });
}

/** Label pemisah tanggal di ruang chat. */
export function formatDayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (isSameDay(d, now)) return 'Hari ini';
  if (isYesterday(d)) return 'Kemarin';
  return format(d, 'EEEE, d MMMM yyyy', { locale: id });
}

export function formatRelative(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { locale: id, addSuffix: true });
}
