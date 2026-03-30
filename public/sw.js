const CACHE = 'dentalorder-v1'

self.addEventListener('push', e => {
  const data = e.data?.json() ?? {}
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'DentalOrder', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/', intent: data.intent ?? 'approval' },
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const intent = e.notification.data?.intent ?? null
  const url = e.notification.data?.url ?? '/'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin))
      if (existing) {
        return existing.focus().then(c => {
          if (intent) c.postMessage({ type: 'navigate', intent })
        })
      }
      return clients.openWindow(url)
    })
  )
})

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/', '/index.html'])).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  const { request } = e
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Never cache Supabase or API calls
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/api/')) return

  // Cache-first for hashed static assets
  if (url.pathname.match(/\.(js|css|woff2?|ttf|png|jpg|jpeg|svg|ico|webp)$/)) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
          return res
        })
      })
    )
    return
  }

  // Network-first for navigation — fall back to index.html when offline
  e.respondWith(
    fetch(request).catch(() =>
      caches.match('/index.html').then(r => r ?? new Response('Offline', { status: 503 }))
    )
  )
})
