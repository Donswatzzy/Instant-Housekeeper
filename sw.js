const CACHE_NAME = 'housekeeper-v3'; // Incremented from v2 to force a hard update
const ASSETS = [
  '/',
  'style.css',
  'app.js',
  'manifest.json'
];
// Keep the rest of your sw.js file exactly the same!


// Install Service Worker and cache essential project files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Worker and clear old caches if files change
self.addEventListener('activate', (event) => {
  event.waitUntil(self.skipWaiting());
});

// Intercept network requests to serve assets from cache if offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
