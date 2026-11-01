import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';

export function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} disalin.`);
    } catch {
      toast.error('Browser menolak akses clipboard. Salin manual.');
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} type={secret ? 'password' : 'text'} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button type="button" variant="outline" size="icon" onClick={copy} aria-label={`Salin ${label}`}>
          <Copy />
        </Button>
      </div>
    </div>
  );
}
