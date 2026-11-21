/// Direct — service worker (push notifications only).
/// Kept intentionally small: no offline caching, the app is realtime-first.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = { title: "Direct", body: "You have a new message" };
  try {
    payload = Object.assign(payload, event.data.json());
  } catch {
    payload.body = event.data.text() || payload.body;
  }

  const options = {
    body: payload.body,
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    tag: payload.tag || "direct-notification",
    renotify: true,
    vibrate: [120, 60, 120],
    data: { url: payload.url || "/" },
    actions: payload.actionLabel
      ? [{ action: "open", title: payload.actionLabel, icon: payload.icon }]
      : undefined,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      try {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const win of wins) {
          if ("focus" in win) {
            await win.focus();
            if ("navigate" in win) {
              try {
                await win.navigate(url);
              } catch {
                /* best effort */
              }
            }
            return;
          }
        }
      } catch {
        /* fall through to openWindow */
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
