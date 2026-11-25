import { useState, type FormEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { AOS_DEFAULT_DOMAINS } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cleanDomain, isEqual } from './helpers';

/** Batas jumlah situs di skema bersama (assistantSettings.sources.domains). */
const DOMAINS_MAX = 40;

/** Daftar situs yang boleh dicari dan dibuka AOS: chip yang bisa dihapus, kolom tambah, dan tautan ke daftar bawaan. */
export function DomainEditor({
  domains,
  onChange,
}: {
  domains: string[];
  onChange: (domains: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const add = (e: FormEvent) => {
    e.preventDefault();
    // Beberapa situs boleh ditempel sekaligus, dipisah koma atau spasi.
    const pieces = text.split(/[\s,;]+/).filter(Boolean);
    if (pieces.length === 0) return;
    const next = [...domains];
    for (const piece of pieces) {
      const cleaned = cleanDomain(piece);
      if (!cleaned.ok) {
        setProblem(`"${piece}" tidak bisa dipakai. ${cleaned.message}.`);
        return;
      }
      if (!next.includes(cleaned.value)) next.push(cleaned.value);
    }
    if (next.length > DOMAINS_MAX) {
      setProblem(`Daftar situs maksimal ${DOMAINS_MAX}.`);
      return;
    }
    onChange(next);
    setText('');
    setProblem(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="aos-domain">Situs yang diizinkan</Label>
      {domains.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada situs, jadi AOS tidak akan mencari di internet.
        </p>
      ) : (
        <ul aria-label="Situs yang diizinkan" className="flex flex-wrap gap-1.5">
          {domains.map((domain) => (
            <li
              key={domain}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-secondary py-0.5 pr-1 pl-2 text-xs font-medium text-secondary-foreground"
            >
              <span className="truncate">{domain}</span>
              <button
                type="button"
                aria-label={`Hapus ${domain}`}
                onClick={() => onChange(domains.filter((d) => d !== domain))}
                className="rounded-sm p-0.5 opacity-70 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap gap-2" onSubmit={add} noValidate>
        <Input
          id="aos-domain"
          className="w-64 max-w-full"
          placeholder="mis. pajak.go.id"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={problem ? true : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setProblem(null);
          }}
        />
        <Button type="submit" variant="outline" disabled={!text.trim()}>
          <Plus /> Tambah
        </Button>
      </form>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          {domains.length} dari {DOMAINS_MAX} situs. Subsitus ikut diizinkan, mis. www.pajak.go.id untuk
          pajak.go.id.
        </span>
        {!isEqual(domains, AOS_DEFAULT_DOMAINS) && (
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-2"
            onClick={() => onChange([...AOS_DEFAULT_DOMAINS])}
          >
            Kembalikan daftar bawaan
          </button>
        )}
      </div>
    </div>
  );
}
