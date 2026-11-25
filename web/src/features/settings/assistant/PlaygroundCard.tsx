import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BookOpen, Globe, Loader2, Send } from 'lucide-react';
import {
  AOS_PROVIDER_LABEL,
  parseAosAnswer,
  type AosConfidence,
  type AosPlaygroundDTO,
  type AosSource,
} from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { FormattedText } from '@/lib/whatsapp-format';
import { formatDuration, modelLabel } from './helpers';
import { usePlayground } from './queries';

const CONFIDENCE: Record<AosConfidence, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  tinggi: { label: 'Keyakinan tinggi', variant: 'success' },
  sedang: { label: 'Keyakinan sedang', variant: 'warning' },
  rendah: { label: 'Keyakinan rendah', variant: 'destructive' },
};

const sourceClass =
  'inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-accent [&_svg]:size-3.5 [&_svg]:shrink-0';

function SourceChip({ source }: { source: AosSource }) {
  if (source.type === 'library') {
    const label = `${source.title}${source.page ? ` · hlm ${source.page}` : ''}`;
    const content = (
      <>
        <BookOpen /> <span className="truncate">{label}</span>
      </>
    );
    // Membuka Pustaka dan menyorot dokumennya.
    return source.documentId ? (
      <Link to={`/pustaka?doc=${encodeURIComponent(source.documentId)}`} className={sourceClass}>
        {content}
      </Link>
    ) : (
      <span className={sourceClass}>{content}</span>
    );
  }
  const content = (
    <>
      <Globe /> <span className="truncate">{source.title || source.url}</span>
    </>
  );
  return source.url && /^https?:\/\//i.test(source.url) ? (
    <a href={source.url} target="_blank" rel="noopener noreferrer nofollow" className={sourceClass}>
      {content}
    </a>
  ) : (
    <span className={sourceClass}>{content}</span>
  );
}

function PlaygroundResult({ result }: { result: AosPlaygroundDTO }) {
  // Server sudah memilah jawaban; teks mentahnya dibaca lagi hanya untuk bagian yang tidak ikut terkirim
  // (mis. jawaban bebas tanpa bagian <draf>).
  const parsed = parseAosAnswer(result.text);
  const draft = result.answer.draft ?? parsed.draft;
  const notes = result.answer.notes ?? parsed.notes;
  const confidence = result.answer.confidence ?? parsed.confidence;
  const plain = draft ? null : parsed.plain;
  const sources = result.answer.sources;

  return (
    <section className="flex flex-col gap-3" aria-label="Jawaban AOS">
      {draft && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">Draf balasan</div>
          <div className="rounded-lg border bg-bubble-out px-3 py-2 text-sm">
            <FormattedText text={draft} />
          </div>
        </div>
      )}
      {plain && (
        <div className="rounded-lg border bg-muted/50 px-3 py-2 text-sm">
          <FormattedText text={plain} />
        </div>
      )}
      {!draft && !plain && !notes && (
        <p className="text-sm text-muted-foreground">AOS tidak memberi jawaban untuk pertanyaan ini.</p>
      )}
      {notes && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">Catatan untuk petugas</div>
          <div className="text-sm">
            <FormattedText text={notes} />
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium text-muted-foreground">Sumber</div>
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source, index) => (
              <SourceChip
                key={`${source.type}-${source.documentId ?? source.url ?? index}-${source.page ?? ''}`}
                source={source}
              />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {confidence && <Badge variant={CONFIDENCE[confidence].variant}>{CONFIDENCE[confidence].label}</Badge>}
        <span>
          {[
            AOS_PROVIDER_LABEL[result.provider] ?? result.provider,
            modelLabel(result.model),
            formatDuration(result.durationMs),
          ].join(' · ')}
        </span>
      </div>
    </section>
  );
}

/** Mencoba AOS tanpa membuka chat: satu pertanyaan, satu jawaban, memakai pengaturan yang sudah tersimpan. */
export function PlaygroundCard({ canAsk }: { canAsk: boolean }) {
  const [text, setText] = useState('');
  const ask = usePlayground();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const question = text.trim();
    if (question && canAsk && !ask.isPending) ask.mutate(question);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Coba AOS</CardTitle>
        <CardDescription>
          Tulis pertanyaan seperti dari Wajib Pajak untuk melihat jawaban AOS. Memakai pengaturan yang sudah
          disimpan; tidak ada yang dikirim ke WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <Textarea
            aria-label="Pertanyaan untuk AOS"
            rows={3}
            maxLength={4000}
            placeholder="mis. Bagaimana cara aktivasi EFIN?"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!canAsk || ask.isPending || !text.trim()}>
              {ask.isPending ? <Loader2 className="animate-spin" /> : <Send />} Tanya
            </Button>
            {!canAsk && (
              <span className="text-xs text-muted-foreground">
                Hubungkan minimal satu jalur ke Claude dulu.
              </span>
            )}
          </div>
        </form>
        {ask.isPending && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> AOS sedang menyusun jawaban… Ini bisa memakan waktu
            sampai satu menit.
          </div>
        )}
        {ask.isError && <Alert variant="destructive">{errorMessage(ask.error)}</Alert>}
        {ask.data && !ask.isPending && <PlaygroundResult result={ask.data} />}
      </CardContent>
    </Card>
  );
}
