import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Popover } from 'radix-ui';
import { toast } from 'sonner';
import { formatWaId, type AosAskBody, type AosMessageDTO, type AosThreadDTO, type ConversationDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ComposerHandle } from '@/features/chats/Composer';
import { errorMessage } from '@/lib/api';
import { setPrefs } from '@/lib/theme';
import { AosLogo, HelpIcon, MinimizeIcon, NewTopicIcon, ResizeIcon, SendIcon } from './AosLogo';
import { AosBubble, AosThread, type AosActions } from './AosMessages';
import { useAosAsk, useAosMessageAction, useAosReset, type AosSaveTarget } from './queries';

/** Di layar sempit panel tampil sebagai lembar selayar penuh (media query yang sama dengan .aos-panel di index.css). */
export const isAosSheet = () => window.matchMedia?.('(width < 48rem)').matches === true;

const ASK_MAX = 4000;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Disalin ke clipboard.');
  } catch {
    toast.error('Browser menolak akses clipboard. Salin manual.');
  }
}

/** Linimasa tetap di ujung bawah selama petugas tidak menggulir ke atas, juga saat teks jawaban mengalir. */
function useStickToBottom() {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Tinggi isi yang terakhir kita tangani. Event scroll datang belakangan (frame berikutnya); bila saat itu isi
  // sudah bertambah, jarak ke bawah harus diukur terhadap tinggi lama, bukan tinggi baru, supaya gulir yang kita
  // lakukan sendiri tidak terbaca sebagai "petugas menggulir ke atas".
  const seenHeight = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !content.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
      seenHeight.current = el.scrollHeight;
    });
    observer.observe(content.current);
    return () => observer.disconnect();
  }, []);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const height = Math.min(seenHeight.current || el.scrollHeight, el.scrollHeight);
    stick.current = height - el.scrollTop - el.clientHeight < 48;
  };
  const toBottom = () => {
    stick.current = true;
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    seenHeight.current = el.scrollHeight;
  };
  return { scroller, content, onScroll, toBottom };
}

