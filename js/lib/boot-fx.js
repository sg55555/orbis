// js/lib/boot-fx.js — 起動画面の DOM 非依存な純粋関数（feed 定義・タイミング・ease・正射影・handoff）。
// node ユニットテストから直接 import する。canvas/DOM はここに置かない。

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
export function ease(t, a, b) { return smooth((t - a) / (b - a)); }

function readSearch(search) {
  return typeof search === 'string'
    ? search
    : (typeof location !== 'undefined' ? location.search : '');
}

// ?boot=1|2|3|12（既定 12）。
export function currentBootVariant(search) {
  const m = /[?&]boot=(12|1|2|3)\b/.exec(readSearch(search) || '');
  return m ? m[1] : '12';
}

// ?bootmin=<ms>（既定 2400・0 以上の整数のみ採用）。
export function bootMinMs(search) {
  const m = /[?&]bootmin=(\d+)\b/.exec(readSearch(search) || '');
  return m ? Number(m[1]) : 2400;
}

// ?bv=a|b（起動画面チューニング版。a=原案 / b=新案・既定）。実物比較用 A/B。
export function bootVersion(search) {
  const m = /[?&]bv=([ab])\b/i.exec(readSearch(search) || '');
  return m ? m[1].toLowerCase() : 'b';
}

// variant → テレメトリ feed 定義（[表示名, 状態語]）。2=full(7)、その他=slim(5)。
const FEEDS_FULL = [
  ['地震 USGS', '接続'], ['航空 ADS-B', '同期'], ['紛争・抗議 GDELT', '受信'],
  ['気温・水温 Open-Meteo', '取得'], ['船舶 AISStream', '接続'],
  ['海流・貿易ルート', '読込'], ['ニュース 翻訳', '起動'],
];
const FEEDS_SLIM = [
  ['地震網', ''], ['航空 ADS-B', ''], ['GDELT 紛争/抗議', ''], ['気象 全球', ''], ['ニュース', ''],
];
export function bootFeeds(variant) {
  return (variant === '2' ? FEEDS_FULL : FEEDS_SLIM).map((f) => f.slice());
}

// handoff ゲーティング：最小表示まで残り何 ms 保持するか（経過が min 以上なら 0）。
export function remainingHold(elapsedMs, minMs) { return Math.max(0, minMs - elapsedMs); }

// 進捗 0..1（total<=0 は 0）。
export function progressFor(done, total) { return total <= 0 ? 0 : clamp(done / total, 0, 1); }

// 正射影（球を正面から）。rot=経度回転, tilt=軸傾き。返り値 z>0 が前面（可視）。
export function project(latDeg, lonDeg, rot, tilt, R, cx, cy) {
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180 + rot;
  const x = Math.cos(la) * Math.sin(lo);
  const y = Math.sin(la);
  const z = Math.cos(la) * Math.cos(lo);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const y2 = y * ct - z * st;
  const z2 = y * st + z * ct;
  return { x: cx + R * x, y: cy - R * y2, z: z2 };
}
