import { useSyncExternalStore } from 'react';

/**
 * Preferensi tampilan per browser (tema, ukuran teks, lebar kolom daftar chat). Disimpan di localStorage,
 * bukan di server, sehingga setiap petugas/perangkat punya pengaturannya sendiri.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Prefs {
  theme: ThemeMode;
  /** Ukuran teks dalam persen dari ukuran dasar browser; seluruh UI memakai rem sehingga ikut membesar. */
  fontScale: number;
  /** Lebar kolom daftar chat (px) di layar lebar. */
  listWidth: number;
}

export const FONT_SCALES = [
  { value: 87.5, label: 'Kecil' },
  { value: 100, label: 'Normal' },
  { value: 112.5, label: 'Besar' },
  { value: 125, label: 'Sangat besar' },
] as const;

export const LIST_WIDTH = { min: 260, max: 640, default: 384 };

const KEY = 'wa-inbox-prefs';
const LEGACY_THEME_KEY = 'wa-inbox-theme';
const DEFAULTS: Prefs = { theme: 'system', fontScale: 100, listWidth: LIST_WIDTH.default };
const listeners = new Set<() => void>();

function readStored(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    const legacy = localStorage.getItem(LEGACY_THEME_KEY);
    const theme = raw?.theme ?? (legacy === 'light' || legacy === 'dark' ? legacy : DEFAULTS.theme);
    return {
      theme: ['light', 'dark', 'system'].includes(theme) ? theme : DEFAULTS.theme,
      fontScale: FONT_SCALES.some((f) => f.value === raw?.fontScale) ? raw!.fontScale! : DEFAULTS.fontScale,
      listWidth: clampListWidth(raw?.listWidth ?? DEFAULTS.listWidth),
    };
  } catch {
    return DEFAULTS;
  }
}

export function clampListWidth(width: number): number {
  return Math.round(Math.min(LIST_WIDTH.max, Math.max(LIST_WIDTH.min, width)));
}

const darkQuery = typeof window === 'undefined' ? null : window.matchMedia?.('(prefers-color-scheme: dark)');
let current: Prefs = typeof window === 'undefined' ? DEFAULTS : readStored();

export function resolvedTheme(p: Prefs = current): 'light' | 'dark' {
  return p.theme === 'system' ? (darkQuery?.matches ? 'dark' : 'light') : p.theme;
}

function apply() {
  const root = document.documentElement;
  root.classList.toggle('dark', resolvedTheme() === 'dark');
  root.style.fontSize = current.fontScale === 100 ? '' : `${current.fontScale}%`;
}

export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  apply();
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Penyimpanan diblokir: pengaturan tetap berlaku untuk sesi ini saja.
  }
  listeners.forEach((l) => l());
}

export function applyInitialTheme() {
  apply();
  darkQuery?.addEventListener('change', () => {
    if (current.theme !== 'system') return;
    apply();
    listeners.forEach((l) => l());
  });
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/** Tombol cepat di rail: berganti antara terang dan gelap. */
export function useTheme() {
  const prefs = usePrefs();
  const theme = resolvedTheme(prefs);
  return { theme, toggle: () => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' }) };
}
