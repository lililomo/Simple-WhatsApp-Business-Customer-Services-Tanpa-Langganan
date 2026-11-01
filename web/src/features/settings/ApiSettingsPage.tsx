import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, KeyRound, Plus, RotateCcw, Send, Trash2, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import {
  API_SCOPES,
  SCOPE_LABEL,
  WEBHOOK_EVENTS,
  type ApiKeyDTO,
  type ApiScope,
  type OutboundWebhookDTO,
  type WebhookDeliveryDTO,
  type WebhookEventType,
} from '@wa/shared';
import { CopyField } from '@/components/CopyField';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

const EVENT_LABEL: Record<WebhookEventType, string> = {
  'message.received': 'Pesan masuk',
  'message.sent': 'Pesan keluar',
  'message.status': 'Status pesan (terkirim/dibaca/gagal)',
};

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function SecretDialog({ title, description, value, onClose }: { title: string; description: string; value: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!value} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {value && <CopyField label="Nilai" value={value} />}
        <Alert variant="warning">Nilai ini hanya ditampilkan sekali. Simpan di konfigurasi sistem yang memakainya.</Alert>
        <DialogFooter>
          <Button onClick={onClose}>Sudah saya simpan</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysTab() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['messages:send', 'messages:read']);
  const [secret, setSecret] = useState<string | null>(null);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: async () => (await api<{ apiKeys: ApiKeyDTO[] }>('/api/api-keys')).apiKeys });
  const create = useMutation({
    mutationFn: () => api<{ key: string }>('/api/api-keys', { method: 'POST', body: { name, scopes } }),
    onSuccess: ({ key }) => {
      setSecret(key);
      setName('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('API key dicabut.');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Buat API key</CardTitle>
          <CardDescription>Satu key per sistem yang terhubung, dengan izin seperlunya.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            {create.isError && <Alert variant="destructive">{errorMessage(create.error)}</Alert>}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">Nama sistem</Label>
              <Input id="key-name" required placeholder="mis. Aplikasi Antrean" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {API_SCOPES.map((s) => (
                <Checkbox key={s} label={`${SCOPE_LABEL[s]} (${s})`} checked={scopes.includes(s)} onChange={(v) => setScopes(v ? [...scopes, s] : scopes.filter((x) => x !== s))} />
              ))}
            </div>
            <Button type="submit" className="self-start" disabled={create.isPending || scopes.length === 0}>
              <KeyRound /> Buat key
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nama</th>
              <th className="px-4 py-2 font-medium">Izin</th>
              <th className="px-4 py-2 font-medium">Terakhir dipakai</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {keys.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Belum ada API key.</td>
              </tr>
            )}
            {keys.data?.map((k) => (
              <tr key={k.id} className="border-t">
                <td className="px-4 py-2">
                  <div className="font-medium">{k.name}</div>
                  <code className="text-xs text-muted-foreground">{k.prefix}…</code>
                  {k.revokedAt && <Badge variant="secondary" className="ml-2">Dicabut</Badge>}
                </td>
                <td className="px-4 py-2 text-xs">{k.scopes.join(', ')}</td>
                <td className="px-4 py-2 text-muted-foreground">{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '—'}</td>
                <td className="px-4 py-2 text-right">
                  {!k.revokedAt && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Cabut ${k.name}`} onClick={() => confirm(`Cabut API key "${k.name}"? Sistem yang memakainya akan langsung ditolak.`) && revoke.mutate(k.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SecretDialog
        title="API key baru"
        description="Pakai sebagai header Authorization: Bearer <key>."
        value={secret}
        onClose={() => setSecret(null)}
      />
    </div>
  );
}

function Deliveries({ webhookId }: { webhookId: string }) {
  const qc = useQueryClient();
  const deliveries = useQuery({
    queryKey: ['deliveries', webhookId],
    queryFn: async () => (await api<{ deliveries: WebhookDeliveryDTO[] }>(`/api/outbound-webhooks/${webhookId}/deliveries`)).deliveries,
    refetchInterval: 10_000,
  });
  const redeliver = useMutation({
    mutationFn: (id: string) => api(`/api/outbound-webhooks/deliveries/${id}/redeliver`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deliveries', webhookId] }),
  });
  if (!deliveries.data?.length) return <p className="text-xs text-muted-foreground">Belum ada pengiriman.</p>;
  return (
    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
      {deliveries.data.map((d) => (
        <div key={d.id} className="flex items-center gap-2 rounded border px-2 py-1 text-xs">
          <Badge variant={d.status === 'success' ? 'success' : d.status === 'failed' ? 'destructive' : 'warning'}>{d.status}</Badge>
          <span className="font-mono">{d.eventType}</span>
          <span className="text-muted-foreground">{formatDateTime(d.createdAt)}</span>
          <span className="text-muted-foreground">HTTP {d.responseCode ?? '—'} · {d.attempts}x</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={d.responseSnippet ?? ''}>{d.responseSnippet}</span>
          {d.status !== 'success' && (
            <button className="shrink-0 underline" onClick={() => redeliver.mutate(d.id)}>
              Kirim ulang
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function WebhooksTab() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', url: '', events: ['message.received'] as WebhookEventType[] });
  const [secret, setSecret] = useState<string | null>(null);
  const hooks = useQuery({
    queryKey: ['outbound-webhooks'],
    queryFn: async () => (await api<{ webhooks: OutboundWebhookDTO[] }>('/api/outbound-webhooks')).webhooks,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['outbound-webhooks'] });
  const create = useMutation({
    mutationFn: () => api<{ secret: string }>('/api/outbound-webhooks', { method: 'POST', body: form }),
    onSuccess: ({ secret: s }) => {
      setSecret(s);
      setForm({ name: '', url: '', events: ['message.received'] });
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api(`/api/outbound-webhooks/${id}`, { method: 'PATCH', body }),
    onSuccess: invalidate,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'test' | 'rotate-secret' | 'delete' }) =>
      kind === 'delete'
        ? api(`/api/outbound-webhooks/${id}`, { method: 'DELETE' })
        : api<{ secret?: string }>(`/api/outbound-webhooks/${id}/${kind}`, { method: 'POST' }),
    onSuccess: (res, { kind, id }) => {
      if (kind === 'rotate-secret' && res && typeof res === 'object' && 'secret' in res) setSecret((res as { secret: string }).secret);
      if (kind === 'test') {
        toast.success('Event uji dikirim.');
        setTimeout(() => qc.invalidateQueries({ queryKey: ['deliveries', id] }), 1500);
      }
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Tambah webhook keluar</CardTitle>
          <CardDescription>
            WA Inbox mengirim POST JSON bertanda tangan HMAC ke URL ini setiap ada event. Gagal → dicoba ulang hingga 24 jam.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            {create.isError && <Alert variant="destructive">{errorMessage(create.error)}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wh-name">Nama</Label>
                <Input id="wh-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wh-url">URL (HTTPS)</Label>
                <Input id="wh-url" type="url" required placeholder="https://sistem-lain.kppbwi.id/wa-webhook" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              {WEBHOOK_EVENTS.map((ev) => (
                <Checkbox
                  key={ev}
                  label={EVENT_LABEL[ev]}
                  checked={form.events.includes(ev)}
                  onChange={(v) => setForm({ ...form, events: v ? [...form.events, ev] : form.events.filter((x) => x !== ev) })}
                />
              ))}
            </div>
            <Button type="submit" className="self-start" disabled={create.isPending || form.events.length === 0}>
              <Plus /> Tambah webhook
            </Button>
          </form>
        </CardContent>
      </Card>

      {hooks.data?.map((h) => (
        <Card key={h.id}>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="flex items-center gap-2">
                <Webhook className="size-4" /> {h.name}
              </CardTitle>
              <CardDescription className="break-all">{h.url}</CardDescription>
              <div className="flex flex-wrap gap-1">
                {h.events.map((ev) => (
                  <Badge key={ev} variant="outline" className="font-mono">{ev}</Badge>
                ))}
                {h.failureCount > 0 && <Badge variant="warning">{h.failureCount} gagal beruntun</Badge>}
              </div>
            </div>
            <Switch checked={h.isActive} onCheckedChange={(v) => update.mutate({ id: h.id, body: { isActive: v } })} aria-label="Aktif" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => action.mutate({ id: h.id, kind: 'test' })}>
                <Send /> Kirim event uji
              </Button>
              <Button size="sm" variant="outline" onClick={() => action.mutate({ id: h.id, kind: 'rotate-secret' })}>
                <RotateCcw /> Ganti secret
              </Button>
              <Button size="sm" variant="ghost" onClick={() => confirm(`Hapus webhook "${h.name}"?`) && action.mutate({ id: h.id, kind: 'delete' })}>
                <Trash2 /> Hapus
              </Button>
            </div>
            <Deliveries webhookId={h.id} />
          </CardContent>
        </Card>
      ))}
      <SecretDialog
        title="Secret webhook"
        description="Dipakai sistem penerima untuk memverifikasi header X-WaInbox-Signature (lihat dokumentasi API)."
        value={secret}
        onClose={() => setSecret(null)}
      />
    </div>
  );
}

export function ApiSettingsPage() {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">API & Webhook</h2>
          <p className="text-sm text-muted-foreground">Hubungkan sistem lain untuk mengirim pesan dan menerima event WhatsApp.</p>
        </div>
        <Button asChild variant="outline">
          <a href="/api/docs" target="_blank" rel="noreferrer">
            Dokumentasi API <ExternalLink />
          </a>
        </Button>
      </div>
      <Tabs defaultValue="keys" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="keys">API key</TabsTrigger>
          <TabsTrigger value="webhooks">Webhook keluar</TabsTrigger>
        </TabsList>
        <TabsContent value="keys">
          <ApiKeysTab />
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhooksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
