const SW_VERSION = "v2";
const CACHE_NAME = "app-shell-" + SW_VERSION;

// ── IndexedDB queue for offline stock movement mutations ──────────────────

const IDB_NAME = "dental-offline";
const IDB_STORE = "stock_movements_queue";
const IDB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function enqueueRequest(request) {
  const body = await request.clone().text();
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).add({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
      timestamp: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function replayQueue() {
  const db = await openDB();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });

  for (const item of items) {
    try {
      await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body,
      });
      // Remove successfully replayed item
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(item.id);
    } catch {
      // Leave in queue for next retry
    }
  }
}

// ── Replay queue when network is restored ────────────────────────────────
self.addEventListener("online", () => {
  replayQueue().catch(() => null);
});

// ── Push notification handling ────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "Wochenbericht verfügbar", body: "App öffnen, um den Wochenbericht zu sehen." };
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

// ── Fetch strategy ────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ── Supabase API: network-first with cache fallback ───────────────────
  if (url.hostname.includes("supabase.co")) {
    // Queue failed POST mutations to stock_movements for offline replay
    if (
      event.request.method === "POST" &&
      url.pathname.includes("/rest/v1/stock_movements")
    ) {
      event.respondWith(
        fetch(event.request.clone()).catch(async () => {
          await enqueueRequest(event.request).catch(() => null);
          return new Response(JSON.stringify({ queued: true }), {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        })
      );
      return;
    }

    // Other Supabase calls: network-first, fall back to cache
    event.respondWith(
      fetch(event.request.clone())
        .then((res) => {
          if (event.request.method === "GET" && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── Skip non-GET and cross-origin non-Supabase requests ──────────────
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  // ── Navigation requests (HTML): cache-first with network fallback ─────
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((res) => {
            if (res.status === 200) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return res;
          })
          .catch(() => {
            // Offline fallback: try cached root, else inline message
            return caches.match("/").then(
              (root) =>
                root ||
                new Response(
                  `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Offline</title>
                   <meta name="viewport" content="width=device-width,initial-scale=1">
                   <style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f1f5f9}
                   .card{background:#fff;border-radius:1rem;padding:2rem;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:320px}
                   h1{margin:0 0 .5rem;color:#0f172a;font-size:1.25rem}p{color:#64748b;margin:0 0 1.25rem;font-size:.9rem}
                   button{background:#0ea5e9;color:#fff;border:none;border-radius:.5rem;padding:.6rem 1.25rem;font-size:.9rem;cursor:pointer}</style></head>
                   <body><div class="card"><div style="font-size:2.5rem;margin-bottom:.75rem">📶</div>
                   <h1>Keine Verbindung</h1><p>Bitte überprüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.</p>
                   <button onclick="location.reload()">Erneut versuchen</button></div></body></html>`,
                  { headers: { "Content-Type": "text/html" } }
                )
            );
          });
      })
    );
    return;
  }

  // ── Static assets (JS/CSS/images): cache-first with network fallback ──
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
