const CACHE = 'offline-notes-v1';
const ASSETS = [
  '/', '/index.html', '/style.css', '/app.js',
  '/offline.html', '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Network first for API calls; Cache first for assets
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ ok:false, offline:true }), { headers:{'Content-Type':'application/json'} }))
    );
  } else {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
        return res;
      }).catch(() => caches.match('/offline.html')))
    );
  }
});
