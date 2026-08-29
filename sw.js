const CACHE_NAME = 'housekeeper-v1';

// Use relative paths so caching works correctly when served from a GitHub Pages project subpath
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

// Install Service Worker and cache essential project files robustly
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const failed = [];

    // Fetch and cache assets individually so a single missing file does not fail the whole install
    for (const asset of ASSETS_TO_CACHE) {
      try {
        // Use no-store so we exercise network and catch 404/network errors clearly
        const response = await fetch(asset, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Network response was not ok (${response.status})`);
        await cache.put(asset, response.clone());
        // Debug log so you can see progress in DevTools Console
        console.log(`[SW] Cached: ${asset}`);
      } catch (err) {
        console.warn(`[SW] Failed to cache ${asset}:`, err);
        failed.push({ asset, error: String(err) });
      }
    }

    if (failed.length > 0) {
      // Keep a non-fatal warning so install completes even when optional assets are missing.
      // You will see which assets failed in the console.
      console.warn('[SW] Some assets failed to cache during install', failed);
    }

    // Take control immediately after install
    await self.skipWaiting();
  })());
});

// Activate Worker: clean up any old caches and claim clients
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
