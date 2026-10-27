// Keeps the Dead Letter Office's own files on this device so it opens with the internet off.
// The model files are cached separately by Transformers.js (Cache API).
const VERSION = 'dlo-v3';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/netwatch.js',
  './js/ghost-worker.js',
  './vendor/transformers.min.js',
  './vendor/ort-wasm-simd-threaded.asyncify.mjs',
  './vendor/ort-wasm-simd-threaded.asyncify.wasm',
  './fonts/libre-caslon-display-latin-400-normal.woff2',
  './fonts/libre-caslon-text-latin-400-normal.woff2',
  './fonts/libre-caslon-text-latin-400-italic.woff2',
  './fonts/libre-caslon-text-latin-700-normal.woff2',
  './fonts/courier-prime-latin-400-normal.woff2',
  './fonts/courier-prime-latin-700-normal.woff2',
  './fonts/frank-ruhl-libre-hebrew-400-normal.woff2',
  './fonts/frank-ruhl-libre-hebrew-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('dlo-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // not ours
  const save = (res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  };
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/fonts/')) {
    // Big, versioned library files: use the saved copy first.
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then(save)));
  } else {
    // The app itself: get the newest version when online, the saved copy when offline.
    // Skip the browser's HTTP cache so a new release shows up right away.
    const fresh = e.request.mode === 'navigate' ? e.request : new Request(e.request, { cache: 'no-cache' });
    e.respondWith(fetch(fresh).then(save).catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});
