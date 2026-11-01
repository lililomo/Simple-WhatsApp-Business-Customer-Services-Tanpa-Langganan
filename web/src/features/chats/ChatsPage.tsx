import { MessageCircle } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';

export function ChatsPage() {
  return (
    <EmptyState icon={<MessageCircle />} title="Inbox">
      Daftar percakapan akan tampil di sini setelah nomor WhatsApp terhubung.
    </EmptyState>
  );
}
