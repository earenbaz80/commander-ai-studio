// Commander AI Studio - Service Worker
// Version: 2.5.1 (Offline Cache & Core UI Templates Engine)

const CACHE_NAME = 'commander-ai-studio-cache-v2';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/app-icon.svg',
  '/favicon.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap'
];

// Precache core assets on installation
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precaching core application assets and UI templates...');
      return cache.addAll(CORE_ASSETS).catch((err) => {
        console.warn('[SW] Some core assets could not be pre-cached immediately:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Clean up stale caches on activation
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Clearing old cache version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch interceptor with Stale-While-Revalidate and Offline Fallbacks
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-GET requests and WebSocket / HMR requests
  if (request.method !== 'GET' || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }

  // 1. Navigation Requests (HTML / Page Entry)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          console.log('[SW] Offline detected: Serving cached HTML entrypoint for navigation');
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;
          const fallback = await caches.match('/');
          if (fallback) return fallback;
          return caches.match('/index.html');
        })
    );
    return;
  }

  // 2. API calls (/api/*)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Cache successful GET API responses if needed
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(async () => {
          // Check if there is a cached response
          const cachedResponse = await caches.match(request);
          if (cachedResponse) return cachedResponse;

          // Provide offline graceful JSON response
          return new Response(
            JSON.stringify({
              success: false,
              offline: true,
              message: 'Conexión a internet no disponible. Modo sin conexión activo en Commander AI Studio.',
              timestamp: new Date().toISOString()
            }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 503,
              statusText: 'Service Unavailable (Offline)'
            }
          );
        })
    );
    return;
  }

  // 3. Static Assets: JS, CSS, SVG, Images, Fonts (Stale-While-Revalidate)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch((err) => {
          // If offline and not in cache, fallback
          if (!cachedResponse) {
            console.warn('[SW] Offline and asset not in cache:', request.url);
          }
          return cachedResponse;
        });

      // Return cached asset immediately if present, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
