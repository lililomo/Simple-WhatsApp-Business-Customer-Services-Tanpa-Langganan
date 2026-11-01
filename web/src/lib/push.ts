import { useSyncExternalStore } from 'react';
import { api } from './api';

/**
 * Notifikasi Windows lewat Web Push: tetap muncul walau tab WA Inbox ditutup, selama browser masih berjalan
 * dan sesi login di browser ini masih berlaku. Pilihan aktif/nonaktif disimpan per browser.
 */
const PREF_KEY = 'wa-inbox-push';
const PROMPT_KEY = 'wa-inbox-push-prompt-dismissed';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function storedPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

function storePref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Diabaikan: pilihan hanya berlaku sampai halaman dimuat ulang.
  }
}

export function pushState(): PushState {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && storedPref() ? 'on' : 'off';
}

let snapshot = typeof window === 'undefined' ? 'unsupported' : pushState();
const refresh = () => {
  snapshot = pushState();
  notify();
};

export function usePushState(): PushState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** Daftarkan langganan browser ini ke server (dipanggil saat diaktifkan dan setiap aplikasi dibuka). */
async function syncSubscription(): Promise<void> {
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api<{ publicKey: string }>('/api/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  }
  // Sesi login bisa sudah berganti (keluar-masuk); server mengikat langganan ke sesi yang aktif.
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    refresh();
    return pushState();
  }
  storePref(true);
  await syncSubscription();
  refresh();
  return 'on';
}

export async function disablePush(): Promise<void> {
  storePref(false);
  if (pushSupported()) {
    const sub = await (await navigator.serviceWorker.getRegistration('/'))?.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => undefined);
      await sub.unsubscribe();
    }
  }
  refresh();
}

/** Saat aplikasi dibuka: daftarkan ulang langganan bila pengguna sudah mengaktifkannya di browser ini. */
export async function resumePush(): Promise<void> {
  if (pushState() !== 'on') return;
  await syncSubscription().catch(() => undefined);
}

export function sendTestPush() {
  return api<{ sent: number }>('/api/push/test', { method: 'POST' });
}

export function promptDismissed(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1';
  } catch {
    return true;
  }
}

export function dismissPrompt() {
  try {
    localStorage.setItem(PROMPT_KEY, '1');
  } catch {
    // Diabaikan.
  }
  notify();
}
