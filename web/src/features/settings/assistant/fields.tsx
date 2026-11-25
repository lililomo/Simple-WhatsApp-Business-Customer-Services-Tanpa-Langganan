import { useState, type ComponentProps, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

/** Satu isian berlabel dengan keterangan kecil di bawahnya. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Saklar dengan label yang bisa diklik dan keterangan opsional. */
export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** <select> bawaan browser dengan gaya yang sama dengan Input. */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  ...props
}: Omit<ComponentProps<'select'>, 'value' | 'onChange'> & {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:scheme-dark',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-popover text-popover-foreground">
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Isian angka. Selama diketik, teksnya dipegang sendiri supaya kolom boleh kosong sebentar; formulir hanya
 * menerima angka yang sah, dan kolom kembali ke nilai formulir saat ditinggalkan.
 */
export function NumberField({
  value,
  onChange,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  // Nilai formulir berubah dari luar (mis. "Batalkan"): teks yang sedang diketik tidak berlaku lagi.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (text !== null && Number(text) !== value) setText(null);
  }
  return (
    <Input
      type="number"
      inputMode="decimal"
      className={cn('w-28', className)}
      value={text ?? String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = Number(raw);
        if (raw.trim() !== '' && Number.isFinite(parsed)) onChange(parsed);
      }}
      onBlur={() => setText(null)}
      {...props}
    />
  );
}
