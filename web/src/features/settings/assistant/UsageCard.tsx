import { useState, type ReactNode } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { AOS_PROVIDER_LABEL, type AosUsageDTO } from '@wa/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { currentMonthWib, formatCount, formatMonth, formatUsd, modelLabel } from './helpers';
import { useAssistantUsage } from './queries';

/** Nama keperluan panggilan (ai_calls.purpose) untuk admin; nilai yang belum dikenal ditampilkan apa adanya. */
const PURPOSE_LABEL: Record<string, string> = {
  answer: 'Rekomendasi jawaban',
  triage: 'Deteksi awal',
  summary: 'Ringkasan dokumen Pustaka',
  image: 'Membaca gambar Pustaka',
  test: 'Uji koneksi',
  playground: 'Coba AOS',
};

function Stat({ label, value, hint }: { label: ReactNode; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">{label}</div>
      <div className="text-lg leading-tight font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

interface BarRow {
  key: string;
  label: string;
  calls: number;
  costUsd: number;
  failed?: number;
}

/** Batang mendatar sederhana (div), panjangnya sebanding jumlah panggilan dalam kelompoknya. */
function BarList({ title, rows }: { title: string; rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.calls));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada data.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex flex-col gap-1"
              title={`${row.label}: ${formatCount(row.calls)} panggilan, ${formatUsd(row.costUsd)}`}
            >
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatCount(row.calls)} panggilan · {formatUsd(row.costUsd)}
                  {row.failed ? ` · ${formatCount(row.failed)} gagal` : ''}
                </span>
              </div>
              <div
                className="h-2 rounded-r-[4px] bg-primary"
                style={{ width: `${Math.max(1, (row.calls / max) * 100)}%` }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RankedList({ title, items }: { title: string; items: { name: string; count: number }[] }) {
  const top = [...items].sort((a, b) => b.count - a.count).slice(0, 10);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {top.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada data.</p>
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border text-sm">
          {top.map((item, index) => (
            <li key={item.name} className="flex items-baseline gap-2 px-3 py-1.5">
              <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{index + 1}.</span>
              <span className="min-w-0 flex-1 break-words">{item.name}</span>
              <span className="shrink-0 font-medium tabular-nums">{formatCount(item.count)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function UsageBody({ usage }: { usage: AosUsageDTO }) {
  const { totals, answers, offers } = usage;
  const usedShare =
    answers.made > 0 ? `${Math.round((answers.used / answers.made) * 100)}% dari yang dibuat` : undefined;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Panggilan ke Claude" value={formatCount(totals.calls)} />
        <Stat label="Token masuk" value={formatCount(totals.inputTokens)} />
        <Stat label="Token keluar" value={formatCount(totals.outputTokens)} />
        <Stat label="Biaya" value={formatUsd(totals.costUsd)} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <BarList
          title="Per jalur"
          rows={usage.byProvider.map((p) => ({
            key: p.provider,
            label: AOS_PROVIDER_LABEL[p.provider] ?? p.provider,
            calls: p.calls,
            costUsd: p.costUsd,
            failed: p.failed,
          }))}
        />
        <BarList
          title="Per model"
          rows={usage.byModel.map((m) => ({
            key: m.model,
            label: modelLabel(m.model),
            calls: m.calls,
            costUsd: m.costUsd,
          }))}
        />
        <BarList
          title="Per keperluan"
          rows={usage.byPurpose.map((p) => ({
            key: p.purpose,
            label: PURPOSE_LABEL[p.purpose] ?? p.purpose,
            calls: p.calls,
            costUsd: p.costUsd,
          }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Rekomendasi jawaban</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Dibuat" value={formatCount(answers.made)} />
          <Stat label="Dipakai petugas" value={formatCount(answers.used)} hint={usedShare} />
          <Stat
            label={
              <>
                <ThumbsUp /> Dinilai membantu
              </>
            }
            value={formatCount(answers.up)}
          />
          <Stat
            label={
              <>
                <ThumbsDown /> Dinilai kurang
              </>
            }
            value={formatCount(answers.down)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Tawaran bantuan</h3>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Dibuat" value={formatCount(offers.made)} />
          <Stat label="Dijawab" value={formatCount(offers.answered)} />
          <Stat label="Ditutup" value={formatCount(offers.dismissed)} />
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <RankedList
          title="Topik yang paling sering ditanyakan"
          items={usage.topics.map((t) => ({ name: t.topic, count: t.count }))}
        />
        <RankedList
          title="Kategori"
          items={usage.categories.map((c) => ({ name: c.category, count: c.count }))}
        />
      </div>
    </div>
  );
}

/** Pemakaian AOS per bulan (WIB): panggilan, token, biaya, dan seberapa sering sarannya dipakai. */
export function UsageCard() {
  const thisMonth = currentMonthWib();
  const [month, setMonth] = useState(thisMonth);
  // Teks kolom dipegang terpisah: browser tanpa pemilih bulan menampilkan kotak teks biasa, dan isian yang
  // belum berbentuk YYYY-MM tidak boleh dipakai untuk mengambil data.
  const [text, setText] = useState(thisMonth);
  const usage = useAssistantUsage(month);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1.5">
          <CardTitle>Pemakaian</CardTitle>
          <CardDescription>
            Panggilan ke Claude, biaya, dan seberapa sering saran AOS dipakai selama {formatMonth(month)}.
          </CardDescription>
        </div>
        <Input
          type="month"
          aria-label="Bulan pemakaian"
          className="w-44 dark:scheme-dark"
          max={thisMonth}
          placeholder="YYYY-MM"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value);
          }}
          onBlur={() => setText(month)}
        />
      </CardHeader>
      <CardContent>
        {usage.isError && <Alert variant="destructive">{errorMessage(usage.error)}</Alert>}
        {usage.isPending && <Skeleton className="h-48 w-full" />}
        {usage.data && <UsageBody usage={usage.data} />}
      </CardContent>
    </Card>
  );
}
