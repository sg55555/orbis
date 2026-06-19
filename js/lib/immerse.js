// デスクトップ没入感のダイヤル。既定値は実物比較で確定した本番値で、?gz/glow/seam/mbg/glass
// で下げ方向に上書きできる（look.js と同じ思想）。?compare=1 で比較ツールバーを表示する。
// 採用＝globe を主役に拡大(zoom 2.7)・大気ハロ主役(glow2)・境界は大気溶け込み(seam a)・
//       media 背景は深宇宙(deep)・星雲(面)は廃止。

// 画面占有率の目安(55/70/85%) → zoom 値。未指定/無効は既定(85% 相当)。
const GZ_ZOOM = { 55: 1.7, 70: 2.2, 85: 2.7 };
export const DEFAULT_ZOOM = 2.7; // 確定: globe を画面の主役に（ユーザーは自分でズームアウト可能）

function readSearch(search) {
  return typeof search === 'string'
    ? search
    : (typeof location !== 'undefined' ? location.search : '');
}

// ?gz=55|70|85 → zoom 値。未指定/未定義段階/非数値は既定。
export function immerseZoom(search) {
  const m = /[?&]gz=(\d{2})/.exec(readSearch(search));
  if (!m) return DEFAULT_ZOOM;
  const z = GZ_ZOOM[m[1]];
  return typeof z === 'number' ? z : DEFAULT_ZOOM;
}

// ?seam=a|b|c（大小無視）。未指定/無効は既定 a（大気溶け込み）。
export function immerseSeam(search) {
  const m = /[?&]seam=([abcABC])/.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'a';
}

// ?glow=1|2|3。未指定/無効は既定 2（大気ハロ）。
export function immerseGlow(search) {
  const m = /[?&]glow=([123])/.exec(readSearch(search));
  return m ? Number(m[1]) : 2;
}

// ?mbg=black|deep（大小無視）。未指定/無効は既定 deep（深宇宙）。
export function immerseMediaBg(search) {
  const m = /[?&]mbg=(black|deep)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'deep';
}

// body に付与する CSS クラス配列（純粋）。seam は常に付与(既定a)、mbg は deep のみ、glass は !=on のみ。
export function immerseClasses(search) {
  const out = [];
  out.push('seam-' + immerseSeam(search));
  if (immerseMediaBg(search) === 'deep') out.push('mbg-deep');
  const glass = immerseGlass(search);
  if (glass !== 'on') out.push('glass-' + glass);
  return out;
}

// glow レベル → MapLibre atmosphere-blend の補間ストップ [zoom,value,...]。
// 大きいほど強く（zoom0 の値↑）かつ広く（減衰開始 zoom を遅らせ、近接でも大気を残す）。
const ATMO_STOPS = {
  1: [0, 0.55, 4, 0.28, 7, 0],
  2: [0, 0.85, 6, 0.45, 9, 0],
  3: [0, 1.0, 10, 0.6, 14, 0],
};
export function atmosphereStops(level) { return (ATMO_STOPS[level] || ATMO_STOPS[1]).slice(); }

// 比較プロトタイプモードか（?compare=1）。比較中は SW を無効化してキャッシュ不整合を避ける。
export function isCompareMode(search) {
  return /[?&]compare=1\b/.test(readSearch(search));
}

// ?glass=on|soft|off（大小無視）。panel/feed のすりガラス(blur)の強さ。未指定/無効は on(既定)。
export function immerseGlass(search) {
  const m = /[?&]glass=(on|soft|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}
