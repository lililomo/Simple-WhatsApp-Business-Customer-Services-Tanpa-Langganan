import type { ReactNode } from 'react';

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon && (
        <div className="mb-1 flex size-16 items-center justify-center rounded-2xl bg-gold-soft text-gold-hover ring-1 ring-gold/30 [&_svg]:size-8">{icon}</div>
      )}
      <h2 className="text-lg font-bold">{title}</h2>
      {children && <div className="max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
