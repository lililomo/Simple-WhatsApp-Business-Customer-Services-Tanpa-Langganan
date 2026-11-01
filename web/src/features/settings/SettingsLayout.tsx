import { NavLink, Outlet } from 'react-router';
import { Clock, KeyRound, Palette, Phone, User, Users, Zap } from 'lucide-react';
import { useMe } from '@/features/auth/hooks';
import { cn } from '@/lib/utils';

const items = [
  { to: '/settings/profile', label: 'Profil', icon: User, admin: false },
  { to: '/settings/appearance', label: 'Tampilan & notifikasi', icon: Palette, admin: false },
  { to: '/settings/quick-replies', label: 'Balasan cepat', icon: Zap, admin: false },
  { to: '/settings/users', label: 'Pengguna', icon: Users, admin: true },
  { to: '/settings/whatsapp', label: 'WhatsApp', icon: Phone, admin: true },
  { to: '/settings/business-hours', label: 'Jam kerja', icon: Clock, admin: true },
  { to: '/settings/api', label: 'API & Webhook', icon: KeyRound, admin: true },
];

export function SettingsLayout() {
  const { data: user } = useMe();
  const visible = items.filter((i) => !i.admin || user?.role === 'admin');
  return (
    <div className="flex h-full flex-col md:flex-row md:gap-2 md:p-2">
      <aside className="shrink-0 border-b bg-card p-3 md:w-64 md:rounded-2xl md:border md:shadow-sm">
        <h1 className="mb-3 px-2 text-lg font-bold">Pengaturan</h1>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {visible.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  // Item aktif bergaya sidebar Coretax: latar lembut, teks tebal, garis emas di kiri.
                  isActive && 'bg-accent font-semibold text-foreground md:before:absolute md:before:inset-y-1.5 md:before:-left-3 md:before:w-1 md:before:rounded-r-full md:before:bg-gold',
                )
              }
            >
              <Icon className="size-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <section className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4 md:px-6 md:py-4">
        <Outlet />
      </section>
    </div>
  );
}
