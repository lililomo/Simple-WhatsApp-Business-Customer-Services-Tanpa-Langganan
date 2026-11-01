import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { MessagesSquare, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { useLogin, useMe } from './hooks';

function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/chats';
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (me.data) return <Navigate to={safeNext(params.get('next'))} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate(safeNext(params.get('next')), { replace: true }) });
  };

  return (
    <main className="grid min-h-svh bg-background lg:grid-cols-[1.1fr_1fr]">
      {/* Panel merek: navy dengan aksen emas, seperti Coretax. */}
      <section className="relative hidden overflow-hidden bg-[#212c5f] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-[#ffc91b]/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-[28rem] rounded-full bg-[#464f7a]/40 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[#ffc91b] text-[#131b44] shadow-lg">
            <MessagesSquare className="size-7" strokeWidth={2.2} />
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight">WA Inbox</div>
            <div className="text-sm text-white/70">KPP Pratama Banyuwangi</div>
          </div>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl leading-tight font-bold tracking-tight">
            Layanan WhatsApp <span className="text-[#ffc91b]">wajib pajak</span>, dalam satu kotak masuk.
          </h1>
          <ul className="mt-8 flex flex-col gap-3 text-sm text-white/80">
            <li className="flex items-center gap-3">
              <Zap className="size-4 text-[#ffc91b]" /> Balasan cepat, stiker, dan template untuk seluruh petugas
            </li>
            <li className="flex items-center gap-3">
              <ShieldCheck className="size-4 text-[#ffc91b]" /> Terhubung langsung ke WhatsApp Business Cloud API
            </li>
          </ul>
        </div>
        <div className="relative h-1.5 w-24 rounded-full bg-[#ffc91b]" />
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-gold text-gold-foreground shadow-md">
              <MessagesSquare className="size-6" />
            </div>
            <div>
              <div className="text-lg font-bold">WA Inbox</div>
              <div className="text-xs text-muted-foreground">KPP Pratama Banyuwangi</div>
            </div>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Masuk</h2>
          <p className="mt-1 text-sm text-muted-foreground">Gunakan akun petugas yang diberikan admin.</p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm">
            {login.isError && <Alert variant="destructive">{errorMessage(login.error)}</Alert>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" size="lg" disabled={login.isPending} className="mt-1">
              {login.isPending ? 'Memproses…' : 'Masuk'}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
