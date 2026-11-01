import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PASSWORD_MIN } from '@wa/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { useMe } from '@/features/auth/hooks';
import { api, errorMessage } from '@/lib/api';

export function ProfilePage() {
  const { data: user } = useMe();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useMutation({
    mutationFn: () => api('/api/auth/password', { method: 'PATCH', body: { currentPassword, newPassword } }),
    onSuccess: () => {
      toast.success('Password berhasil diganti.');
      setCurrent('');
      setNew('');
      setConfirm('');
    },
  });
  const mismatch = confirm.length > 0 && confirm !== newPassword;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) change.mutate();
  };

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{user?.name}</CardTitle>
          <CardDescription>
            {user?.email} · {user?.role === 'admin' ? 'Admin' : 'Petugas'}
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Ganti password</CardTitle>
          <CardDescription>Minimal {PASSWORD_MIN} karakter. Sesi di perangkat lain tetap aktif.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {change.isError && <Alert variant="destructive">{errorMessage(change.error)}</Alert>}
            <div className="flex flex-col gap-2">
              <Label htmlFor="cur">Password sekarang</Label>
              <Input id="cur" type="password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new">Password baru</Label>
              <Input id="new" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm">Ulangi password baru</Label>
              <Input id="confirm" type="password" autoComplete="new-password" required aria-invalid={mismatch} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              {mismatch && <p className="text-xs text-destructive">Password tidak sama.</p>}
            </div>
            <div>
              <Button type="submit" disabled={change.isPending || mismatch}>
                Simpan password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