function HelpButton() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="aos-ib" aria-label="Bantuan" title="Bantuan">
          <HelpIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-50 w-[min(19rem,calc(100vw-2rem))] rounded-xl border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
        >
          <p className="font-semibold">Tentang AOS</p>
          <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
            <li>AOS hanya menyarankan. Anda yang memeriksa, menyunting, lalu mengirim balasannya.</li>
            <li>NIK/NPWP, nomor telepon, dan email WP disamarkan sebelum dikirim ke AI.</li>
            <li>Cek sumber dan tingkat keyakinan sebelum memakai draf.</li>
            <li>Sesi ini dipakai bersama semua petugas untuk nomor ini. Topik baru memulai konteks dari awal.</li>
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function AskBox({
  busy,
  autoFocus,
  onAsk,
}: {
  busy: boolean;
  autoFocus: boolean;
  onAsk: (body: AosAskBody, onSent?: () => void) => void;
}) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  // Tinggi kotak mengikuti isinya, juga saat dikosongkan setelah pertanyaan terkirim.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    // Dikosongkan setelah server menerima; bila gagal, pertanyaannya masih ada untuk dicoba lagi.
    onAsk({ text: trimmed }, () => setText(''));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="aos-ask">
      <div className="aos-quick">
        <button type="button" disabled={busy} onClick={() => onAsk({ action: 'summarize' })}>
          Ringkas chat ini
        </button>
        <button type="button" disabled={busy} onClick={() => onAsk({ action: 'explain' })}>
          Jelaskan maksud pesan
        </button>
      </div>
      <div className="aos-input">
        <textarea
          ref={box}
          rows={1}
          maxLength={ASK_MAX}
          value={text}
          readOnly={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tanya AOS…"
          aria-label="Pertanyaan untuk AOS"
        />
        <button type="button" className="aos-send" aria-label="Kirim pertanyaan ke AOS" disabled={busy || !text.trim()} onClick={send}>
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

function SaveDialog({
  target,
  pending,
  onCancel,
  onSave,
}: {
  target: AosSaveTarget;
  pending: boolean;
  onCancel: () => void;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  const library = target === 'library';
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) onSave(title.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>{library ? 'Simpan ke Pustaka' : 'Simpan sebagai balasan cepat'}</DialogTitle>
            <DialogDescription>
              {library
                ? 'Draf ini disimpan sebagai catatan di Pustaka, untuk semua petugas.'
                : 'Draf ini masuk ke daftar balasan cepat semua petugas.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="aos-save-title">Judul</Label>
            <Input id="aos-save-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required autoFocus />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Batal
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              {pending ? 'Menyimpan…' : 'Simpan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Panel AOS: kepala pil dengan empat tombol, chip sesi, linimasa, dan kotak tanya. AOS hanya menyarankan;
 * "Pakai" memasukkan draf ke kotak balas WhatsApp lewat `composerRef`, dan petugas sendiri yang mengirim.
 */
export function AosPanel({
  conversation,
  thread,
  wide,
  focusInput,
  composerRef,
  onClose,
}: {
  conversation: ConversationDTO;
  thread: UseQueryResult<AosThreadDTO>;
  wide: boolean;
  /** Panel dibuka petugas sendiri (bukan terbuka otomatis), jadi kursor boleh pindah ke kotak tanya. */
  focusInput: boolean;
  composerRef: RefObject<ComposerHandle | null>;
  onClose: () => void;
}) {
  const ask = useAosAsk(conversation.id);
  const reset = useAosReset(conversation.id);
  const act = useAosMessageAction();
  const { scroller, content, onScroll, toBottom } = useStickToBottom();
  const [pendingUse, setPendingUse] = useState<{ message: AosMessageDTO; draft: string } | null>(null);
  const [saving, setSaving] = useState<{ message: AosMessageDTO; target: AosSaveTarget } | null>(null);
  // Setelah "Ganti"/"Tambahkan", fokus harus tinggal di kotak balas, bukan kembali ke tombol "Pakai".
  const keepComposerFocus = useRef(false);

  const number = formatWaId(conversation.contact.waId);
  const name = conversation.contact.name;

  const sendAsk = (body: AosAskBody, onSent?: () => void) => {
    if (ask.send(body, onSent)) toBottom();
  };

  const applyDraft = (message: AosMessageDTO, draft: string, mode: 'replace' | 'append') => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.insertText(draft, mode);
    act.mutate({ id: message.id, action: 'used' });
    // Lembar selayar penuh menutupi kotak balas; ditutup agar petugas langsung melihat drafnya.
    if (isAosSheet()) onClose();
  };

  const actions: AosActions = {
    busy: ask.busy,
    ask: (body) => sendAsk(body),
    cancel: (message) => act.mutate({ id: message.id, action: 'cancel' }),
    dismiss: (message) => act.mutate({ id: message.id, action: 'dismiss' }),
    feedback: (message, value) => act.mutate({ id: message.id, action: 'feedback', body: { value } }),
    use: (message, draft) => {
      if (composerRef.current?.hasText()) setPendingUse({ message, draft });
      else applyDraft(message, draft, 'replace');
    },
    copy: (text) => void copyText(text),
    save: (message, target) => setSaving({ message, target }),
  };

  const newTopic = () => {
    if (!confirm('Mulai topik baru? Percakapan dengan AOS sebelum ini tidak lagi dipakai sebagai konteks.')) return;
    toBottom();
    reset.mutate();
  };

  const confirmUse = (mode: 'replace' | 'append') => {
    if (!pendingUse) return;
    keepComposerFocus.current = true;
    applyDraft(pendingUse.message, pendingUse.draft, mode);
    setPendingUse(null);
  };

  return (
    <aside className="aos-panel" data-wide={wide} aria-label="Asisten OSing">
      <div className="aos-head">
        <AosLogo className="aos-head-logo" />
        <h2 className="aos-title">Asisten OSing</h2>
        <HelpButton />
        <button type="button" className="aos-ib" aria-label="Kecilkan" title="Kecilkan" onClick={onClose}>
          <MinimizeIcon />
        </button>
        <button
          type="button"
          className="aos-ib aos-resize"
          aria-label={wide ? 'Sempitkan' : 'Lebarkan'}
          title={wide ? 'Sempitkan' : 'Lebarkan'}
          onClick={() => setPrefs({ aosWide: !wide })}
        >
          <ResizeIcon />
        </button>
        <button
          type="button"
          className="aos-ib"
          aria-label="Topik baru"
          title="Topik baru (akhiri konteks lama)"
          disabled={reset.isPending}
          onClick={newTopic}
        >
          <NewTopicIcon />
        </button>
      </div>
      <p className="aos-chip">
        Sesi untuk {number}
        {name && name !== number ? ` · ${name}` : ''}
      </p>

      <div className="aos-thread" ref={scroller} onScroll={onScroll}>
        <div ref={content}>
          {thread.data ? (
            <AosThread thread={thread.data} actions={actions} />
          ) : thread.isError ? (
            <AosBubble tone="error">
              <p>Sesi AOS gagal dimuat. {errorMessage(thread.error)}</p>
              <button type="button" className="aos-link" onClick={() => void thread.refetch()}>
                Coba lagi
              </button>
            </AosBubble>
          ) : (
            <div className="aos-steps" role="status">
              <span className="aos-dot" />
              <span className="aos-steps-text">Memuat sesi…</span>
            </div>
          )}
        </div>
      </div>

      <AskBox busy={ask.busy} autoFocus={focusInput} onAsk={sendAsk} />

      <Dialog open={!!pendingUse} onOpenChange={(open) => !open && setPendingUse(null)}>
        <DialogContent
          className="sm:max-w-md"
          onCloseAutoFocus={(e) => {
            if (keepComposerFocus.current) e.preventDefault();
            keepComposerFocus.current = false;
          }}
        >
          <DialogHeader>
            <DialogTitle>Kotak balas sudah berisi teks</DialogTitle>
            <DialogDescription>Ganti teks itu dengan draf AOS, atau tambahkan draf di bawahnya?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingUse(null)}>
              Batal
            </Button>
            <Button variant="outline" onClick={() => confirmUse('append')}>
              Tambahkan
            </Button>
            <Button onClick={() => confirmUse('replace')}>Ganti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {saving && (
        <SaveDialog
          target={saving.target}
          pending={act.isPending && act.variables?.action === 'save'}
          onCancel={() => setSaving(null)}
          onSave={(title) =>
            act.mutate(
              { id: saving.message.id, action: 'save', body: { target: saving.target, title } },
              {
                onSuccess: () => {
                  toast.success(saving.target === 'library' ? 'Disimpan ke Pustaka.' : 'Disimpan sebagai balasan cepat.');
                  setSaving(null);
                },
              },
            )
          }
        />
      )}
    </aside>
  );
}
