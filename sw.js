const CACHE_NAME = 'housekeeper-v1';

// FIXED: Removed the './' and slashes entirely so assets load correctly 
// no matter if the app is run locally or on a GitHub subfolder path!
const ASSETS_TO_CACHE = [
  '/',
  'index.html',
  'style.css',
  'app.js',
  'manifest.json'
];
// Keep the rest of your sw.js file exactly the same!


// Install Service Worker and cache essential project files robustly
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Worker and clear old caches if files change
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => {
      if (key !== CACHE_NAME) return caches.delete(key);
      return Promise.resolve();
    }));
    await self.clients.claim();
    console.log('[SW] Activated and claimed clients.');
  })());
});

// Intercept network requests to serve assets from cache if available, fallback to network
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) {
      return cached;
    }

    try {
      const networkResponse = await fetch(event.request);
      // Optionally cache new GET requests here if you want runtime caching
      return networkResponse;
    } catch (err) {
      console.warn('[SW] Fetch failed for', event.request.url, err);
      // If fetch fails, return a fallback (could be offline page or nothing)
      return new Response('Network error', { status: 408, statusText: 'Network error' });
    }
  })());
});
