import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Info, Upload } from 'lucide-react';
import { MAX_ATTACHMENTS } from '@/features/composer/AttachmentDialog';
import { formatWaId, type MessageDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { Avatar, WindowBadge } from './bits';
import { ContactPanel } from './ContactPanel';
import { MessageTimeline } from './MessageTimeline';
import { useConversation, useMarkRead } from './queries';
import { Composer, type ComposerHandle } from './Composer';

export function ChatPane({ conversationId }: { conversationId: string }) {
  const { data: conv, isPending, isError, error } = useConversation(conversationId);
  const markRead = useMarkRead();
  const [showInfo, setShowInfo] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageDTO | null>(null);
  const unread = conv?.unreadCount ?? 0;

  // Tandai dibaca saat percakapan dibuka dan setiap ada pesan baru selagi tab terlihat.
  const { mutate } = markRead;
  useEffect(() => {
    if (unread === 0) return;
    const run = () => !document.hidden && mutate(conversationId);
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [unread, conversationId, mutate]);

  useEffect(() => setReplyTo(null), [conversationId]);

  // Tarik file dari Windows Explorer ke area chat untuk melampirkan. Penghitung menangani dragenter/leave
  // yang juga dipicu oleh elemen anak.
  const composerRef = useRef<ComposerHandle>(null);
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
      composerRef.current?.addFiles([...e.dataTransfer.files]);
    },
  };

  if (isPending) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-10 w-64" />
      </div>
    );
  }
  if (isError || !conv) return <Alert variant="destructive" className="m-4 w-auto">{errorMessage(error)}</Alert>;

  return (
    <div className="flex h-full min-w-0 flex-1">
      <div className="chat-surface relative flex min-w-0 flex-1 flex-col" {...dropHandlers}>
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gold bg-background/85 text-center backdrop-blur-sm">
            <Upload className="size-10 text-gold-hover" />
            <div className="text-base font-semibold">Lepaskan file di sini</div>
            <div className="text-sm text-muted-foreground">Foto, video, dokumen, atau audio · maks {MAX_ATTACHMENTS} file</div>
          </div>
        )}
        <header className="flex items-center gap-3 border-b bg-card px-3 py-2">
          <Button asChild variant="ghost" size="icon-sm" className="md:hidden">
            <Link to="/chats" aria-label="Kembali ke daftar chat">
              <ArrowLeft />
            </Link>
          </Button>
          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setShowInfo((v) => !v)}>
            <Avatar name={conv.contact.name} seed={conv.contact.waId} className="size-9" />
            <div className="min-w-0">
              <div className="truncate font-semibold">{conv.contact.name}</div>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{formatWaId(conv.contact.waId)}</span>
                <WindowBadge cswExpiresAt={conv.cswExpiresAt} compact />
              </div>
            </div>
          </button>
          <Button variant="ghost" size="icon-sm" onClick={() => setShowInfo((v) => !v)} aria-label="Info kontak">
            <Info />
          </Button>
        </header>
        <MessageTimeline key={conversationId} conversationId={conversationId} onReply={setReplyTo} />
        <Composer ref={composerRef} conversation={conv} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      </div>
      {showInfo && (
        <div className="fixed inset-0 z-40 md:static md:z-auto">
          <ContactPanel conversation={conv} onClose={() => setShowInfo(false)} />
        </div>
      )}
    </div>
  );
}
