import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AOS_EFFORTS, type AosMode, type AssistantSettings, type AssistantSettingsDTO } from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConnectionCard } from './assistant/ConnectionCard';
import { DomainEditor } from './assistant/DomainEditor';
import { Field, NumberField, Select, SwitchRow } from './assistant/fields';
import {
  checkSettings,
  EFFORT_LABEL,
  fullOrder,
  isEqual,
  modelOptions,
  normalizeSettings,
} from './assistant/helpers';
import { PlaygroundCard } from './assistant/PlaygroundCard';
import { useAssistantSettings, useSaveAssistantSettings } from './assistant/queries';
import { UsageCard } from './assistant/UsageCard';

const EFFORT_OPTIONS = AOS_EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABEL[effort] }));
const TONE_OPTIONS: { value: AssistantSettings['style']['tone']; label: string }[] = [
  { value: 'ramah', label: 'Ramah' },
  { value: 'formal', label: 'Formal' },
];
const MODES: { value: AosMode; label: string; hint: string }[] = [
  {
    value: 'offer',
    label: 'Tawarkan dulu',
    hint: 'Panel terbuka sendiri dan menawarkan bantuan; rekomendasi dibuat setelah petugas memilih.',
  },
  { value: 'auto', label: 'Otomatis', hint: 'Untuk pertanyaan yang jelas, rekomendasi langsung dibuat.' },
  { value: 'manual', label: 'Manual', hint: 'AOS hanya bekerja saat diminta.' },
];

/** Bagian pengaturan yang berupa objek, untuk diubah sebagian lewat `setSection`. */
type SectionKey = 'answer' | 'triage' | 'sources' | 'privacy' | 'style';

