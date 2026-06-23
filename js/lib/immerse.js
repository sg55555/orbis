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

// ?mp=a|b|off（大小無視）。下部メディア＋ブリーフィング帯(#media/#ai-brief)の視覚仕上げ。
// a=大気グロー(既定・採用)／b=ネオン強め／off=現状(before・base CSS のまま)。
// プレーヤー/カメラセルを「黒い穴」→「縁に光が乗ったガラス」にし、nv tint を縁で活かす。
export function immerseMediaPolish(search) {
  const m = /[?&]mp=(off|a|b)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'a';
}

// ?ui=a|b|off（大小無視）。本編UI(左レイヤーパネル/右フィード＋共有のタイポ/ボタン)のリッチ化。
// a=大気グラス・リッチ(既定・推奨)／b=計器/オブザバトリ(密度高め)／off=現状(before・base CSS のまま)。
export function immerseUi(search) {
  const m = /[?&]ui=(off|a|b)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'a';
}

// ?font=on|off（大小無視）。タイトル/見出し/ワードマークに宇宙・監視系の display フォント
// (Orbitron=ワードマーク / Saira=見出し)を適用。既定 on。off は system-ui のまま。
export function immerseFont(search) {
  const m = /[?&]font=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}

// ?sec=on|off（大小無視）。下部セクション(#media/#ai-brief/#instability)の section 構造リッチ化。
// on=共通幅に揃え＋統一セクション見出し＋オーロラ区切り＋メディアボタン統一＋スクロール演出（既定）。
// off=現状(before・base CSS のまま)。
export function immerseSec(search) {
  const m = /[?&]sec=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}

// ?legend=on|off（大小無視）。globe 隅の常設「凡例＋使い方」オーバーレイの表示。既定 on。
// off は before 比較用（body.legend-off で #legend を隠す）。
export function immerseLegend(search) {
  const m = /[?&]legend=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}

// ?search=on|off（大小無視）。globe 上部中央の国検索ボックスの表示。既定 on。
// off は before 比較用（body.search-off で #search を隠す）。
export function immerseSearch(search) {
  const m = /[?&]search=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}

// ?feed=on|off（大小無視）。右イベントフィードの可読性レイヤー。on=タイトルを最大2行で
// 折返し（長いニュース/地震行のみ2行・短い group 行は1行維持＝密度キープ）＋2行化に伴い
// ドット/時刻/件数を上端揃え（既定）。off=現状(before・幅260pxで1行省略 ellipsis のまま)。
export function immerseFeed(search) {
  const m = /[?&]feed=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}

// ?space=1|2|3|off（大小無視）。大画面 globe 周辺リッチ化（星密度/微粒子/周辺光）の強さ段。
// 既定 off＝採用しない（2026-06-21 太田さん実機確定：周辺光が panel グラス越しに四角く滲む＝
// 星雲面廃止と同じ問題。星密度/微粒子も四角い範囲内にしか効かず独立価値なし）。1|2|3 は比較用に残置。
export function immerseSpace(search) {
  const m = /[?&]space=(1|2|3|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'off';
}

// ?mui=a|b|off（大小無視）。モバイル(≤768px)の操作UIシェル（下端タブバー＋ボトムシート＋ディマー）の
// リッチ化。b=採用(既定・2026-06-24 太田さん実機確定)／a=一段控えめ(比較用)／off=before(base のまま・タブは ≡)。
export function immerseMobileUi(search) {
  const m = /[?&]mui=(a|b|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'b';
}

// body に付与する CSS クラス配列（純粋）。seam は常に付与(既定a)、mbg は deep のみ、glass は !=on のみ、
// mp(メディア仕上げ)/ui(本編リッチ化)は常に付与(既定a)、font(display フォント)/sec(セクション構造)も常に付与(既定on)、
// space(大画面 globe 周辺演出)も常に付与(既定off＝不採用・1|2|3は比較用)。
export function immerseClasses(search) {
  const out = [];
  out.push('seam-' + immerseSeam(search));
  if (immerseMediaBg(search) === 'deep') out.push('mbg-deep');
  const glass = immerseGlass(search);
  if (glass !== 'on') out.push('glass-' + glass);
  out.push('mp-' + immerseMediaPolish(search));
  out.push('ui-' + immerseUi(search));
  out.push('font-' + immerseFont(search));
  out.push('sec-' + immerseSec(search));
  out.push('legend-' + immerseLegend(search));
  out.push('search-' + immerseSearch(search));
  out.push('feed-' + immerseFeed(search));
  out.push('space-' + immerseSpace(search));
  out.push('mui-' + immerseMobileUi(search));
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
