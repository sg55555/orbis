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

export function formatAgeSec(diffSec) {
  diffSec = Math.max(0, Math.floor(diffSec));
  if (diffSec < 60) return 'たった今';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  return `${Math.floor(diffSec / 86400)}日前`;
}

export function formatFreshness(updatedIso, now = Date.now()) {
  return formatAgeSec((now - Date.parse(updatedIso)) / 1000);
}

// 鮮度サマリ（純粋）。items=[{label, updated(iso)}] の全層から「N層 · 最新 X」を作り、
// staleSec(既定6h)を超えた層は古い順に名指しで ⚠ 付記する（沈黙の陳腐化を可視化）。
export function freshnessSummary(items, now = Date.now(), staleSec = 21600) {
  if (!items || items.length === 0) return { text: 'データ取得中…', stale: false };
  const withAge = items.map((it) => ({
    label: it.label,
    age: Math.max(0, Math.floor((now - Date.parse(it.updated)) / 1000)),
  }));
  const freshest = Math.min(...withAge.map((a) => a.age));
  const stale = withAge.filter((a) => a.age > staleSec).sort((a, b) => b.age - a.age);
  let text = `${withAge.length}層 · 最新 ${formatAgeSec(freshest)}`;
  if (stale.length) {
    text += ' · ⚠ ' + stale.map((a) => `${a.label} ${formatAgeSec(a.age)}`).join(' ');
  }
  return { text, stale: stale.length > 0 };
}

// 緯度経度を地理慣例の和文ラベルへ（純粋）。北緯/南緯・東経/西経で符号を明示し、
// 「| の右が座標」と一目で分かるようにする。経度は globe のラップ対策で [-180,180) に正規化。
export function formatLatLon(lat, lon) {
  const L = ((lon % 360) + 540) % 360 - 180;
  const la = `${lat >= 0 ? '北緯' : '南緯'}${Math.abs(Math.round(lat))}°`;
  const lo = `${L >= 0 ? '東経' : '西経'}${Math.abs(Math.round(L))}°`;
  return `${la} ${lo}`;
}

// 方位（北0°時計回り）を deck.gl IconLayer の角度（反時計回り）へ変換。
export function iconAngle(headingDeg) {
  const h = Number(headingDeg) || 0;
  return ((360 - (h % 360)) % 360);
}

// 画面上で約 targetPx ピクセルに見える地理度長を、現在ズームから求める。
// 赤道 metersPerPixel ≈ 156543.03 / 2^zoom、1度 ≈ 111320m。
export function degLenForZoom(zoom, targetPx = 7) {
  const mpp = 156543.03 / Math.pow(2, zoom);
  return (targetPx * mpp) / 111320;
}

// (lon,lat) から headingDeg(北0°時計回り)方向へ speedMps(m/s) で minutes 分進んだ推定点 [lon,lat]。
// 欠損/非有限/速度<=0 は null。経度は cosLat 補正（高緯度の度詰まりを補正）。
export function projectAhead(lon, lat, headingDeg, speedMps, minutes) {
  if (lon == null || lat == null || headingDeg == null || speedMps == null) return null;
  const h = Number(headingDeg), v = Number(speedMps);
  if (!Number.isFinite(h) || !Number.isFinite(v) || v <= 0) return null;
  const degLat = (v * minutes * 60) / 111320;
  const rad = (h * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  return [lon + (degLat * Math.sin(rad)) / cosLat, lat + degLat * Math.cos(rad)];
}

// 航空: 現在の heading(度)＋velocity(m/s) から minutes 分後の推定到達点。
// OpenSky は目的地を持たないため「推定」。欠損/速度0で null。
export function projectedArrival(p, minutes = 10) {
  if (!p) return null;
  return projectAhead(p.lon, p.lat, p.heading, p.velocity, minutes);
}

// 船舶: AIS の cog(針路・度)＋sog(ノット) から minutes 分後の推定到達点（kn→m/s = ×0.514444）。
// cog/sog 欠損・sog0 で null。
export function shipArrival(p, minutes = 60) {
  if (!p) return null;
  const sog = p.sog == null ? null : Number(p.sog) * 0.514444;
  return projectAhead(p.lon, p.lat, p.cog, sog, minutes);
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

// 進行方向(headingDeg, 北0°時計回り)に向けたローカル多角形を地理座標へ変換する（純粋）。
// verts: [[forward, side], ...]（forward=前方+, side=右+、単位は degLen 基準）。
// flights 三角形と同じ fwd/perp/L 基底を用い、高緯度でも画素一定の向き付き形状を作る。
export function silhouettePolygon(lon, lat, headingDeg, degLen, verts) {
  if (lon == null || lat == null || headingDeg == null || !Array.isArray(verts)) return null;
  const h = Number(headingDeg);
  if (!Number.isFinite(h)) return null;
  const rad = (h * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const fwd = [Math.sin(rad) / cosLat, Math.cos(rad)];
  const perp = [Math.cos(rad) / cosLat, -Math.sin(rad)];
  const L = degLen * cosLat;
  return verts.map(([f, s]) => [
    lon + (fwd[0] * f + perp[0] * s) * L,
    lat + (fwd[1] * f + perp[1] * s) * L,
  ]);
}
