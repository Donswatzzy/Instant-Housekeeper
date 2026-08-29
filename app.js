// ==========================================
// 7. PWA SERVICE WORKER REGISTRATION
// ==========================================
// Temporarily disabled service worker registration while we iterate on SW fixes.
// To re-enable, remove the comment markers around the navigator.serviceWorker.register block.
/*
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js') 
      .then(reg => console.log('Service Worker registered successfully!', reg.scope))
      .catch(err => console.log('Service Worker registration failed:', err));
  });
};
*/

// ==========================================
// 8. INTER-TAB REAL-TIME LIVE SYNC ENGINE
// ==========================================
