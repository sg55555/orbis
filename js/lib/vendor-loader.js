// deck.gl の重い分割 UMD を「使う時だけ」読む遅延ローダ（設計 §3.2 / A2）。
// 起動時に読むのは core→layers→mapbox の 238KB gzip だけ。TripsLayer（貿易フロー）は
// @deck.gl/geo-layers にあり、geo-layers 単体では `Class extends value undefined` で死ぬので
// mesh-layers → geo-layers の順に 1 本ずつ（前の onload を待って）注入する（2026-09-03 Chromium 実測）。
// UMD は window.deck にマージされるので、読み終われば deck.TripsLayer がそのまま生える。

export const LAZY_VENDOR = [
  'vendor/deck.gl-mesh-layers-9.3.4.min.js',
  'vendor/deck.gl-geo-layers-9.3.4.min.js',
];

// 進行中/完了済みのロードをモジュール内に 1 つだけ保持する（rAF から毎フレーム呼ばれても 1 回）。
let _pending = null;

function loadScript(doc, src) {
  return new Promise((resolve, reject) => {
    const el = doc.createElement('script');
    el.src = src;
    el.async = false; // 実行順を保つ（1 本ずつ待つので実際には効かないが意図を残す）
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`vendor script load failed: ${src}`));
    doc.head.appendChild(el);
  });
}

// doc/root は差し替え可能（テストは fake document と fake globalThis を渡す）。
export function ensureTripsLayer({ doc = document, root = globalThis } = {}) {
  if (root && root.deck && typeof root.deck.TripsLayer === 'function') return Promise.resolve();
  if (_pending) return _pending;
  _pending = LAZY_VENDOR
    .reduce((chain, src) => chain.then(() => loadScript(doc, src)), Promise.resolve())
    .catch((err) => { _pending = null; throw err; }); // 失敗は握らない＝呼び出し側で再試行できる
  return _pending;
}

// テスト用。モジュール内に持つ Promise を捨てて初期状態へ戻す。
export function _resetVendorLoaderForTests() {
  _pending = null;
}
