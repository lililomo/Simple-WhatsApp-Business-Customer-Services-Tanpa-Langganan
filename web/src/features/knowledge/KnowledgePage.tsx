import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import { BookOpen, NotebookPen, Search, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { KB_ACCEPT, KB_MAX_FILE_MB, type KbDocumentDTO } from '@wa/shared';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EditDialog, NoteDialog } from './dialogs';
import { DocumentCard, TrashRow } from './DocumentCard';
import { formatMb, KB_TYPES_LABEL } from './helpers';
import { useKnowledge } from './queries';
import { UploadList } from './UploadList';
import { useUploadQueue } from './useUploadQueue';

const chip = (active: boolean) =>
  cn(
    'max-w-full truncate rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
    active
      ? 'border-gold bg-gold text-gold-foreground'
      : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
  );

/** Berapa lama dokumen yang dituju lewat ?doc=<id> tetap disorot. */
const HIGHLIGHT_MS = 6_000;

function QuotaLine({
  count,
  trash,
  totalBytes,
  quotaBytes,
}: {
  count: number;
  trash: boolean;
  totalBytes: number;
  quotaBytes: number;
}) {
  const percent = quotaBytes > 0 ? Math.min(100, Math.round((totalBytes / quotaBytes) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap justify-between gap-x-4 text-xs text-muted-foreground">
        <span>{`${count.toLocaleString('id-ID')} dokumen${trash ? ' di tempat sampah' : ''}`}</span>
        <span>{`${formatMb(totalBytes)} MB dari ${formatMb(quotaBytes)} MB`}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Kuota Pustaka terpakai"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn('h-full rounded-full', percent >= 90 ? 'bg-destructive' : 'bg-primary')}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const docId = searchParams.get('doc');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [trash, setTrash] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState<KbDocumentDTO | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useUploadQueue();
  const list = useKnowledge({ q, tag, trash });
  const docs = list.data?.documents ?? [];
  const filtered = q !== '' || tag !== '';
  // Tag yang sedang dipilih tetap tampil walau tidak ada lagi di daftar, supaya saringannya bisa dilepas.
  const tags = [...new Set([...(list.data?.tags ?? []), ...(tag ? [tag] : [])])];

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Dibuka dari chip sumber di panel AOS: gulir ke dokumennya dan sorot sebentar. Parameternya sekali pakai,
  // jadi dibuang dari alamat supaya daftar tidak melompat lagi saat disaring atau dimuat ulang.
  const found = !!docId && docs.some((d) => d.id === docId);
  useEffect(() => {
    if (!docId || !found) return;
    setFlash(docId);
    const el = document.getElementById(`kb-doc-${docId}`);
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('doc');
        return next;
      },
      { replace: true },
    );
  }, [docId, found, setSearchParams]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [flash]);
  const missing = !!docId && !found && !!list.data && !list.isPlaceholderData && !filtered && !trash;

  const addFiles = (files: File[]) => {
    if (files.length === 0) return;
    setTrash(false);
    uploads.add(files);
  };

  // Tarik berkas dari Windows Explorer ke halaman. Penghitung menangani dragenter/leave yang muncul
  // setiap kali kursor melewati elemen anak.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles([...e.dataTransfer.files]);
    },
  };

  return (
    <>
      <div className="relative h-full" {...dropHandlers}>
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gold bg-background/85 text-center backdrop-blur-sm">
            <Upload className="size-10 text-gold-hover" />
            <div className="text-base font-semibold">Lepaskan berkas untuk mengunggah ke Pustaka</div>
            <div className="text-sm text-muted-foreground">
              {KB_TYPES_LABEL} · maks {KB_MAX_FILE_MB} MB per berkas
            </div>
            <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">
              Jangan unggah dokumen yang memuat data Wajib Pajak.
            </div>
          </div>
        )}
        <div className="scrollbar-thin h-full overflow-y-auto">
          <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:px-6 md:py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 basis-80">
                <h1 className="text-xl font-bold">Pustaka</h1>
                <p className="text-sm text-muted-foreground">
                  Berkas dan catatan di sini dibaca AOS saat menyarankan jawaban. Semua petugas boleh
                  menambah, mengubah, dan menghapusnya.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => fileInput.current?.click()}>
                  <Upload /> Unggah berkas
                </Button>
                <Button variant="outline" onClick={() => setNoteOpen(true)}>
                  <NotebookPen /> Tulis catatan
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  className="hidden"
                  aria-label="Pilih berkas untuk diunggah"
                  accept={KB_ACCEPT}
                  multiple
                  onChange={(e) => {
                    addFiles([...(e.target.files ?? [])]);
                    // Dikosongkan agar berkas yang sama bisa dipilih lagi.
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            <Alert variant="warning" className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                <strong>Jangan unggah dokumen yang memuat data Wajib Pajak.</strong> Isi Pustaka dikirim ke
                layanan AI saat AOS menyusun jawaban.
              </span>
            </Alert>

            <UploadList
              items={uploads.items}
              busy={uploads.busy}
              onRetry={uploads.retry}
              onClear={uploads.clear}
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  className="bg-card pl-9"
                  aria-label="Cari di Pustaka"
                  placeholder="Cari judul atau isi dokumen"
                  maxLength={100}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button
                variant="outline"
                aria-pressed={trash}
                className={cn(trash && 'border-gold bg-gold-soft hover:bg-gold-soft')}
                onClick={() => setTrash((v) => !v)}
              >
                <Trash2 /> Tempat sampah
              </Button>
            </div>

            {tags.length > 0 && (
              <div role="group" aria-label="Saring menurut tag" className="flex flex-wrap gap-1.5">
                <button type="button" aria-pressed={!tag} className={chip(!tag)} onClick={() => setTag('')}>
                  Semua
                </button>
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tag === t}
                    className={chip(tag === t)}
                    onClick={() => setTag(tag === t ? '' : t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}

            {list.data && (
              <QuotaLine
                count={docs.length}
                trash={trash}
                totalBytes={list.data.totalBytes}
                quotaBytes={list.data.quotaBytes}
              />
            )}

            {trash && (
              <p className="text-sm text-muted-foreground">
                Dokumen di tempat sampah tidak dipakai AOS dan dihapus permanen setelah 30 hari. Semua petugas
                boleh memulihkannya.
              </p>
            )}
            {missing && (
              <Alert variant="warning">
                Dokumen yang dituju tidak ada di daftar ini. Mungkin sudah dihapus; periksa Tempat sampah.
              </Alert>
            )}
            {list.isError && <Alert variant="destructive">{errorMessage(list.error)}</Alert>}

            {list.isPending ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : list.data && docs.length === 0 ? (
              <div className="py-8">
                {filtered ? (
                  <EmptyState icon={<Search />} title="Tidak ada yang cocok">
                    Coba kata kunci lain atau lepas saringan tag.
                  </EmptyState>
                ) : trash ? (
                  <EmptyState icon={<Trash2 />} title="Tempat sampah kosong" />
                ) : (
                  <EmptyState icon={<BookOpen />} title="Pustaka masih kosong">
                    Unggah peraturan, SOP, atau materi layanan, atau tulis catatan singkat. Bisa juga dengan
                    menarik berkas ke halaman ini. AOS akan memakainya saat menyarankan jawaban.
                  </EmptyState>
                )}
              </div>
            ) : (
              <div
                className={cn(
                  'flex flex-col gap-2 transition-opacity',
                  list.isPlaceholderData && 'opacity-60',
                )}
              >
                {docs.map((doc) =>
                  trash ? (
                    <TrashRow key={doc.id} doc={doc} highlighted={doc.id === flash} />
                  ) : (
                    <DocumentCard
                      key={doc.id}
                      doc={doc}
                      highlighted={doc.id === flash}
                      onEdit={() => setEditing(doc)}
                    />
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Dialog sengaja di luar area tarik-lepas: berkas yang dijatuhkan ke dialog tidak ikut terunggah. */}
      {noteOpen && <NoteDialog onClose={() => setNoteOpen(false)} />}
      {editing && <EditDialog doc={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
