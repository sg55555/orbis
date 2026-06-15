// 気温レイヤー。Open-Meteo の全球 5° グリッド温度(grid+temps)を補間して温度カラーの面を描く。
// 描画: 既定は deck.gl BitmapLayer（全球テクスチャ）。globe で破綻する場合は SolidPolygon 格子に
// フォールバック（実物検証で確定。IconLayer が globe 全滅した前例を踏まえた姿勢）。

const TMIN = -40, TMAX = 40;
// 寒色→暖色（青→シアン→緑→黄→橙→赤）。気温図風の連続グラデ。
const STOPS = [
  [0.0, [40, 90, 200]], [0.2, [42, 150, 255]], [0.4, [30, 220, 210]],
  [0.55, [110, 230, 120]], [0.7, [255, 230, 90]], [0.85, [255, 160, 60]], [1.0, [255, 70, 55]],
];

// stops（[[t,[r,g,b]],...]）上で t を線形補間（クランプ）。純粋・自己完結。
function lerpStops(stops, t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i][0] && x <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = b[0] - a[0] || 1;
  const k = (x - a[0]) / span;
  return [0, 1, 2].map((j) => Math.round(a[1][j] + (b[1][j] - a[1][j]) * k));
}

// 摂氏温度 → [r,g,b]（-40..40 を 0..1 に正規化してクランプ）。
export function tempToColor(tempC) {
  return lerpStops(STOPS, (tempC - TMIN) / (TMAX - TMIN));
}

function cell(temps, nLon, i, j) { return temps[i * nLon + j]; }

// (lat,lon) をグリッド上で双線形補間。周囲4セルに null があれば非null近傍へフォールバック、全 null は null。
function bilinear(grid, temps, lat, lon) {
  const { lat0, lon0, latStep, lonStep, nLat, nLon } = grid;
  let fi = Math.max(0, Math.min(nLat - 1, (lat - lat0) / latStep));
  let fj = Math.max(0, Math.min(nLon - 1, (lon - lon0) / lonStep));
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const i1 = Math.min(nLat - 1, i0 + 1), j1 = Math.min(nLon - 1, j0 + 1);
  const di = fi - i0, dj = fj - j0;
  const c00 = cell(temps, nLon, i0, j0), c01 = cell(temps, nLon, i0, j1);
  const c10 = cell(temps, nLon, i1, j0), c11 = cell(temps, nLon, i1, j1);
  if ([c00, c01, c10, c11].some((v) => v == null)) {
    const ok = [c00, c01, c10, c11].filter((v) => v != null);
    return ok.length ? ok[0] : null;
  }
  const top = c00 + (c01 - c00) * dj;
  const bot = c10 + (c11 - c10) * dj;
  return top + (bot - top) * di;
}

// グリッドを w×h ピクセルへ補間し、温度カラーの RGBA 配列を返す（BitmapLayer の ImageData 元）。
// 画像 row 0 = 北(lat=+90)。null セルは透明(alpha=0)。
export function buildTempField(snapshot, w, h) {
  const { grid, temps } = snapshot;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    const lat = 90 - (py + 0.5) * (180 / h);
    for (let px = 0; px < w; px++) {
      const lon = -180 + (px + 0.5) * (360 / w);
      const t = bilinear(grid, temps, lat, lon);
      const idx = (py * w + px) * 4;
      if (t == null) { out[idx + 3] = 0; continue; }
      const [r, g, b] = tempToColor(t);
      out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = 255;
    }
  }
  return out;
}

// 緯度経度に最も近いグリッドセルの温度を返す（ホバー用）。範囲外/欠損は null。
export function tempAt(snapshot, lat, lon) {
  if (!snapshot || !snapshot.grid || !snapshot.temps) return null;
  const { lat0, lon0, latStep, lonStep, nLat, nLon } = snapshot.grid;
  const i = Math.round((lat - lat0) / latStep);
  const j = Math.round((lon - lon0) / lonStep);
  if (i < 0 || i >= nLat || j < 0 || j >= nLon) return null;
  const v = snapshot.temps[i * nLon + j];
  return v == null ? null : v;
}

const FIELD_W = 360, FIELD_H = 180;   // 5°グリッド(72x35)を1°相当へ補間
let _bmp = { ts: null, image: null };

// snapshot.updated ごとに温度カラーの canvas を一度だけ生成してキャッシュ（再描画時の負荷を抑える）。
function fieldImage(snapshot) {
  if (_bmp.ts === snapshot.updated && _bmp.image) return _bmp.image;
  const data = buildTempField(snapshot, FIELD_W, FIELD_H);
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(FIELD_W, FIELD_H)
    : Object.assign(document.createElement('canvas'), { width: FIELD_W, height: FIELD_H });
  canvas.getContext('2d').putImageData(new ImageData(data, FIELD_W, FIELD_H), 0, 0);
  _bmp = { ts: snapshot.updated, image: canvas };
  return canvas;
}

export const airtempLayer = {
  id: 'airtemp',
  label: '気温',
  marker: 'gradient',
  legend: [
    { color: 'rgb(42,150,255)', label: '寒い' },
    { color: 'rgb(110,230,120)', label: '0°C 付近' },
    { color: 'rgb(255,70,55)', label: '暑い' },
  ],
  toDeckLayer(snapshot, _ctx) {
    if (!snapshot || !snapshot.grid || !snapshot.temps) return [];
    return [new deck.BitmapLayer({
      id: 'airtemp',
      image: fieldImage(snapshot),
      bounds: [-180, -90, 180, 90],
      opacity: 0.45,
      pickable: true,
    })];
  },
  // ツールチップは BitmapLayer のピック object に座標が無いため、main.js が info.coordinate + tempAt で生成。
  tooltip() { return null; },
  toFeedItems() { return []; },
};
