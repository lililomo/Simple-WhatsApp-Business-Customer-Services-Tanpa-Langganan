import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';
const KEY = 'wa-inbox-theme';
const listeners = new Set<() => void>();

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current: Theme = typeof window === 'undefined' ? 'light' : (readStored() ?? systemTheme());

function setTheme(next: Theme) {
  current = next;
  document.documentElement.classList.toggle('dark', next === 'dark');
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Penyimpanan diblokir: tema tetap berlaku untuk sesi ini saja.
  }
  listeners.forEach((l) => l());
}

export function applyInitialTheme() {
  document.documentElement.classList.toggle('dark', current === 'dark');
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
