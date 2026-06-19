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

// ?nv=1|2|3 → メディア領域(#media)の星雲ティント濃さ。1=控えめ/2=しっかり/3=鮮やか(既定)。
// 値は --neb-a(青)/--neb-b(紫) の rgba。main.js が :root に setProperty して適用する。
// 既定=3（ユーザー採用・実物比較で確定）。今後のデザイン監修で全体バランスを再調整予定。
const NEB_VIVID = {
  1: { a: 'rgba(46,111,179,0.12)', b: 'rgba(138,92,246,0.08)' },
  2: { a: 'rgba(58,150,235,0.26)', b: 'rgba(150,100,255,0.20)' },
  3: { a: 'rgba(70,175,255,0.42)', b: 'rgba(170,115,255,0.34)' },
};
export function immerseNeb(search) {
  const m = /[?&]nv=([123])/.exec(readSearch(search));
  return NEB_VIVID[m ? m[1] : 3];
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
