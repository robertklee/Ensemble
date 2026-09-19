const CACHE = 'ensemble-__CACHE_VERSION__';
const PRECACHE = '__PRECACHE_ASSETS__';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith('ensemble-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    }),
  );
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
