import { useEffect, type ReactNode } from 'react';
import { useInboxSummary } from '@/features/chats/queries';
import { useRealtime } from '@/features/chats/useRealtime';
import { Link, NavLink, Outlet, useMatch } from 'react-router';
import { LogOut, MessageCircle, MessagesSquare, Moon, Palette, Settings, Sun } from 'lucide-react';
import { useLogout, useMe } from '@/features/auth/hooks';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip } from './ui/misc';
import { ConnectionBanner } from './ConnectionBanner';
import { NotificationPrompt } from './NotificationPrompt';

const railButton = 'flex size-11 items-center justify-center rounded-xl text-rail-foreground transition-colors hover:bg-white/10 hover:text-white';

function RailLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  // className harus string: Tooltip (Radix Slot) tidak bisa meneruskan className berbentuk fungsi milik NavLink.
  const active = !!useMatch({ path: to, end: false });
  return (
    <Tooltip content={label}>
      <Link
        to={to}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className={cn(railButton, active && 'bg-gold text-gold-foreground shadow-sm hover:bg-gold hover:text-gold-foreground')}
      >
        {children}
      </Link>
    </Tooltip>
  );
}

export function AppLayout() {
  const { data: user } = useMe();
  useRealtime();
  const { data: summary } = useInboxSummary();
  const unread = summary?.unreadConversations ?? 0;
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) WA Inbox` : 'WA Inbox';
  }, [unread]);
  const logout = useLogout();
  const { theme, toggle } = useTheme();
  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <nav className="flex w-16 shrink-0 flex-col items-center gap-2 bg-rail py-3">
        <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-gold text-gold-foreground shadow-md" title="WA Inbox">
          <MessagesSquare className="size-6" strokeWidth={2.2} />
        </div>
        <RailLink to="/chats" label="Chat">
          <span className="relative">
            <MessageCircle className="size-5" />
            {unread > 0 && (
              <span className="absolute -top-2 -right-2.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#e5484d] px-1 text-[10px] font-bold text-white ring-2 ring-rail">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </span>
        </RailLink>
        <RailLink to="/settings" label="Pengaturan">
          <Settings className="size-5" />
        </RailLink>
        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip content={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}>
            <button className={railButton} onClick={toggle} aria-label="Ganti tema">
              {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white ring-2 ring-gold/70 transition-colors hover:bg-white/20"
                aria-label="Menu akun"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-60">
              <DropdownMenuLabel>
                <div className="truncate">{user?.name}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">
                  {user?.nip ? `NIP ${user.nip}` : user?.email} · {user?.role === 'admin' ? 'Admin' : 'Petugas'}
                </div>
                {user?.seksi && <div className="truncate text-xs font-normal text-muted-foreground">{user.seksi}</div>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <NavLink to="/settings/appearance">
                  <Palette /> Tampilan & notifikasi
                </NavLink>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => logout.mutate()}>
                <LogOut /> Keluar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <NotificationPrompt />
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
