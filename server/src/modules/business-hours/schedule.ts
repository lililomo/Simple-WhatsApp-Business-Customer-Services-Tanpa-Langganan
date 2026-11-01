import { WEEKDAYS, type BusinessHoursSettings, type BusinessHoursStatus, type HolidayDTO, type Weekday } from '@wa/shared';

export const TIMEZONE = 'Asia/Jakarta';

/** Tanggal, hari, dan jam lokal (WIB) dari sebuah waktu. */
export function localParts(date: Date, timeZone = TIMEZONE): { day: string; weekday: Weekday; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const weekday = WEEKDAYS.find((d) => d === String(parts.weekday).toLowerCase().slice(0, 3))!;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday, time: `${parts.hour}:${parts.minute}` };
}

const isDayOff = (h: HolidayDTO, settings: BusinessHoursSettings) =>
  h.type === 'Observance' ? false : h.type === 'Joint Holiday' ? settings.jointHolidaysAreHolidays : true;

/**
 * Apakah waktu ini di dalam jam kerja. holidaysOnDay = hari libur pada tanggal lokal tersebut.
 * Jam selesai tidak termasuk (16:00 tepat sudah di luar jam kerja bila jam selesai 16:00).
 */
export function evaluate(settings: BusinessHoursSettings, holidaysOnDay: HolidayDTO[], at: Date): BusinessHoursStatus {
  const { weekday, time } = localParts(at);
  const localTime = time;
  if (!settings.holidaysAreWorkdays) {
    const holiday = holidaysOnDay.find((h) => isDayOff(h, settings));
    if (holiday) return { open: false, reason: 'holiday', holidayName: holiday.name, localTime };
  }
  const day = settings.days[weekday];
  if (!day.active) return { open: false, reason: 'day_off', holidayName: null, localTime };
  if (time < day.start || time >= day.end) return { open: false, reason: 'outside_hours', holidayName: null, localTime };
  return { open: true, reason: null, holidayName: null, localTime };
}
