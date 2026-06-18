// ORBIS Service Worker — シェルをキャッシュ。データJSONは常にネットワーク優先。
const CACHE = 'orbis-v29';
const SHELL = ['/', '/index.html', '/css/orbis.css', '/js/main.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // データ・タイルは常にネットワーク（鮮度優先）。
  // e.respondWith() を呼ばず return すると、ブラウザが既定のネットワーク取得を行う（キャッシュしない）。
  if (url.pathname.includes('/data/snapshots/') || url.hostname.includes('cartocdn')) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
