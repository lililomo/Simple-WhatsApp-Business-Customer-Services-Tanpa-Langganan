let audioCtx: AudioContext | null = null;

/** Bunyi singkat dua nada untuk pesan baru (tanpa file audio). */
export function playIncomingSound() {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
  } catch {
    // Browser bisa menolak audio sebelum ada interaksi pengguna.
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function showBrowserNotification(title: string, body: string, onClick: () => void) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, tag: title, icon: '/favicon.svg' });
  n.onclick = () => {
    window.focus();
    onClick();
    n.close();
  };
}
