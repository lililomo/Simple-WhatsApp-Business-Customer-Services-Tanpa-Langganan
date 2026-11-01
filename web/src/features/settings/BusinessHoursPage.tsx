import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  describeSchedule,
  TEXT_MAX,
  WEEKDAY_LABEL,
  WEEKDAYS,
  type BusinessHoursDTO,
  type BusinessHoursSettings,
  type SaveBusinessHoursBody,
} from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton, Switch } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/textarea';
import { libraryKeys, useBusinessHours } from '@/features/library/queries';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const REASON: Record<string, string> = {
  day_off: 'hari ini bukan hari kerja',
  outside_hours: 'di luar jam kerja',
  holiday: 'hari libur',
};
const AUTO_VARIABLES = [
  { key: 'salam', label: 'Selamat pagi/siang/sore/malam' },
  { key: 'nama', label: 'Nama kontak' },
  { key: 'jam_kerja', label: 'Ringkasan jam kerja' },
];

function formatHolidayDate(date: string) {
  return new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`));
}

function StatusLine({ data }: { data: BusinessHoursDTO }) {
  const s = data.status;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={s.open ? 'success' : 'secondary'}>{s.open ? 'Jam kerja' : 'Di luar jam kerja'}</Badge>
      <span className="text-muted-foreground">
        Sekarang {s.localTime} WIB{s.open ? '' : ` · ${s.holidayName ?? REASON[s.reason ?? ''] ?? ''}`}
      </span>
    </div>
  );
}

function Form({ data }: { data: BusinessHoursDTO }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<BusinessHoursSettings>(data.settings);
  const [apiKey, setApiKey] = useState('');
  useEffect(() => setForm(data.settings), [data.settings]);

  const save = useMutation({
    mutationFn: (body: SaveBusinessHoursBody) => api<BusinessHoursDTO>('/api/business-hours', { method: 'PUT', body }),
    onSuccess: (dto) => {
      qc.setQueryData(libraryKeys.businessHours, dto);
      setApiKey('');
      toast.success('Pengaturan jam kerja disimpan.');
      if (dto.holidayError) toast.error(dto.holidayError);
    },
  });
  const sync = useMutation({
    mutationFn: () => api<{ synced: number; error: string | null; businessHours: BusinessHoursDTO }>('/api/business-hours/sync-holidays', { method: 'POST' }),
    onSuccess: (r) => {
      qc.setQueryData(libraryKeys.businessHours, r.businessHours);
      if (r.error) toast.error(r.error);
      else toast.success(`${r.synced} hari libur diperbarui.`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const setDay = (d: (typeof WEEKDAYS)[number], patch: Partial<BusinessHoursSettings['days']['mon']>) =>
    setForm({ ...form, days: { ...form.days, [d]: { ...form.days[d], ...patch } } });
  const setAuto = (patch: Partial<BusinessHoursSettings['autoReply']>) => setForm({ ...form, autoReply: { ...form.autoReply, ...patch } });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ ...form, ...(apiKey.trim() ? { holidayApiKey: apiKey.trim() } : {}) });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Hari & jam kerja</CardTitle>
          <CardDescription>Waktu Indonesia Barat (WIB). Ringkasan: {describeSchedule(form.days)}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {WEEKDAYS.map((d) => {
            const day = form.days[d];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3 py-2">
                <label className="flex w-28 items-center gap-2 text-sm font-medium">
                  <Switch checked={day.active} onCheckedChange={(active) => setDay(d, { active })} aria-label={`${WEEKDAY_LABEL[d]} hari kerja`} />
                  {WEEKDAY_LABEL[d]}
                </label>
                {day.active ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Input type="time" className="w-28" value={day.start} onChange={(e) => setDay(d, { start: e.target.value })} required aria-label={`Jam mulai ${WEEKDAY_LABEL[d]}`} />
                    <span>–</span>
                    <Input type="time" className="w-28" value={day.end} onChange={(e) => setDay(d, { end: e.target.value })} required aria-label={`Jam selesai ${WEEKDAY_LABEL[d]}`} />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Libur</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Hari libur nasional</CardTitle>
          <CardDescription>
            Data dari api.co.id (gratis, perlu API key dari dashboard api.co.id). Diperbarui otomatis setiap hari.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Hari libur nasional dianggap</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: false, label: 'Hari libur (di luar jam kerja)' },
                { value: true, label: 'Hari kerja biasa' },
              ].map((o) => (
                <button
                  key={String(o.value)}
                  type="button"
                  aria-pressed={form.holidaysAreWorkdays === o.value}
                  onClick={() => setForm({ ...form, holidaysAreWorkdays: o.value })}
                  className={cn('rounded-md border px-3 py-1.5 text-sm hover:bg-accent', form.holidaysAreWorkdays === o.value && 'border-gold bg-gold-soft font-semibold text-foreground')}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {!form.holidaysAreWorkdays && (
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.jointHolidaysAreHolidays} onCheckedChange={(v) => setForm({ ...form, jointHolidaysAreHolidays: v })} />
              Cuti bersama juga dianggap libur
            </label>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="bh-key">API key api.co.id</Label>
            <Input
              id="bh-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data.holidayApiKeySet ? 'Tersimpan. Kosongkan untuk memakai yang lama' : 'Tempel API key di sini'}
            />
            <p className="text-xs text-muted-foreground">
              {data.holidaysFetchedAt ? `Terakhir diperbarui ${formatDateTime(data.holidaysFetchedAt)}.` : 'Belum pernah diperbarui.'}
            </p>
            {data.holidayError && <Alert variant="warning">{data.holidayError}</Alert>}
          </div>
          {data.holidayApiKeySet && (
            <div>
              <Button type="button" variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
                <RefreshCw className={cn(sync.isPending && 'animate-spin')} /> Perbarui sekarang
              </Button>
            </div>
          )}
          {data.upcomingHolidays.length > 0 && (
            <div className="rounded-md border">
              <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-sm font-medium">
                <CalendarDays className="size-4" /> Hari libur mendatang
              </div>
              <ul className="max-h-56 divide-y overflow-y-auto text-sm">
                {data.upcomingHolidays.map((h) => (
                  <li key={`${h.date}-${h.name}`} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="w-36 shrink-0 text-muted-foreground">{formatHolidayDate(h.date)}</span>
                    <span className="min-w-0 flex-1">{h.name}</span>
                    {h.type === 'Joint Holiday' && <Badge variant="secondary">Cuti bersama</Badge>}
                    {h.type === 'Observance' && <Badge variant="secondary">Peringatan</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Balasan otomatis di luar jam kerja</CardTitle>
          <CardDescription>
            Dikirim sebagai pesan biasa (gratis, karena warga baru saja menghubungi). Bila Kirimdev juga mengirim balasan otomatis, matikan
            salah satunya agar warga tidak menerima dua balasan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch checked={form.autoReply.enabled} onCheckedChange={(enabled) => setAuto({ enabled })} />
            Aktifkan balasan otomatis
          </label>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bh-msg">Isi pesan</Label>
            <Textarea id="bh-msg" rows={5} maxLength={TEXT_MAX} required={form.autoReply.enabled} value={form.autoReply.message} onChange={(e) => setAuto({ message: e.target.value })} />
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Variabel:
              {AUTO_VARIABLES.map((v) => (
                <button key={v.key} type="button" title={v.label} onClick={() => setAuto({ message: `${form.autoReply.message}{${v.key}}` })} className="rounded border bg-muted px-1.5 py-0.5 font-mono hover:bg-accent">
                  {`{${v.key}}`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Kapan dikirim</Label>
            {[
              { value: 'daily', label: 'Sekali sehari per nomor', hint: 'Pesan berikutnya dari nomor yang sama di hari itu tidak dibalas lagi.' },
              { value: 'every', label: 'Setiap pesan masuk', hint: 'Pesan beruntun dalam 1 menit dari nomor yang sama hanya dibalas sekali.' },
            ].map((o) => (
              <label key={o.value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="bh-mode" className="mt-1" checked={form.autoReply.mode === o.value} onChange={() => setAuto({ mode: o.value as 'daily' | 'every' })} />
                <span>
                  {o.label}
                  <span className="block text-xs text-muted-foreground">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </div>
    </form>
  );
}

export function BusinessHoursPage() {
  const query = useBusinessHours();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Jam kerja & balasan otomatis</h2>
        {query.data && <StatusLine data={query.data} />}
      </div>
      {query.isError && <Alert variant="destructive">{errorMessage(query.error)}</Alert>}
      {query.isPending && <Skeleton className="h-64 w-full" />}
      {query.data && <Form data={query.data} />}
    </div>
  );
}
