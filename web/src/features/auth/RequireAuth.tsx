import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import type { UserDTO } from '@wa/shared';
import { Skeleton } from '@/components/ui/misc';
import { useMe } from './hooks';

export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { data: user, isPending, isError } = useMe();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="flex h-svh items-center justify-center p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-svh items-center justify-center p-6 text-sm text-muted-foreground">
        Tidak dapat memuat sesi. Muat ulang halaman.
      </div>
    );
  }
  if (!user) {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (admin && user.role !== 'admin') return <Navigate to="/chats" replace />;
  return <>{children}</>;
}

export function isAdmin(user: UserDTO | null | undefined): boolean {
  return user?.role === 'admin';
}
