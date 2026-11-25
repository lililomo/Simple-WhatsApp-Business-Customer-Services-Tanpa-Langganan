import { useState, type FormEvent } from 'react';
import { ArrowUpDown, Loader2, PlugZap, Unplug } from 'lucide-react';
import { isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { credentialBody, type AosProvider, type AosProviderStatus } from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatTime } from '@/lib/format';
import { formatDuration, modelLabel, PROVIDER_NAME } from './helpers';
import { useRemoveCredential, useSetCredential, useTestCredential } from './queries';
import { SubscriptionLogin } from './SubscriptionLogin';

const SECRET_NAME: Record<AosProvider, string> = { subscription: 'Token langganan', api: 'Kunci API' };
/** Nama yang sama untuk dipakai di tengah kalimat. */
const SECRET_NAME_INLINE: Record<AosProvider, string> = { subscription: 'token langganan', api: 'kunci API' };
/** Awalan token/kunci tiap jalur, untuk menangkap salah tempel sebelum dikirim. */
const SECRET_PREFIX: Record<AosProvider, string> = { subscription: 'sk-ant-oat', api: 'sk-ant-api' };

const code = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]';

function CredentialHelp({ provider }: { provider: AosProvider }) {
  if (provider === 'api') {
    return (
      <p className="text-sm">
        Buat kunci di Claude Console (console.anthropic.com) › API Keys, pastikan ada saldo, lalu tempel di
        sini (diawali <code className={code}>sk-ant-api</code>).
      </p>
    );
  }
  return (
    <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
      <li>
        Di komputer Anda, buka terminal dan jalankan <code className={code}>claude setup-token</code>.
      </li>
      <li>Masuk dengan akun Claude berlangganan di browser yang terbuka.</li>
      <li>
        Salin token yang ditampilkan (diawali <code className={code}>sk-ant-oat</code>) dan tempel di sini.
      </li>
    </ol>
  );
}

/** Hal yang perlu diketahui sebelum memakai akun langganan, apa pun cara menghubungkannya. */
function SubscriptionNotice() {
  return (
    <Alert variant="warning" className="flex flex-col gap-1.5 text-sm">
      <p>
        Matikan <em>Help improve Claude</em> di setelan privasi akun itu sebelum menghubungkan.
      </p>
      <p>
        Langganan Claude ditujukan untuk pemakaian perorangan; untuk layanan bersama, jalur API adalah jalur
        resminya.
      </p>
    </Alert>
  );
}

