const CACHE_VERSION = 'estoque-nh-pwa-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const NEVER_CACHE_PREFIXES = [
  '/api/',
  '/uploads/',
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

function shouldBypass(url, request) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;

  return NEVER_CACHE_PREFIXES.some((prefix) =>
    url.pathname.startsWith(prefix)
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (shouldBypass(url, request)) {
    return;
  }

  // Navigation: network first so a newly published version is preferred.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, copy);
            });
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;

          const root = await caches.match('/');
          if (root) return root;

          return new Response(
            'Aplicativo temporariamente indisponível.',
            {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            }
          );
        })
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      return cached || (await network) || fetch(request);
    })
  );
});