function SettingsForm({ data }: { data: AssistantSettingsDTO }) {
  const saved = useMemo(() => normalizeSettings(data.settings), [data.settings]);
  // Perubahan yang belum disimpan. Selama null, formulir mengikuti data server, jadi pembaruan dari admin lain
  // atau dari kartu koneksi langsung tampil; begitu ada perubahan, isian admin ini tidak tertimpa.
  const [draft, setDraft] = useState<AssistantSettings | null>(null);
  const form = draft ?? saved;
  const dirty = draft !== null && !isEqual(draft, saved);
  const check = useMemo(() => checkSettings(form), [form]);
  const save = useSaveAssistantSettings();
  const anyConnected = data.providers.some((p) => p.connected);

  const edit = (change: (current: AssistantSettings) => AssistantSettings) =>
    setDraft((current) => change(current ?? saved));
  const setSection = <K extends SectionKey>(key: K, patch: Partial<AssistantSettings[K]>) =>
    edit((current) => ({ ...current, [key]: { ...current[key], ...patch } }));

  // Menutup atau memuat ulang tab saat masih ada perubahan: browser bertanya dulu.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const submit = () => {
    if (!check.data) return;
    save.mutate(check.data, {
      onSuccess: () => {
        setDraft(null);
        toast.success('Pengaturan Asisten AI disimpan.');
      },
    });
  };
  const discard = () => {
    setDraft(null);
    save.reset();
  };

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Umum</CardTitle>
            <CardDescription>
              Saat menyala, panel AOS tersedia di samping ruang chat untuk semua petugas.
            </CardDescription>
          </div>
          <Badge variant={data.ready ? 'success' : 'secondary'}>
            {data.ready ? 'AOS aktif' : 'AOS belum aktif'}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SwitchRow
            checked={form.enabled}
            onChange={(enabled) => edit((current) => ({ ...current, enabled }))}
            label="Nyalakan AOS"
          />
          {!anyConnected && (
            <Alert variant="warning">
              AOS baru aktif setelah minimal satu koneksi ke Claude ditambahkan di bagian berikut.
            </Alert>
          )}
        </CardContent>
      </Card>

      <ConnectionCard
        order={form.order}
        providers={data.providers}
        onSwap={() => edit((current) => ({ ...current, order: fullOrder(current.order).reverse() }))}
      />

      <Card>
        <CardHeader>
          <CardTitle>Model jawaban</CardTitle>
          <CardDescription>
            Model yang menyusun rekomendasi jawaban. Model dan tingkat penalaran yang lebih tinggi lebih
            teliti, tetapi lebih lambat.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Model" htmlFor="aos-answer-model">
            <Select
              id="aos-answer-model"
              value={form.answer.model}
              onChange={(model) => setSection('answer', { model })}
              options={modelOptions(form.answer.model)}
            />
          </Field>
          <Field label="Tingkat penalaran" htmlFor="aos-answer-effort">
            <Select
              id="aos-answer-effort"
              value={form.answer.effort}
              onChange={(effort) => setSection('answer', { effort })}
              options={EFFORT_OPTIONS}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deteksi awal</CardTitle>
          <CardDescription>
            Setiap pesan masuk dibaca sekilas oleh model ringan untuk memutuskan apakah AOS perlu menawarkan
            bantuan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SwitchRow
            checked={form.triage.enabled}
            onChange={(enabled) => setSection('triage', { enabled })}
            label="Nyalakan deteksi awal"
            hint={form.triage.enabled ? undefined : 'Selama mati, AOS hanya bekerja saat diminta petugas.'}
          />
          <div className={cn('flex flex-col gap-4', !form.triage.enabled && 'opacity-60')}>
            <Field label="Model deteksi" htmlFor="aos-triage-model" className="sm:max-w-xs">
              <Select
                id="aos-triage-model"
                value={form.triage.model}
                onChange={(model) => setSection('triage', { model })}
                options={modelOptions(form.triage.model)}
              />
            </Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm leading-none font-medium">Cara kerja</legend>
              {MODES.map((mode) => (
                <label key={mode.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="aos-triage-mode"
                    className="mt-1 accent-[var(--primary)]"
                    checked={form.triage.mode === mode.value}
                    onChange={() => setSection('triage', { mode: mode.value })}
                  />
                  <span>
                    <span className="font-medium">{mode.label}</span>
                    <span className="block text-xs text-muted-foreground">{mode.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field
              label="Jeda sebelum membaca pesan (detik)"
              htmlFor="aos-triage-debounce"
              hint="AOS menunggu sebentar supaya pesan beruntun dibaca sekaligus. 2 sampai 60 detik."
            >
              <NumberField
                id="aos-triage-debounce"
                min={2}
                max={60}
                step={1}
                value={form.triage.debounceSec}
                onChange={(debounceSec) => setSection('triage', { debounceSec })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sumber</CardTitle>
          <CardDescription>Dari mana AOS boleh mengambil bahan jawaban.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SwitchRow
            checked={form.sources.library}
            onChange={(library) => setSection('sources', { library })}
            label="Pustaka"
            hint="Berkas dan catatan yang diunggah petugas di menu Pustaka."
          />
          <SwitchRow
            checked={form.sources.web}
            onChange={(web) => setSection('sources', { web })}
            label="Internet (hanya situs di daftar)"
            hint="AOS hanya boleh mencari dan membuka situs yang ada di daftar di bawah."
          />
          <div className={cn('flex flex-col gap-4', !form.sources.web && 'opacity-60')}>
            <DomainEditor
              domains={form.sources.domains}
              onChange={(domains) => setSection('sources', { domains })}
            />
            <Field
              label="Maksimal pencarian internet per jawaban"
              htmlFor="aos-max-searches"
              hint="1 sampai 10 pencarian."
            >
              <NumberField
                id="aos-max-searches"
                min={1}
                max={10}
                step={1}
                value={form.sources.maxSearches}
                onChange={(maxSearches) => setSection('sources', { maxSearches })}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Privasi</CardTitle>
          <CardDescription>Apa saja dari chat Wajib Pajak (WP) yang ikut dikirim ke Claude.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SwitchRow
            checked={form.privacy.mask}
            onChange={(mask) => setSection('privacy', { mask })}
            label="Samarkan NIK/NPWP, nomor telepon, dan email"
            hint="Diganti penanda seperti [ID-1] sebelum dikirim, lalu dikembalikan di tampilan petugas."
          />
          {!form.privacy.mask && (
            <Alert variant="warning">
              Tanpa penyamaran, NIK/NPWP, nomor telepon, dan email di chat WP dikirim apa adanya ke Claude.
            </Alert>
          )}
          <SwitchRow
            checked={form.privacy.attachments}
            onChange={(attachments) => setSection('privacy', { attachments })}
            label="Izinkan AOS membaca lampiran kiriman WP"
            hint="Gambar dari pesan WP terbaru (maksimal 3) ikut dikirim."
          />
          <Field
            label="Jumlah pesan terakhir yang dibaca AOS"
            htmlFor="aos-context-messages"
            hint="5 sampai 100 pesan. Makin banyak makin paham konteks, tetapi lebih lambat."
          >
            <NumberField
              id="aos-context-messages"
              min={5}
              max={100}
              step={1}
              value={form.privacy.contextMessages}
              onChange={(contextMessages) => setSection('privacy', { contextMessages })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gaya</CardTitle>
          <CardDescription>Bekal tentang kantor dan cara AOS menulis jawaban.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Field
            label="Profil kantor"
            htmlFor="aos-office-profile"
            hint="Jam layanan, alamat, layanan, kontak."
          >
            <Textarea
              id="aos-office-profile"
              rows={5}
              maxLength={4000}
              value={form.style.officeProfile}
              onChange={(e) => setSection('style', { officeProfile: e.target.value })}
            />
          </Field>
          <Field
            label="Instruksi tambahan"
            htmlFor="aos-instructions"
            hint="Aturan khusus cara menjawab, mis. sapaan yang dipakai atau hal yang harus selalu diarahkan ke petugas."
          >
            <Textarea
              id="aos-instructions"
              rows={5}
              maxLength={4000}
              value={form.style.instructions}
              onChange={(e) => setSection('style', { instructions: e.target.value })}
            />
          </Field>
          <Field label="Nada bahasa" htmlFor="aos-tone" className="sm:max-w-xs">
            <Select
              id="aos-tone"
              value={form.style.tone}
              onChange={(tone) => setSection('style', { tone })}
              options={TONE_OPTIONS}
            />
          </Field>
        </CardContent>
      </Card>

      <UsageCard />
      <PlaygroundCard canAsk={anyConnected} />

      {dirty && (
        <div
          role="region"
          aria-label="Simpan perubahan"
          className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-lg"
        >
          <div className="min-w-0 flex-1 basis-56 text-sm">
            {check.problems.length > 0 ? (
              <ul className="flex flex-col gap-0.5 text-destructive">
                {check.problems.slice(0, 3).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : save.isError ? (
              <span className="text-destructive">{errorMessage(save.error)}</span>
            ) : (
              'Ada perubahan yang belum disimpan.'
            )}
          </div>
          <Button variant="ghost" disabled={save.isPending} onClick={discard}>
            Batalkan
          </Button>
          <Button disabled={save.isPending || check.problems.length > 0} onClick={submit}>
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      )}
    </>
  );
}

export function AssistantSettingsPage() {
  const query = useAssistantSettings();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Asisten AI</h2>
        <p className="text-sm text-muted-foreground">
          AOS (Asisten OSing) menyarankan jawaban untuk petugas di samping ruang chat. AOS tidak pernah
          mengirim pesan sendiri ke WhatsApp; petugas yang memeriksa, menyunting, lalu mengirim.
        </p>
      </div>
      {query.isError && <Alert variant="destructive">{errorMessage(query.error)}</Alert>}
      {query.isPending && <Skeleton className="h-64 w-full" />}
      {query.data && <SettingsForm data={query.data} />}
    </div>
  );
}