/** Dialog menghubungkan atau mengganti kredensial. Nilai yang tersimpan tidak pernah ditampilkan; hanya bisa diganti. */
function CredentialDialog({
  provider,
  replacing,
  onClose,
}: {
  provider: AosProvider;
  replacing: boolean;
  onClose: () => void;
}) {
  const [secret, setSecret] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // Jalur langganan: bawaannya masuk lewat tautan; menempel token sendiri tetap tersedia.
  const [manual, setManual] = useState(provider !== 'subscription');
  const save = useSetCredential();
  const other: AosProvider = provider === 'api' ? 'subscription' : 'api';
  const typed = secret.trim();
  const wrongSlot = typed.startsWith(SECRET_PREFIX[other]);
  const oddPrefix = typed.length >= 10 && !wrongSlot && !typed.startsWith(SECRET_PREFIX[provider]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = credentialBody.safeParse({ secret });
    if (!parsed.success) {
      setProblem(
        `${SECRET_NAME[provider]} tidak lengkap. Pastikan seluruhnya tersalin, tanpa spasi atau baris baru.`,
      );
      return;
    }
    if (wrongSlot) {
      setProblem(
        `Ini ${SECRET_NAME_INLINE[other]}, bukan ${SECRET_NAME_INLINE[provider]}. Hubungkan lewat kartu ${PROVIDER_NAME[other]}.`,
      );
      return;
    }
    setProblem(null);
    save.mutate(
      { provider, secret: parsed.data.secret },
      {
        onSuccess: () => {
          toast.success(`${PROVIDER_NAME[provider]} terhubung. Tekan "Uji koneksi" untuk memastikan.`);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {replacing ? `Ganti ${SECRET_NAME_INLINE[provider]}` : `Hubungkan ${PROVIDER_NAME[provider]}`}
          </DialogTitle>
          <DialogDescription>
            {SECRET_NAME[provider]} disimpan terenkripsi di server dan tidak pernah ditampilkan lagi; hanya
            empat karakter terakhirnya yang terlihat.
          </DialogDescription>
        </DialogHeader>
        {provider === 'subscription' && <SubscriptionNotice />}
        {!manual && <SubscriptionLogin onDone={onClose} onManual={() => setManual(true)} />}
        {manual && (
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <CredentialHelp provider={provider} />
            {problem && <Alert variant="destructive">{problem}</Alert>}
            {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="aos-secret">{SECRET_NAME[provider]}</Label>
              <Input
                id="aos-secret"
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                className="font-mono"
                placeholder={`${SECRET_PREFIX[provider]}…`}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
              {oddPrefix && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {SECRET_NAME[provider]} biasanya diawali {SECRET_PREFIX[provider]}. Periksa lagi sebelum
                  menyimpan.
                </p>
              )}
            </div>
            <DialogFooter className={provider === 'subscription' ? 'sm:justify-between' : undefined}>
              {provider === 'subscription' && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setManual(false)}>
                  Masuk lewat tautan saja
                </Button>
              )}
              <Button type="submit" disabled={save.isPending || !typed}>
                {save.isPending ? 'Menyimpan…' : replacing ? 'Ganti' : 'Hubungkan'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatePill({ status }: { status: AosProviderStatus }) {
  if (!status.connected) return <Badge variant="secondary">Belum terhubung</Badge>;
  if (status.state === 'ok') return <Badge variant="success">Terhubung</Badge>;
  if (status.state === 'rejected') {
    return (
      <Badge variant="destructive" title="Token atau kunci ditolak Claude. Ganti dengan yang baru.">
        Ditolak
      </Badge>
    );
  }
  if (status.state === 'cooldown') {
    const until = status.cooldownUntil;
    return (
      <Badge variant="warning" title="Kena batas pemakaian. Jalur ini dipakai lagi setelah waktu tersebut.">
        {until
          ? `Istirahat sampai ${isSameDay(new Date(until), new Date()) ? formatTime(until) : formatDateTime(until)}`
          : 'Istirahat'}
      </Badge>
    );
  }
  return <Badge variant="outline">Belum diuji</Badge>;
}

function ProviderCard({
  status,
  role,
  onlyConnection,
}: {
  status: AosProviderStatus;
  role: 'Utama' | 'Cadangan';
  onlyConnection: boolean;
}) {
  const { provider } = status;
  const name = PROVIDER_NAME[provider];
  const [dialog, setDialog] = useState(false);
  const test = useTestCredential();
  const remove = useRemoveCredential();

  const disconnect = () => {
    const consequence = onlyConnection
      ? 'Tidak ada jalur lain yang terhubung, jadi AOS akan berhenti bekerja.'
      : 'AOS hanya akan memakai jalur yang satunya.';
    if (!confirm(`Putuskan ${name}? ${consequence}`)) return;
    test.reset();
    remove.mutate(provider, {
      onSuccess: () => toast.success(`${name} diputuskan.`),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <section aria-label={name} className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={role === 'Utama' ? 'default' : 'secondary'}>{role}</Badge>
        <h3 className="min-w-0 flex-1 font-semibold">{name}</h3>
        <StatePill status={status} />
      </div>
      {status.connected ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {status.last4 && <span className="font-mono">•••• {status.last4}</span>}
          <span>
            {status.lastUsedAt
              ? `Terakhir dipakai ${formatDateTime(status.lastUsedAt)}`
              : 'Belum pernah dipakai'}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {provider === 'subscription'
            ? 'Memakai kuota akun Claude berlangganan.'
            : 'Memakai kunci API Claude; ditagih per pemakaian dari saldo di Claude Console.'}
        </p>
      )}
      {status.connected && status.lastError && (
        <p className="text-sm break-words text-destructive">{status.lastError}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={status.connected ? 'outline' : 'default'}
          onClick={() => {
            // Hasil uji lama tidak berlaku lagi untuk kredensial baru.
            test.reset();
            setDialog(true);
          }}
        >
          <PlugZap /> {status.connected ? 'Ganti' : 'Hubungkan'}
        </Button>
        {status.connected && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate(provider)}
            >
              {test.isPending && <Loader2 className="animate-spin" />} Uji koneksi
            </Button>
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={disconnect}>
              <Unplug /> Putuskan
            </Button>
          </>
        )}
      </div>
      {test.isPending && (
        <p className="text-xs text-muted-foreground">Menghubungi Claude… biasanya beberapa detik.</p>
      )}
      {test.isError && <Alert variant="destructive">{errorMessage(test.error)}</Alert>}
      {test.data && (
        <Alert variant={test.data.ok ? 'success' : 'destructive'}>
          {test.data.message}
          <span className="mt-0.5 block text-xs opacity-80">
            {[test.data.model ? modelLabel(test.data.model) : null, formatDuration(test.data.durationMs)]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </Alert>
      )}
      {dialog && (
        <CredentialDialog provider={provider} replacing={status.connected} onClose={() => setDialog(false)} />
      )}
    </section>
  );
}

/** Dua jalur ke Claude menurut urutan prioritas: yang pertama utama, yang kedua cadangan. */
export function ConnectionCard({
  order,
  providers,
  onSwap,
}: {
  order: AosProvider[];
  providers: AosProviderStatus[];
  onSwap: () => void;
}) {
  const statusOf = (provider: AosProvider): AosProviderStatus =>
    providers.find((p) => p.provider === provider) ?? {
      provider,
      connected: false,
      last4: null,
      state: 'unknown',
      cooldownUntil: null,
      lastError: null,
      lastUsedAt: null,
    };
  const connected = providers.filter((p) => p.connected).length;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1.5">
          <CardTitle>Koneksi ke Claude</CardTitle>
          <CardDescription>
            Bila jalur utama kena batas pemakaian atau sedang bermasalah, permintaan otomatis diulang lewat
            jalur cadangan.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onSwap}>
          <ArrowUpDown /> Tukar urutan
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {order.map((provider, index) => {
          const status = statusOf(provider);
          return (
            <ProviderCard
              key={provider}
              status={status}
              role={index === 0 ? 'Utama' : 'Cadangan'}
              onlyConnection={status.connected && connected === 1}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
