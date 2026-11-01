// Service worker WA Inbox: hanya untuk notifikasi Web Push (tanpa cache offline).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'WA Inbox', body: event.data ? event.data.text() : '' };
  }
  const url = data.url || '/chats';
  event.waitUntil(
    (async () => {
      // Petugas sedang membuka percakapan ini di tab yang aktif: tidak perlu notifikasi.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const viewing = windows.some((c) => c.focused && c.visibilityState === 'visible' && new URL(c.url).pathname === url);
      if (viewing) return;
      await self.registration.showNotification(data.title || 'WA Inbox', {
        body: data.body || 'Pesan baru',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: data.conversationId ? `conv-${data.conversationId}` : 'wa-inbox',
        renotify: true,
        data: { url },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/chats';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'navigate', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
