import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { PASSWORD_MIN, type Role, type UserDTO } from '@wa/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, Skeleton, Switch } from '@/components/ui/misc';
import { useMe } from '@/features/auth/hooks';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <select
      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value as Role)}
    >
      <option value="agent">Petugas</option>
      <option value="admin">Admin</option>
    </select>
  );
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent' as Role });
  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: form }),
    onSuccess: () => {
      toast.success('Pengguna ditambahkan.');
      qc.invalidateQueries({ queryKey: ['users'] });
      setForm({ name: '', email: '', password: '', role: 'agent' });
      onOpenChange(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah pengguna</DialogTitle>
          <DialogDescription>Sampaikan password awal ke petugas lewat jalur yang aman.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {create.isError && <Alert variant="destructive">{errorMessage(create.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="u-name">Nama</Label>
            <Input id="u-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="u-pass">Password awal</Label>
            <Input id="u-pass" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Peran</Label>
            <RoleSelect value={form.role} onChange={(role) => setForm({ ...form, role })} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: UserDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [isActive, setActive] = useState(user.isActive);
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api(`/api/users/${user.id}`, {
        method: 'PATCH',
        body: { name, role, isActive, ...(password ? { password } : {}) },
      }),
    onSuccess: () => {
      toast.success('Perubahan disimpan.');
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah pengguna</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          {save.isError && <Alert variant="destructive">{errorMessage(save.error)}</Alert>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-name">Nama</Label>
            <Input id="e-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Peran</Label>
            <RoleSelect value={role} onChange={setRole} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="e-active">Aktif</Label>
              <p className="text-xs text-muted-foreground">Menonaktifkan langsung mengeluarkan pengguna dari semua sesi.</p>
            </div>
            <Switch id="e-active" checked={isActive} onCheckedChange={setActive} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-pass">Reset password (opsional)</Label>
            <Input id="e-pass" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} placeholder="Kosongkan jika tidak diubah" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending}>
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: UserDTO[] }>('/api/users') });

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Pengguna</h2>
          <p className="text-sm text-muted-foreground">Admin dan petugas yang bisa masuk ke WA Inbox.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <UserPlus /> Tambah
        </Button>
      </div>
      {users.isError && <Alert variant="destructive">{errorMessage(users.error)}</Alert>}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Nama</th>
              <th className="px-4 py-2 font-medium">Peran</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Terakhir masuk</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.isPending &&
              [0, 1].map((i) => (
                <tr key={i}>
                  <td colSpan={5} className="px-4 py-3">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))}
            {users.data?.users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-4 py-2">
                  <div className="font-medium">
                    {u.name} {u.id === me?.id && <span className="text-xs text-muted-foreground">(Anda)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-2">{u.role === 'admin' ? 'Admin' : 'Petugas'}</td>
                <td className="px-4 py-2">
                  <Badge variant={u.isActive ? 'success' : 'secondary'}>{u.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}</td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="icon-sm" aria-label={`Ubah ${u.name}`} onClick={() => setEditing(u)}>
                    <Pencil />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
