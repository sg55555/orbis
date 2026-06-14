// 地図描画用の純粋ヘルパ（ブラウザ・Node 双方で import 可能な ESM）。

export function magnitudeToRadius(mag) {
  const m = Number(mag) || 0;
  return Math.round(Math.max(3, Math.pow(m, 1.8)));
}

export function magnitudeToColor(mag) {
  const m = Number(mag) || 0;
  if (m < 2) return [57, 208, 255];    // cyan
  if (m < 4) return [94, 255, 166];    // green
  if (m < 6) return [255, 176, 40];    // amber
  return [255, 60, 80];                // red
}

export function formatFreshness(updatedIso, now = Date.now()) {
  const diffSec = Math.max(0, Math.floor((now - Date.parse(updatedIso)) / 1000));
  if (diffSec < 60) return 'たった今';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  return `${Math.floor(diffSec / 86400)}日前`;
}

// 方位（北0°時計回り）を deck.gl IconLayer の角度（反時計回り）へ変換。
export function iconAngle(headingDeg) {
  const h = Number(headingDeg) || 0;
  return ((360 - (h % 360)) % 360);
}

// 画面上で約 targetPx ピクセルに見える地理度長を、現在ズームから求める。
// 赤道 metersPerPixel ≈ 156543.03 / 2^zoom、1度 ≈ 111320m。
export function degLenForZoom(zoom, targetPx = 10) {
  const mpp = 156543.03 / Math.pow(2, zoom);
  return (targetPx * mpp) / 111320;
}

// イベントの言及数から描画半径(px)。floor 5, 上限 18。
export function eventRadius(mentions) {
  const m = Number(mentions) || 0;
  return Math.min(18, Math.round(5 + Math.sqrt(m)));
}

// ヒート風ブロブの半径(px)。言及数が多いほど大きい円を重ね、加算合成で「面」を作る。
// log スケールで 12〜52px に収める（密集地でも巨大化しすぎない）。
export function blobRadius(mentions) {
  const m = Number(mentions) || 1;
  return Math.round(12 + Math.min(40, Math.log10(m + 1) * 26));
}

// deck.gl(luma.gl v9) の加算合成パラメータ。半透明の円が重なるほど明るく発色する。
// HeatmapLayer(globe非対応)の代替として ScatterplotLayer に適用する。
export const ADDITIVE_BLEND = {
  blend: true,
  blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one',
};

// URL からドメインを抽出（www. 除去）。失敗時は空文字。
export function hostnameOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
