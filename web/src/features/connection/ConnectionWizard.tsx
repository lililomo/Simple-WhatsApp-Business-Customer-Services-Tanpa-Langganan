import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ConnectionDTO, PhoneNumberInfo, ValidateConnectionResult } from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Creds {
  appId: string;
  appSecret: string;
  wabaId: string;
  accessToken: string;
}

function Field({ id, label, hint, ...props }: { id: string; label: string; hint?: string } & React.ComponentProps<'input'>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PhoneOption({ phone, selected, onSelect }: { phone: PhoneNumberInfo; selected: boolean; onSelect: () => void }) {
  const onCloud = phone.platformType === 'CLOUD_API';
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
        selected && 'border-primary ring-2 ring-primary/30',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{phone.displayPhoneNumber}</span>
        {phone.verifiedName && <span className="text-sm text-muted-foreground">{phone.verifiedName}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant={onCloud ? 'success' : 'warning'}>{onCloud ? 'Cloud API' : `Belum di Cloud API (${phone.platformType ?? '?'})`}</Badge>
        {phone.qualityRating && <Badge variant="outline">Kualitas {phone.qualityRating}</Badge>}
        {phone.status && <Badge variant="outline">{phone.status}</Badge>}
      </div>
      <span className="font-mono text-xs text-muted-foreground">Phone Number ID {phone.id}</span>
    </button>
  );
}

export function ConnectionWizard({ existing, onDone }: { existing: ConnectionDTO | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [creds, setCreds] = useState<Creds>({
    appId: existing?.appId ?? '',
    appSecret: '',
    wabaId: existing?.wabaId ?? '',
    accessToken: '',
  });
  const [phones, setPhones] = useState<PhoneNumberInfo[] | null>(null);
  const [wabaName, setWabaName] = useState<string | null>(null);
  const [phoneId, setPhoneId] = useState(existing?.phoneNumberId ?? '');
  const keepsSecrets = !!existing && !creds.appSecret && !creds.accessToken;

  const lookup = useMutation({
    mutationFn: async () => {
      if (keepsSecrets) {
        return { phoneNumbers: (await api<{ phoneNumbers: PhoneNumberInfo[] }>('/api/connection/phone-numbers')).phoneNumbers, waba: null };
      }
      return api<ValidateConnectionResult>('/api/connection/validate', { method: 'POST', body: creds });
    },
    onSuccess: (res) => {
      setPhones(res.phoneNumbers);
      setWabaName(res.waba?.name ?? null);
      if (res.phoneNumbers.length === 1) setPhoneId(res.phoneNumbers[0]!.id);
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api<{ connection: ConnectionDTO }>('/api/connection', {
        method: 'PUT',
        body: {
          appId: creds.appId,
          wabaId: creds.wabaId,
          phoneNumberId: phoneId,
          ...(creds.appSecret ? { appSecret: creds.appSecret } : {}),
          ...(creds.accessToken ? { accessToken: creds.accessToken } : {}),
        },
      }),
    onSuccess: ({ connection }) => {
      qc.setQueryData(['connection'], connection);
      qc.invalidateQueries({ queryKey: ['connection-status'] });
      toast.success('Koneksi WhatsApp disimpan.');
      onDone();
    },
  });

  const submitCreds = (e: FormEvent) => {
    e.preventDefault();
    lookup.mutate();
  };

  if (phones) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>2. Pilih nomor</CardTitle>
          <CardDescription>
            {wabaName ? `WABA "${wabaName}"` : 'WABA ini'} berisi {phones.length} nomor. Pilih nomor yang dipakai WA Inbox.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
          {phones.length === 0 && (
            <Alert variant="warning">
              Belum ada nomor di WABA ini. Tambahkan nomor lewat WhatsApp Manager (verifikasi OTP), lalu ulangi.
            </Alert>
          )}
          {phones.map((p) => (
            <PhoneOption key={p.id} phone={p} selected={p.id === phoneId} onSelect={() => setPhoneId(p.id)} />
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPhones(null)}>
              Kembali
            </Button>
            <Button disabled={!phoneId || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Menyimpan…' : 'Simpan koneksi'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>1. Kredensial Meta App</CardTitle>
        <CardDescription>
          Ambil dari developers.facebook.com (App ID & App Secret di App settings → Basic, WABA ID di WhatsApp → API Setup)
          dan token permanen system user di Business Settings → System users.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submitCreds}>
          {lookup.isError && <Alert variant="destructive">{errorMessage(lookup.error)}</Alert>}
          <Field id="appId" label="App ID" inputMode="numeric" required value={creds.appId} onChange={(e) => setCreds({ ...creds, appId: e.target.value })} />
          <Field
            id="appSecret"
            label="App Secret"
            type="password"
            autoComplete="off"
            required={!existing}
            placeholder={existing ? 'Kosongkan untuk memakai nilai tersimpan' : ''}
            hint="Dipakai untuk memverifikasi tanda tangan webhook dari Meta."
            value={creds.appSecret}
            onChange={(e) => setCreds({ ...creds, appSecret: e.target.value })}
          />
          <Field id="wabaId" label="WhatsApp Business Account ID (WABA ID)" inputMode="numeric" required value={creds.wabaId} onChange={(e) => setCreds({ ...creds, wabaId: e.target.value })} />
          <Field
            id="token"
            label="System user access token"
            type="password"
            autoComplete="off"
            required={!existing}
            placeholder={existing ? `Tersimpan ••••${existing.tokenLast4}. Kosongkan untuk memakai token lama` : ''}
            hint="Token permanen (expiration: Never) dengan izin whatsapp_business_messaging dan whatsapp_business_management. Bukan token sementara dari layar API Setup."
            value={creds.accessToken}
            onChange={(e) => setCreds({ ...creds, accessToken: e.target.value })}
          />
          {existing && (creds.appSecret === '') !== (creds.accessToken === '') && (
            <Alert variant="warning">Untuk validasi ulang, isi App Secret dan token sekaligus, atau kosongkan keduanya.</Alert>
          )}
          <div className="flex gap-2">
            {existing && (
              <Button type="button" variant="outline" onClick={onDone}>
                Batal
              </Button>
            )}
            <Button type="submit" disabled={lookup.isPending || (!!existing && (creds.appSecret === '') !== (creds.accessToken === ''))}>
              {lookup.isPending ? 'Memeriksa ke Meta…' : 'Lanjut'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
