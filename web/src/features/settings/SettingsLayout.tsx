import { NavLink, Outlet } from 'react-router';
import { KeyRound, Phone, User, Users } from 'lucide-react';
import { useMe } from '@/features/auth/hooks';
import { cn } from '@/lib/utils';

const items = [
  { to: '/settings/profile', label: 'Profil', icon: User, admin: false },
  { to: '/settings/users', label: 'Pengguna', icon: Users, admin: true },
  { to: '/settings/whatsapp', label: 'WhatsApp', icon: Phone, admin: true },
  { to: '/settings/api', label: 'API & Webhook', icon: KeyRound, admin: true },
];

export function SettingsLayout() {
  const { data: user } = useMe();
  const visible = items.filter((i) => !i.admin || user?.role === 'admin');
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="shrink-0 border-b p-3 md:w-56 md:border-r md:border-b-0">
        <h1 className="mb-2 px-2 text-lg font-semibold">Pengaturan</h1>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {visible.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap hover:bg-accent',
                  isActive && 'bg-accent font-medium text-primary',
                )
              }
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <Outlet />
      </section>
    </div>
  );
}
