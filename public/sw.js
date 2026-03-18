const SW_VERSION = "v1";
const CACHE_NAME = "app-shell-" + SW_VERSION;

self.addEventListener("push", (event) => {
  let data = { title: "Neue Bestellung", body: "App öffnen, um die Bestellung zu überprüfen." };
  if (event.data) {
    try { data = event.data.json(); } catch { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/app-icon.svg",
      badge: "/app-icon.svg",
      tag: data.tag || "dental-order",
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      const match = cls.find((c) => c.url.includes(url));
      if (match) {
        match.focus();
      } else if (cls.length > 0) {
        cls[0].focus();
        cls[0].postMessage({ type: "NAVIGATE", url });
      } else {
        clients.openWindow(url);
      }
    })
  );
});

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip API calls and external requests — always go to network
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) {
    return;
  }

  // App shell: network-first, fall back to cache for offline
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (event.request.method === "GET" && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
