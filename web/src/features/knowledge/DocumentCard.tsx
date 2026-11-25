import {
  ArchiveRestore,
  BadgeCheck,
  ExternalLink,
  FileImage,
  FileText,
  Loader2,
  MoreVertical,
  NotebookPen,
  Pencil,
  RotateCw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { KbDocumentDTO } from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatBytes, formatDay, isExpired } from './helpers';
import { useDeleteDocument, useReprocessDocument, useRestoreDocument } from './queries';

function KindIcon({ doc }: { doc: KbDocumentDTO }) {
  const Icon = doc.kind === 'note' ? NotebookPen : doc.mimeType?.startsWith('image/') ? FileImage : FileText;
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"
      title={doc.kind === 'note' ? 'Catatan' : 'Berkas'}
    >
      <Icon className="size-4.5" aria-label={doc.kind === 'note' ? 'Catatan' : 'Berkas'} />
    </div>
  );
}

function StatusBadge({ status }: { status: KbDocumentDTO['status'] }) {
  if (status === 'processing') {
    return (
      <Badge variant="warning">
        <Loader2 className="animate-spin" /> Diproses
      </Badge>
    );
  }
  return status === 'ready' ? (
    <Badge variant="success">Siap</Badge>
  ) : (
    <Badge variant="destructive">Gagal</Badge>
  );
}

/** Satu dokumen Pustaka. `highlighted` dipakai saat halaman dibuka dari chip sumber di panel AOS (?doc=<id>). */
export function DocumentCard({
  doc,
  highlighted,
  onEdit,
}: {
  doc: KbDocumentDTO;
  highlighted: boolean;
  onEdit: () => void;
}) {
  const remove = useDeleteDocument();
  const reprocess = useReprocessDocument();
  const expired = isExpired(doc.validUntil);
  const meta = [
    doc.uploadedBy?.name,
    formatDateTime(doc.createdAt),
    doc.fileSize !== null ? formatBytes(doc.fileSize) : null,
    doc.pageCount ? `${doc.pageCount.toLocaleString('id-ID')} hlm` : null,
  ].filter(Boolean);

  return (
    <article
      id={`kb-doc-${doc.id}`}
      aria-label={doc.title}
      className={cn(
        'flex scroll-mt-4 items-start gap-3 rounded-lg border bg-card p-3 transition-shadow',
        highlighted && 'border-gold ring-2 ring-gold',
      )}
    >
      {/* Dokumen yang tidak dipakai AOS tampil redup; menunya tetap jelas supaya mudah diaktifkan lagi. */}
      <div className={cn('flex min-w-0 flex-1 items-start gap-3', !doc.isActive && 'opacity-60')}>
        <KindIcon doc={doc} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 font-medium break-words">{doc.title}</h2>
            <StatusBadge status={doc.status} />
            {doc.isOfficial && (
              <Badge variant="outline" className="border-gold/60 bg-gold-soft">
                <BadgeCheck /> Sumber resmi
              </Badge>
            )}
            {!doc.isActive && <Badge variant="secondary">Tidak dipakai AOS</Badge>}
          </div>
          {doc.description && <p className="text-sm break-words">{doc.description}</p>}
          {doc.summary && (
            <p className="line-clamp-2 text-sm break-words text-muted-foreground">{doc.summary}</p>
          )}
          {doc.status === 'failed' && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 break-words text-destructive">
                {doc.error ?? 'Berkas tidak bisa dibaca.'}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={reprocess.isPending}
                onClick={() => reprocess.mutate(doc.id, { onError: (err) => toast.error(errorMessage(err)) })}
              >
                <RotateCw className={cn(reprocess.isPending && 'animate-spin')} /> Proses ulang
              </Button>
            </div>
          )}
          {doc.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {doc.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="max-w-full font-normal">
                  <span className="truncate">{tag}</span>
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
            <span>{meta.join(' · ')}</span>
            {doc.validUntil && (
              <span
                className={cn(expired && 'font-semibold text-destructive')}
                title={
                  expired ? 'Sudah lewat, tidak dipakai AOS lagi' : 'Setelah tanggal ini tidak dipakai AOS'
                }
              >
                Kedaluwarsa {formatDay(doc.validUntil)}
              </span>
            )}
          </div>
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Menu ${doc.title}`}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {doc.fileUrl && (
            <DropdownMenuItem asChild>
              <a href={doc.fileUrl} target="_blank" rel="noreferrer">
                <ExternalLink /> Buka berkas
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> Ubah
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={remove.isPending}
            onSelect={() => {
              if (
                !confirm(
                  `Hapus "${doc.title}"?\n\nDokumen dipindahkan ke tempat sampah dan bisa dipulihkan selama 30 hari. AOS tidak memakainya lagi.`,
                )
              )
                return;
              remove.mutate(doc.id, {
                onSuccess: () => toast.success('Dipindahkan ke tempat sampah.'),
                onError: (err) => toast.error(errorMessage(err)),
              });
            }}
          >
            <Trash2 /> Hapus
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}

/** Baris di tempat sampah: siapa dan kapan menghapus, plus tombol pulihkan. */
export function TrashRow({ doc, highlighted }: { doc: KbDocumentDTO; highlighted: boolean }) {
  const restore = useRestoreDocument();
  return (
    <article
      id={`kb-doc-${doc.id}`}
      aria-label={doc.title}
      className={cn(
        'flex scroll-mt-4 items-center gap-3 rounded-lg border bg-card p-3 transition-shadow',
        highlighted && 'border-gold ring-2 ring-gold',
      )}
    >
      <KindIcon doc={doc} />
      <div className="min-w-0 flex-1">
        <h2 className="font-medium break-words">{doc.title}</h2>
        <p className="text-xs text-muted-foreground">
          Dihapus{doc.deletedBy ? ` oleh ${doc.deletedBy.name}` : ''}
          {doc.deletedAt ? ` · ${formatDateTime(doc.deletedAt)}` : ''}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={restore.isPending}
        onClick={() =>
          restore.mutate(doc.id, {
            onSuccess: () => toast.success('Dokumen dipulihkan.'),
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      >
        <ArchiveRestore /> Pulihkan
      </Button>
    </article>
  );
}
