/* Muri service worker: offline-first app shell, never caches /api. */
const CACHE = 'muri-v1'
const CORE = ['/', '/index.html', '/muri-logo.jpg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Auth + data must always hit the network. Never cache or serve stale.
  if (url.pathname.startsWith('/api/')) return

  // Page navigations: network first, fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  // Same-origin static assets: cache first, then network.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request)
            .then((response) => {
              if (response.ok) {
                const copy = response.clone()
                caches
                  .open(CACHE)
                  .then((cache) => cache.put(request, copy))
              }
              return response
            })
            .catch(() => caches.match(request)),
      ),
    )
  }
})
