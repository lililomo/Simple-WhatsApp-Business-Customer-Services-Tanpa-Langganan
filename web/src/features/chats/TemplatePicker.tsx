import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Pemilih template dibuat lengkap pada Prompt 8.
export function TemplatePicker({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kirim template</DialogTitle>
          <DialogDescription>Daftar template akan tersedia setelah sinkronisasi template.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
