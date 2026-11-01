import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface FailedEvent {
  id: string;
  receivedAt: string;
  attempts: number;
  error: string | null;
  payloadPreview: string;
}

/** Webhook Meta yang gagal diproses setelah semua percobaan. Hanya tampil bila ada. */
export function FailedEventsCard() {
  const qc = useQueryClient();
  const events = useQuery({
    queryKey: ['webhook-events', 'failed'],
    queryFn: async () => (await api<{ events: FailedEvent[] }>('/api/admin/webhook-events?status=failed')).events,
    refetchInterval: 60_000,
  });
  const replay = useMutation({
    mutationFn: (id: string) => api(`/api/admin/webhook-events/${id}/replay`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Event dijadwalkan untuk diproses ulang.');
      qc.invalidateQueries({ queryKey: ['webhook-events'] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!events.data?.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook gagal diproses ({events.data.length})</CardTitle>
        <CardDescription>
          Pesan atau status dari Meta yang gagal disimpan setelah beberapa percobaan. Proses ulang setelah penyebabnya diperbaiki.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {events.data.map((e) => (
          <div key={e.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">
                #{e.id} · {formatDateTime(e.receivedAt)} · {e.attempts}x dicoba
              </span>
              <Button size="sm" variant="outline" disabled={replay.isPending} onClick={() => replay.mutate(e.id)}>
                <RotateCcw /> Proses ulang
              </Button>
            </div>
            {e.error && <p className="text-destructive">{e.error}</p>}
            <code className="truncate text-xs text-muted-foreground">{e.payloadPreview}</code>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
