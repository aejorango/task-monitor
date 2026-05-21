// Minimal service worker for Task Monitor.
// Lets the app fire notifications even after the tab is closed (within
// browser-imposed limits).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Handle clicks on notifications: focus an existing tab on this origin,
// else open a new window. self.registration.scope is set when the SW is
// registered (currently '/' on tasks.blueinnovation.ph, '/task-monitor/'
// on the legacy GitHub Pages path), so this code is host-agnostic.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const fallbackUrl = event.notification.data?.url || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(fallbackUrl);
    })
  );
});
