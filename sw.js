// ORBIS Service Worker — シェルはネットワーク優先（更新を常に即反映）。データJSONも常にネット。
const CACHE = 'orbis-v52';
// '/index.html' は vercel.json routes が 308 → '/' に飛ばすので入れない
// （addAll は redirect 応答で失敗し、install ごと落ちる）。
const SHELL = ['/', '/css/orbis.css', '/js/main.js', '/js/lib/presets.js'];

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
  // 別オリジン（タイル・raw データ・YouTube・サムネ）は SW が中継しない。
  // 中継すると SW 自身の応答に載る CSP（connect-src 'self' …）で判定されてしまい、
  // ページ側の緩い img-src が届かない。素通しならブラウザが HTTP キャッシュで扱う。
  // respondWith() を呼ばず return すると、ブラウザが既定のネットワーク取得を行う。
  if (url.origin !== self.location.origin) return;
  // ローカル開発の生スナップショットは常にネットワーク（鮮度優先）。
  if (url.pathname.startsWith('/data/snapshots/')) return;
  // シェル/コードはネットワーク優先：常に最新を取得し成功時にキャッシュ更新、
  // ネット失敗（オフライン）時のみキャッシュへフォールバック（PWA のオフライン起動を維持）。
  // 失敗応答（404/500）や opaque 応答まで put すると壊れた応答が固定化するので、
  // res.ok && res.type === 'basic' の時だけ保存する。
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
