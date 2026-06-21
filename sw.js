// ORBIS Service Worker — シェルはネットワーク優先（更新を常に即反映）。データJSONも常にネット。
const CACHE = 'orbis-v42';
const SHELL = ['/', '/index.html', '/css/orbis.css', '/js/main.js', '/js/lib/presets.js'];

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
  if (url.hostname === 'raw.githubusercontent.com' || url.pathname.includes('/data/snapshots/') || url.hostname.includes('cartocdn')) return;
  // シェル/コードはネットワーク優先：常に最新を取得し成功時にキャッシュ更新、
  // ネット失敗（オフライン）時のみキャッシュへフォールバック（PWA のオフライン起動を維持）。
  // これにより index.html/main.js/css の更新が「古い SW が居座って反映されない」問題を根絶する。
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
