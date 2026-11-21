/* BitchAt service worker — offline shell + web push. */

const CACHE_VERSION = "bitchat-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const MEDIA_CACHE = `${CACHE_VERSION}-media`;
const SHELL_ASSETS = ["/offline", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isMediaRequest(url) {
  return (
    url.pathname.startsWith("/storage/v1/object/public/") ||
    /\.(png|jpe?g|webp|gif|avif|svg|mp4|webm|m4a|mp3)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept Supabase realtime/auth traffic.
  if (
    url.hostname.includes("supabase.co") &&
    !url.pathname.startsWith("/storage/v1/object/public/")
  ) {
    return;
  }

  // Cache-first for chat media so a reopened chat loads instantly offline.
  if (isMediaRequest(url)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          return cached ?? Response.error();
        }
      }),
    );
    return;
  }

  // Navigation requests: network first, fall back to offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match("/offline")) ?? Response.error();
      }),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached ?? network;
      }),
    );
  }
});

self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "BitchAt", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "BitchAt";
  const options = {
    body: payload.body || "You have a new message",
    icon: payload.icon || "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    image: payload.image || undefined,
    tag: payload.tag || "bitchat-message",
    renotify: Boolean(payload.renotify),
    data: {
      url: payload.url || "/",
      ...(payload.data || {}),
    },
    vibrate: payload.vibrate || [18, 40, 18],
    timestamp: Date.now(),
    actions: payload.actions || [{ action: "open", title: "Open" }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* ignoring */
            }
          }
          return;
        }
      }

      await self.clients.openWindow(targetUrl);
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
