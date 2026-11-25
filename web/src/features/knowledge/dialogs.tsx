import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { kbNoteBody, kbUpdateBody, type KbDocumentDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Switch } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { useCreateNote, useUpdateDocument, type KbUpdateBody } from './queries';
import { TagInput, useTagField } from './TagInput';

/** Pesan Indonesia untuk isian yang ditolak skema bersama (pesan bawaan zod berbahasa Inggris). */
const FIELD_MESSAGE: Record<string, string> = {
  title: 'Judul wajib diisi, maksimal 190 huruf.',
  text: 'Isi catatan wajib diisi.',
  description: 'Keterangan maksimal 500 huruf.',
  tags: 'Periksa lagi tag: maksimal 10 tag, masing-masing 40 huruf.',
  validUntil: 'Tanggal kedaluwarsa tidak valid.',
};

const issueMessage = (issues: readonly { path: PropertyKey[] }[]) =>
  FIELD_MESSAGE[String(issues[0]?.path[0])] ?? 'Periksa lagi isian Anda.';

export function NoteDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const tagField = useTagField();
  const [problem, setProblem] = useState<string | null>(null);
  const save = useCreateNote();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = kbNoteBody.safeParse({ title, text, tags: tagField.commit() });
    if (!parsed.success) {
      setProblem(issueMessage(parsed.error.issues));
      return;
    }
    setProblem(null);
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast.success('Catatan disimpan. AOS memakainya setelah selesai diproses.');
        onClose();
      },
    });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Tulis catatan</DialogTitle>
          <DialogDescription>
            Untuk pengetahuan singkat yang tidak ada berkasnya, mis. alur layanan atau jawaban baku. Jangan
            menulis data Wajib Pajak.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {problem && <Alert variant="destructive">{problem}</Alert>}
          {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-note-title">Judul</Label>
            <Input
              id="kb-note-title"
              autoFocus
              maxLength={190}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="mis. Syarat aktivasi EFIN"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-note-text">Isi catatan</Label>
            <Textarea
              id="kb-note-text"
              rows={9}
              maxLength={100_000}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-note-tags">Tag (opsional)</Label>
            <TagInput id="kb-note-tags" field={tagField} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Menyimpan…' : 'Simpan catatan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

export function EditDialog({ doc, onClose }: { doc: KbDocumentDTO; onClose: () => void }) {
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description ?? '');
  const tagField = useTagField(doc.tags);
  const [isActive, setIsActive] = useState(doc.isActive);
  const [isOfficial, setIsOfficial] = useState(doc.isOfficial);
  const [validUntil, setValidUntil] = useState(doc.validUntil ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useUpdateDocument();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = kbUpdateBody.safeParse({
      title,
      description: description.trim() || null,
      tags: tagField.commit(),
      isActive,
      isOfficial,
      validUntil: validUntil || null,
    });
    if (!parsed.success) {
      setProblem(issueMessage(parsed.error.issues));
      return;
    }
    setProblem(null);
    // Hanya isian yang berubah yang dikirim, supaya perubahan petugas lain pada isian lain tidak tertimpa.
    const next = parsed.data;
    const body: KbUpdateBody = {};
    if (next.title !== doc.title) body.title = next.title;
    if (next.description !== doc.description) body.description = next.description;
    if (JSON.stringify(next.tags) !== JSON.stringify(doc.tags)) body.tags = next.tags;
    if (next.isActive !== doc.isActive) body.isActive = next.isActive;
    if (next.isOfficial !== doc.isOfficial) body.isOfficial = next.isOfficial;
    if (next.validUntil !== doc.validUntil) body.validUntil = next.validUntil;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    save.mutate(
      { id: doc.id, body },
      {
        onSuccess: () => {
          toast.success('Dokumen diperbarui.');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ubah dokumen</DialogTitle>
          <DialogDescription>Perubahan berlaku untuk semua petugas.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {problem && <Alert variant="destructive">{problem}</Alert>}
          {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-edit-title">Judul</Label>
            <Input
              id="kb-edit-title"
              maxLength={190}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-edit-description">Keterangan (opsional)</Label>
            <Textarea
              id="kb-edit-description"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="mis. berlaku untuk SPT Tahunan 2026"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-edit-tags">Tag</Label>
            <TagInput id="kb-edit-tags" field={tagField} />
          </div>
          <SwitchRow
            checked={isActive}
            onChange={setIsActive}
            label="Dipakai AOS"
            hint="Matikan bila dokumen ini belum boleh dipakai, tanpa perlu menghapusnya."
          />
          <SwitchRow
            checked={isOfficial}
            onChange={setIsOfficial}
            label="Sumber resmi"
            hint="Diutamakan AOS dibanding dokumen lain, mis. peraturan atau edaran resmi."
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="kb-edit-valid">Kedaluwarsa (opsional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="kb-edit-valid"
                type="date"
                className="w-44 dark:scheme-dark"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
              {validUntil && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setValidUntil('')}>
                  Hapus tanggal
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Setelah tanggal ini lewat, dokumen tidak dipakai AOS. Kosongkan bila berlaku seterusnya.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
