import { z } from 'zod';
import { TEXT_MAX } from './send';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Senin',
  tue: 'Selasa',
  wed: 'Rabu',
  thu: 'Kamis',
  fri: 'Jumat',
  sat: 'Sabtu',
  sun: 'Minggu',
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM');

const daySchedule = z
  .object({ active: z.boolean(), start: time, end: time })
  .refine((d) => !d.active || d.start < d.end, { message: 'Jam selesai harus setelah jam mulai', path: ['end'] });

export const businessHoursSettings = z.object({
  days: z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, daySchedule])) as Record<Weekday, typeof daySchedule>),
  /** false: hari libur nasional diperlakukan sebagai di luar jam kerja. */
  holidaysAreWorkdays: z.boolean(),
  /** Cuti bersama ikut dianggap libur (hanya berlaku bila holidaysAreWorkdays false). */
  jointHolidaysAreHolidays: z.boolean(),
  autoReply: z.object({
    enabled: z.boolean(),
    message: z.string().trim().max(TEXT_MAX),
    /** every: setiap pesan (dengan jeda minimal per nomor); daily: sekali per nomor per hari. */
    mode: z.enum(['every', 'daily']),
  }),
});
export type BusinessHoursSettings = z.infer<typeof businessHoursSettings>;

export const DEFAULT_BUSINESS_HOURS: BusinessHoursSettings = {
  days: {
    mon: { active: true, start: '07:30', end: '16:00' },
    tue: { active: true, start: '07:30', end: '16:00' },
    wed: { active: true, start: '07:30', end: '16:00' },
    thu: { active: true, start: '07:30', end: '16:00' },
    fri: { active: true, start: '07:30', end: '16:30' },
    sat: { active: false, start: '08:00', end: '12:00' },
    sun: { active: false, start: '08:00', end: '12:00' },
  },
  holidaysAreWorkdays: false,
  jointHolidaysAreHolidays: true,
  autoReply: {
    enabled: false,
    message:
      '{salam} {nama}, terima kasih telah menghubungi KPP Pratama Banyuwangi. Pesan Anda kami terima di luar jam layanan ({jam_kerja}). Petugas kami akan membalas pada jam layanan berikutnya.',
    mode: 'daily',
  },
};

export const saveBusinessHoursBody = businessHoursSettings.extend({
  /** API key api.co.id; kosong = tidak diubah, null = hapus. */
  holidayApiKey: z.string().trim().max(200).nullish(),
});
export type SaveBusinessHoursBody = z.infer<typeof saveBusinessHoursBody>;

export interface HolidayDTO {
  date: string;
  name: string;
  type: string;
}

export interface BusinessHoursStatus {
  open: boolean;
  /** Alasan bila tutup: 'day_off' | 'outside_hours' | 'holiday'. */
  reason: 'day_off' | 'outside_hours' | 'holiday' | null;
  holidayName: string | null;
  localTime: string;
}

export interface BusinessHoursDTO {
  settings: BusinessHoursSettings;
  holidayApiKeySet: boolean;
  holidaysFetchedAt: string | null;
  holidayError: string | null;
  upcomingHolidays: HolidayDTO[];
  status: BusinessHoursStatus;
}

/** Ringkasan jam kerja untuk variabel {jam_kerja}, mis. "Senin–Kamis 07.30–16.00, Jumat 07.30–16.30". */
export function describeSchedule(days: BusinessHoursSettings['days']): string {
  const groups: { from: Weekday; to: Weekday; hours: string }[] = [];
  for (const d of WEEKDAYS) {
    const s = days[d];
    if (!s.active) continue;
    const hours = `${s.start.replace(':', '.')}–${s.end.replace(':', '.')}`;
    const last = groups.at(-1);
    const prevDay = WEEKDAYS[WEEKDAYS.indexOf(d) - 1];
    if (last && last.hours === hours && last.to === prevDay) last.to = d;
    else groups.push({ from: d, to: d, hours });
  }
  if (groups.length === 0) return 'tidak ada jadwal';
  return groups
    .map((g) => `${WEEKDAY_LABEL[g.from]}${g.from === g.to ? '' : `–${WEEKDAY_LABEL[g.to]}`} ${g.hours}`)
    .join(', ');
}
