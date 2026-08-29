const CACHE_NAME = 'housekeeper-v1';

// Use relative paths so caching works correctly when served from a GitHub Pages project subpath
// (e.g. https://username.github.io/RepoName/). Absolute leading-slash paths point to the site root
// and will 404 when the app is hosted under a subpath.
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// Install Service Worker and cache essential project files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Worker and take control
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Intercept network requests to serve assets from cache if available
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request);
    })
  );
});
