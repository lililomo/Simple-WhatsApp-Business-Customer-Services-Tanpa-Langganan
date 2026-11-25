import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { aosLoginCodeBody } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { ApiError, errorMessage } from '@/lib/api';
import { formatTime } from '@/lib/format';
import { cancelSubscriptionLogin, useFinishSubscriptionLogin, useStartSubscriptionLogin } from './queries';

const step = 'flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground';

/**
 * Menghubungkan langganan Claude tanpa terminal: buat tautan, masuk ke Claude di tab baru, tempel kode yang
 * ditampilkan Claude. Server yang menukar kode itu menjadi token dan menyimpannya; token tidak pernah sampai ke
 * browser ini.
 */
export function SubscriptionLogin({ onDone, onManual }: { onDone: () => void; onManual: () => void }) {
  const start = useStartSubscriptionLogin();
  const finish = useFinishSubscriptionLogin();
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const link = start.data;
  // Ada sesi login yang masih terbuka di server; dihentikan bila dialog ditutup sebelum selesai.
  const active = useRef(false);
  useEffect(
    () => () => {
      if (active.current) cancelSubscriptionLogin();
    },
    [],
  );

  const begin = () => {
    setProblem(null);
    setCode('');
    finish.reset();
    start.mutate(undefined, {
      onSuccess: () => {
        active.current = true;
      },
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = aosLoginCodeBody.safeParse({ code });
    if (!parsed.success) {
      setProblem('Kode belum lengkap. Salin seluruh kode dari halaman Claude.');
      return;
    }
    setProblem(null);
    finish.mutate(parsed.data.code, {
      onSuccess: () => {
        active.current = false;
        toast.success('Langganan Claude terhubung. Tekan "Uji koneksi" untuk memastikan.');
        onDone();
      },
      onError: (err) => {
        // Kode yang ditolak Claude atau sesi yang berakhir menghabiskan tautannya: kembali ke langkah awal.
        // Kode yang ditolak aplikasi sendiri (salah bentuk) atau yang masih diproses tidak menghabiskan sesi.
        const sessionKept = err instanceof ApiError && (err.code === 'aos_login_busy' || (err.code === 'aos_login_code' && /tidak dikenali/.test(err.message)));
        if (err instanceof ApiError && !sessionKept) {
          active.current = false;
          setProblem(err.message);
          start.reset();
          setCode('');
        }
      },
    });
  };

  if (!link) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Masuk dengan akun Claude berlangganan lewat halaman login Claude. Tidak perlu terminal: buat tautannya,
          masuk, lalu tempel kode yang ditampilkan Claude.
        </p>
        {problem && <Alert variant="destructive">{problem}</Alert>}
        {start.isError && <Alert variant="destructive">{errorMessage(start.error)}</Alert>}
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={onManual}>
            Sudah punya token? Tempel token
          </Button>
          <Button type="button" onClick={begin} disabled={start.isPending} autoFocus>
            {start.isPending && <Loader2 className="animate-spin" />}
            {start.isPending ? 'Menyiapkan tautan…' : 'Buat tautan login'}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <ol className="flex flex-col gap-3 text-sm">
        <li className="flex items-start gap-3">
          <span className={step}>1</span>
          <div className="flex min-w-0 flex-col gap-2">
            <span>Buka halaman login Claude, masuk dengan akun berlangganan, lalu setujui.</span>
            <Button asChild variant="outline" size="sm" className="self-start">
              <a href={link.url} target="_blank" rel="noreferrer">
                <ExternalLink /> Buka halaman login Claude
              </a>
            </Button>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <span className={step}>2</span>
          <span>Claude menampilkan sebuah kode. Salin kode itu.</span>
        </li>
        <li className="flex items-start gap-3">
          <span className={step}>3</span>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Label htmlFor="aos-login-code">Tempel kodenya di sini</Label>
            <Input
              id="aos-login-code"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="font-mono"
              placeholder="Kode dari Claude"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        </li>
      </ol>
      {problem && <Alert variant="destructive">{problem}</Alert>}
      {finish.isError && !problem && <Alert variant="destructive">{errorMessage(finish.error)}</Alert>}
      <p className="text-xs text-muted-foreground">
        Tautan berlaku sampai {formatTime(link.expiresAt)} dan hanya untuk satu kali login. Kode ditukar menjadi token
        di server; token tidak ditampilkan.
      </p>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={begin} disabled={start.isPending || finish.isPending}>
          <RefreshCw /> Buat tautan baru
        </Button>
        <Button type="submit" disabled={finish.isPending || !code.trim()}>
          {finish.isPending && <Loader2 className="animate-spin" />}
          {finish.isPending ? 'Menghubungkan…' : 'Hubungkan'}
        </Button>
      </DialogFooter>
    </form>
  );
}
