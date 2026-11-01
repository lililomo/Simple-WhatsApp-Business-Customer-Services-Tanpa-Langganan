import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleX, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { ConnectionCheckItem, ConnectionDTO } from '@wa/shared';
import { CopyField } from '@/components/CopyField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { ConnectionWizard } from './ConnectionWizard';
import { FailedEventsCard } from './FailedEventsCard';
import { useConnection } from './hooks';

const WEBHOOK_FIELDS = [
  'messages',
  'message_template_status_update',
  'template_category_update',
  'message_template_quality_update',
  'account_update',
  'phone_number_quality_update',
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-all">{children}</dd>
    </div>
  );
}

function CheckList({ items }: { items: ConnectionCheckItem[] }) {
  const labels: Record<ConnectionCheckItem['key'], string> = {
    credentials: 'Token & akses',
    subscription: 'Langganan webhook app',
    phone: 'Nomor di Cloud API',
    webhook: 'Webhook diterima',
  };
  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.key} className="flex gap-2 text-sm">
          {i.ok && !i.warning ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : i.ok || i.warning ? (
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          ) : (
            <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          <span>
            <span className="font-medium">{labels[i.key]}:</span> {i.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RegisterCard() {
  const [pin, setPin] = useState('');
  const register = useMutation({
    mutationFn: () => api('/api/connection/register', { method: 'POST', body: { pin } }),
    onSuccess: () => {
      toast.success('Nomor didaftarkan ke Cloud API.');
      setPin('');
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftarkan nomor ke Cloud API</CardTitle>
        <CardDescription>
          Hanya diperlukan jika hasil cek menyebut nomor belum terdaftar di Cloud API. PIN 6 digit menjadi PIN
          verifikasi dua langkah nomor ini. Nomor yang sudah aktif (mis. dipakai Kirimdev) tidak perlu didaftarkan ulang.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pin">PIN 6 digit</Label>
            <Input id="pin" inputMode="numeric" pattern="\d{6}" maxLength={6} required className="w-32" value={pin} onChange={(e) => setPin(e.target.value)} />
          </div>
          <Button type="submit" variant="outline" disabled={register.isPending}>
            Daftarkan
          </Button>
          {register.isError && <Alert variant="destructive" className="w-full">{errorMessage(register.error)}</Alert>}
        </form>
      </CardContent>
    </Card>
  );
}

function ConnectionSummary({ connection, onEdit }: { connection: ConnectionDTO; onEdit: () => void }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<ConnectionCheckItem[] | null>(null);
  const check = useMutation({
    mutationFn: () => api<{ items: ConnectionCheckItem[]; connection: ConnectionDTO }>('/api/connection/check', { method: 'POST' }),
    onSuccess: (res) => {
      setItems(res.items);
      qc.setQueryData(['connection'], res.connection);
      qc.invalidateQueries({ queryKey: ['connection-status'] });
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{connection.verifiedName ?? connection.label}</CardTitle>
            <CardDescription>{connection.displayPhoneNumber}</CardDescription>
          </div>
          <Badge variant={connection.status === 'active' ? 'success' : 'destructive'}>
            {connection.status === 'active' ? 'Aktif' : 'Bermasalah'}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {connection.lastError && <Alert variant="destructive">{connection.lastError}</Alert>}
          <dl className="flex flex-col gap-2">
            <Row label="Phone Number ID">{connection.phoneNumberId}</Row>
            <Row label="WABA ID">{connection.wabaId}</Row>
            <Row label="App ID">{connection.appId}</Row>
            <Row label="Token">••••{connection.tokenLast4}</Row>
            <Row label="Kualitas">{connection.qualityRating ?? '—'}</Row>
            <Row label="Subscribe app">{connection.subscribedAt ? formatDateTime(connection.subscribedAt) : 'Belum'}</Row>
            <Row label="Webhook terakhir">{connection.lastWebhookAt ? formatDateTime(connection.lastWebhookAt) : 'Belum pernah'}</Row>
          </dl>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => check.mutate()} disabled={check.isPending}>
              <RefreshCw className={check.isPending ? 'animate-spin' : ''} /> Cek koneksi
            </Button>
            <Button variant="outline" onClick={onEdit}>
              Perbarui kredensial
            </Button>
          </div>
          {check.isError && <Alert variant="destructive">{errorMessage(check.error)}</Alert>}
          {items && <CheckList items={items} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook di Meta App</CardTitle>
          <CardDescription>
            Buka developers.facebook.com → aplikasi Anda → WhatsApp → Configuration → Webhook → Edit. Tempel dua nilai
            di bawah, klik <b>Verify and save</b>, lalu subscribe field berikut. Setelah itu klik <b>Cek koneksi</b> dan
            kirim pesan uji dari HP ke nomor kantor.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CopyField label="Callback URL" value={connection.callbackUrl} />
          <CopyField label="Verify token" value={connection.verifyToken} />
          <div className="flex flex-wrap gap-1.5">
            {WEBHOOK_FIELDS.map((f) => (
              <Badge key={f} variant="outline" className="font-mono">
                {f}
              </Badge>
            ))}
          </div>
          <Alert variant="warning">
            Meta App harus dalam mode <b>Live</b> agar semua webhook dikirim. App Review tidak diperlukan karena aplikasi
            hanya mengakses akun WhatsApp milik kantor sendiri.
          </Alert>
        </CardContent>
      </Card>

      <FailedEventsCard />
      <RegisterCard />
    </div>
  );
}

export function WhatsAppSettingsPage() {
  const { data: connection, isPending, isError, error } = useConnection();
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">Koneksi WhatsApp</h2>
        <p className="text-sm text-muted-foreground">
          Hubungkan nomor WhatsApp Business (Cloud API) memakai Meta App milik kantor.
        </p>
      </div>
      {isPending && <Skeleton className="h-40 w-full" />}
      {isError && <Alert variant="destructive">{errorMessage(error)}</Alert>}
      {!isPending && !isError && (connection && !editing ? (
        <ConnectionSummary connection={connection} onEdit={() => setEditing(true)} />
      ) : (
        <ConnectionWizard existing={connection ?? null} onDone={() => setEditing(false)} />
      ))}
    </div>
  );
}
