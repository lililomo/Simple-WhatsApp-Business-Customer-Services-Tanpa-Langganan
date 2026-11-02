import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MailCheck, MailOpen, Settings2, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { labelTextColor, type ConversationDTO, type LabelDTO } from '@wa/shared';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { useLabels } from '@/features/library/queries';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMarkRead, useMarkUnread, useToggleLabel } from './queries';

export function LabelChip({
  label,
  className,
  children,
}: {
  label: Pick<LabelDTO, 'name' | 'color'>;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-32 shrink-0 items-center gap-1 rounded-full px-2 py-px text-[11px] leading-4 font-semibold',
        className,
      )}
      style={{ backgroundColor: label.color, color: labelTextColor(label.color) }}
      title={label.name}
    >
      <span className="truncate">{label.name}</span>
      {children}
    </span>
  );
}

/** Label kontak, maksimal `max` ditampilkan; sisanya diringkas "+N". */
export function LabelChips({
  labels,
  max = 2,
  className,
}: {
  labels: LabelDTO[];
  max?: number;
  className?: string;
}) {
  if (labels.length === 0) return null;
  const hidden = labels.slice(max);
  return (
    <span className={cn('flex min-w-0 items-center justify-end gap-1', className)}>
      {labels.slice(0, max).map((l) => (
        <LabelChip key={l.id} label={l} />
      ))}
      {hidden.length > 0 && (
        <span
          className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[11px] leading-4 font-semibold text-muted-foreground"
          title={hidden.map((l) => l.name).join(', ')}
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
}

export function LabelDot({ color }: { color: string }) {
  return (
    <span className="size-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />
  );
}

/** Hook pasang/lepas label dengan pesan galat yang ramah. */
export function useLabelToggle(conversationId: string) {
  const toggle = useToggleLabel();
  return (label: LabelDTO, on: boolean) =>
    toggle.mutate(
      { conversationId, labelId: label.id, on },
      { onError: (err) => toast.error(errorMessage(err)) },
    );
}

/** Isi menu percakapan (daftar chat & kepala chat): label dan tandai dibaca/belum dibaca. */
export function ConversationMenuContent({
  conv,
  align = 'end',
}: {
  conv: ConversationDTO;
  align?: 'start' | 'end';
}) {
  const labels = useLabels();
  const toggleLabel = useLabelToggle(conv.id);
  const markUnread = useMarkUnread();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const { conversationId: openId } = useParams();
  const attached = new Set(conv.labels.map((l) => l.id));

  const unread = () => {
    // Percakapan yang sedang terbuka langsung ditandai dibaca lagi, jadi tutup dulu (seperti WhatsApp Web).
    if (openId === conv.id) navigate('/chats');
    markUnread.mutate(conv.id, { onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <DropdownMenuContent align={align} className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Tag /> Label
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
          {labels.data?.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">Belum ada label.</div>
          )}
          {labels.data?.map((l) => (
            <DropdownMenuCheckboxItem
              key={l.id}
              checked={attached.has(l.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => toggleLabel(l, on)}
            >
              <LabelDot color={l.color} />
              <span className="truncate">{l.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/settings/labels">
              <Settings2 /> Kelola label
            </Link>
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {conv.unreadCount > 0 ? (
        <DropdownMenuItem
          onSelect={() => markRead.mutate(conv.id, { onError: (err) => toast.error(errorMessage(err)) })}
        >
          <MailCheck /> Tandai sudah dibaca
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={unread}>
          <MailOpen /> Tandai belum dibaca
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  );
}
