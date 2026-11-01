import type { ConversationDTO, MessageDTO } from '@wa/shared';

// Kotak balas dibuat lengkap pada Prompt 7.
export function Composer(_props: { conversation: ConversationDTO; replyTo: MessageDTO | null; onClearReply: () => void }) {
  return (
    <div className="border-t bg-card px-4 py-3 text-center text-sm text-muted-foreground">
      Fitur membalas pesan sedang disiapkan.
    </div>
  );
}
