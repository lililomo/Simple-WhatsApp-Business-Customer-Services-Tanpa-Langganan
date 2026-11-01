import { Link } from 'react-router';
import { AlertTriangle, PlugZap } from 'lucide-react';
import { useMe } from '@/features/auth/hooks';
import { useConnectionStatus } from '@/features/connection/hooks';

export function ConnectionBanner() {
  const { data: me } = useMe();
  const { data } = useConnectionStatus();
  if (!data) return null;
  const isAdmin = me?.role === 'admin';

  if (!data.connected) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
        <PlugZap className="size-4 shrink-0" />
        <span>Nomor WhatsApp belum terhubung.</span>
        {isAdmin ? (
          <Link to="/settings/whatsapp" className="font-medium underline underline-offset-2">
            Atur sekarang
          </Link>
        ) : (
          <span>Hubungi admin.</span>
        )}
      </div>
    );
  }
  if (data.status === 'error') {
    return (
      <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="min-w-0 truncate">Koneksi WhatsApp bermasalah: {data.lastError ?? 'periksa pengaturan'}</span>
        {isAdmin && (
          <Link to="/settings/whatsapp" className="shrink-0 font-medium underline underline-offset-2">
            Periksa
          </Link>
        )}
      </div>
    );
  }
  return null;
}
