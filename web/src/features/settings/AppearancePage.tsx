import { useState, type ReactNode } from 'react';
import { Bell, BellOff, Monitor, Moon, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { disablePush, enablePush, sendTestPush, usePushState } from '@/lib/push';
import { FONT_SCALES, LIST_WIDTH, setPrefs, usePrefs, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Terang', icon: Sun },
  { value: 'dark', label: 'Gelap', icon: Moon },
  { value: 'system', label: 'Ikuti Windows', icon: Monitor },
];

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent',
        active && 'border-gold bg-gold-soft font-semibold text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function NotificationCard() {
  const state = usePushState();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifikasi Windows</CardTitle>
        <CardDescription>
          Pesan baru muncul sebagai notifikasi Windows, juga saat tab WA Inbox ditutup, selama browser masih berjalan dan Anda belum
          keluar (logout) dari browser ini. Saat Anda sedang membuka percakapan yang sama, notifikasi tidak ditampilkan.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state === 'unsupported' && <Alert variant="warning">Browser ini tidak mendukung notifikasi push. Pakai Chrome atau Edge terbaru.</Alert>}
        {state === 'denied' && (
          <Alert variant="warning">
            Izin notifikasi untuk situs ini diblokir browser. Klik ikon gembok di kolom alamat → Notifikasi → Izinkan, lalu muat ulang halaman.
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {state === 'on' ? (
            <>
              <span className="mr-2 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <Bell className="size-4" /> Aktif di browser ini
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => run(async () => toast.success((await sendTestPush()).sent > 0 ? 'Notifikasi uji dikirim.' : 'Belum ada browser yang terdaftar.'))}
              >
                Kirim notifikasi uji
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(disablePush)}>
                <BellOff /> Matikan
              </Button>
            </>
          ) : (
            state === 'off' && (
              <Button size="sm" disabled={busy} onClick={() => run(enablePush)}>
                <Bell /> Aktifkan notifikasi
              </Button>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function AppearancePage() {
  const prefs = usePrefs();
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Tampilan & notifikasi</h2>
        <p className="text-sm text-muted-foreground">Pengaturan di halaman ini tersimpan di browser ini saja, jadi setiap petugas bisa berbeda.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tema</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <Choice key={value} active={prefs.theme === value} onClick={() => setPrefs({ theme: value })}>
              <Icon className="size-4" /> {label}
            </Choice>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ukuran teks</CardTitle>
          <CardDescription>Mengubah ukuran seluruh tampilan, termasuk isi chat.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {FONT_SCALES.map((f) => (
            <Choice key={f.value} active={prefs.fontScale === f.value} onClick={() => setPrefs({ fontScale: f.value })}>
              <span style={{ fontSize: `${f.value / 100}em` }}>Aa</span> {f.label}
            </Choice>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lebar daftar chat</CardTitle>
          <CardDescription>
            Geser garis pembatas antara daftar chat dan isi chat untuk mengubah lebarnya. Klik ganda garis itu untuk kembali ke lebar awal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-sm">
          <span>Sekarang {prefs.listWidth} px</span>
          <Button variant="outline" size="sm" disabled={prefs.listWidth === LIST_WIDTH.default} onClick={() => setPrefs({ listWidth: LIST_WIDTH.default })}>
            Kembalikan ke awal
          </Button>
        </CardContent>
      </Card>

      <NotificationCard />
    </div>
  );
}
