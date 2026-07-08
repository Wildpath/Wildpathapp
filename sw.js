// WildPath Service Worker — offline tile caching
const CACHE = 'wildpath-tiles-v1';

// Tile hosts to intercept and cache
const TILE_HOSTS = [
  'tile.openstreetmap.org',
  'tiles.wmflabs.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
];

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  const isTile = TILE_HOSTS.some(h => url.includes(h));
  if (!isTile) return;

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(r => {
          if (r && r.ok) {
            cache.put(e.request, r.clone());
          }
          return r;
        }).catch(() => cached || new Response('', { status: 503 }));
      })
    )
  );
});
