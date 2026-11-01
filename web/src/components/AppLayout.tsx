import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { LogOut, MessageCircle, Moon, Settings, Sun } from 'lucide-react';
import { useLogout, useMe } from '@/features/auth/hooks';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
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

function RailLink({ to, label, children }: { to: string; label: string; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <NavLink
        to={to}
        aria-label={label}
        className={({ isActive }) =>
          cn(
            'flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
            isActive && 'bg-accent text-primary',
          )
        }
      >
        {children}
      </NavLink>
    </Tooltip>
  );
}

export function AppLayout() {
  const { data: user } = useMe();
  const logout = useLogout();
  const { theme, toggle } = useTheme();
  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-svh overflow-hidden">
      <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r bg-card py-3">
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <MessageCircle className="size-5" />
        </div>
        <RailLink to="/chats" label="Chat">
          <MessageCircle className="size-5" />
        </RailLink>
        <RailLink to="/settings" label="Pengaturan">
          <Settings className="size-5" />
        </RailLink>
        <div className="mt-auto flex flex-col items-center gap-2">
          <Tooltip content={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}>
            <Button variant="ghost" size="icon" onClick={toggle} aria-label="Ganti tema">
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex size-9 items-center justify-center rounded-full bg-secondary text-xs font-semibold"
                aria-label="Menu akun"
              >
                {initials}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="truncate">{user?.name}</div>
                <div className="truncate text-xs font-normal text-muted-foreground">
                  {user?.email} · {user?.role === 'admin' ? 'Admin' : 'Petugas'}
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => logout.mutate()}>
                <LogOut /> Keluar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <ConnectionBanner />
        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
