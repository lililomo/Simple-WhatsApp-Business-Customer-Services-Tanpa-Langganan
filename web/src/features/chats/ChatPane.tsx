import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Info } from 'lucide-react';
import { formatWaId, type MessageDTO } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { Avatar, WindowBadge } from './bits';
import { ContactPanel } from './ContactPanel';
import { MessageTimeline } from './MessageTimeline';
import { useConversation, useMarkRead } from './queries';
import { Composer } from './Composer';

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
      <div className="flex min-w-0 flex-1 flex-col bg-chat-bg">
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
        <Composer conversation={conv} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      </div>
      {showInfo && (
        <div className="fixed inset-0 z-40 md:static md:z-auto">
          <ContactPanel conversation={conv} onClose={() => setShowInfo(false)} />
        </div>
      )}
    </div>
  );
}
