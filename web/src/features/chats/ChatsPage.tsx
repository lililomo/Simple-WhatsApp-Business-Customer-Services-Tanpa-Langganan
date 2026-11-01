import { useParams } from 'react-router';
import { MessageCircle } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { ChatPane } from './ChatPane';
import { ConversationList } from './ConversationList';

export function ChatsPage() {
  const { conversationId } = useParams();
  return (
    <div className="flex h-full">
      {/* Di layar sempit hanya satu panel yang tampil. */}
      <div className={cn('h-full w-full border-r md:w-80 lg:w-96', conversationId ? 'hidden md:block' : 'block')}>
        <ConversationList />
      </div>
      <div className={cn('h-full min-w-0 flex-1', conversationId ? 'flex' : 'hidden md:flex')}>
        {conversationId ? (
          <ChatPane conversationId={conversationId} />
        ) : (
          <div className="flex-1 bg-chat-bg">
            <EmptyState icon={<MessageCircle />} title="WA Inbox">
              Pilih percakapan di sebelah kiri untuk membaca dan membalas pesan.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
