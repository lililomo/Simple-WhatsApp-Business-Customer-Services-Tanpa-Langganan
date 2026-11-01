import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BellRing, X } from 'lucide-react';
import { toast } from 'sonner';
import { dismissPrompt, enablePush, promptDismissed, pushSupported, resumePush, usePushState } from '@/lib/push';
import { Button } from './ui/button';

/**
 * Ajakan mengaktifkan notifikasi Windows saat aplikasi dibuka (izin browser hanya boleh diminta lewat klik).
 * Juga mendaftarkan ulang langganan push setiap kali aplikasi dibuka dan menangani klik notifikasi.
 */
export function NotificationPrompt() {
  const state = usePushState();
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(promptDismissed);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void resumePush();
    if (!pushSupported()) return;
    // Klik notifikasi saat tab sudah terbuka: service worker meminta tab berpindah ke percakapan.
    const onMessage = (e: MessageEvent<{ type?: string; url?: string }>) => {
      if (e.data?.type === 'navigate' && e.data.url) navigate(e.data.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  if (state !== 'off' || hidden) return null;

  const enable = async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      if (result === 'on') toast.success('Notifikasi aktif. Pesan baru akan muncul di Windows walau tab ini ditutup.');
      else if (result === 'denied') toast.error('Izin notifikasi ditolak browser. Aktifkan lewat ikon gembok di kolom alamat.');
    } catch {
      toast.error('Gagal mengaktifkan notifikasi di browser ini.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-gold/40 bg-gold-soft px-4 py-2 text-sm">
      <BellRing className="size-4 shrink-0 text-gold-hover" />
      <span className="min-w-0 flex-1">
        Aktifkan notifikasi Windows agar pesan baru tetap terlihat walau tab WA Inbox sedang ditutup atau tertutup jendela lain.
      </span>
      <Button size="sm" onClick={enable} disabled={busy}>
        Aktifkan
      </Button>
      <button
        aria-label="Nanti saja"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => {
          dismissPrompt();
          setHidden(true);
        }}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
