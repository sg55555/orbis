// 水温(SST)レイヤー。Open-Meteo Marine の全球 5° グリッド SST(grid+temps)を補間して
// 連続カラーの面を描く。陸/欠損は透明。描画は deck.gl BitmapLayer（全球テクスチャ）。
// 海流(currents)レイヤーと色を区別するため、緑を含まない青→白→赤の系統を既定にする。
// パレットと温度レンジは実アプリ(?sstmap=)で比較確定する。

const SMIN = -2, SMAX = 32;   // 海洋SSTの実域（実アプリで微調整可）

// カラーマップ候補。?sstmap=div|thermal で実物比較（既定 div）。
const PALETTES = {
  // 青→白→赤のダイバージング（緑なし・白い中点。海流の青→緑→赤と分離）。
  div: [
    [0.0, [30, 60, 170]], [0.25, [60, 140, 230]], [0.5, [235, 240, 245]],
    [0.75, [240, 150, 70]], [1.0, [200, 30, 30]],
  ],
  // 深紫→赤→黄（magma 風の代替）。
  thermal: [
    [0.0, [20, 20, 80]], [0.3, [120, 30, 120]], [0.55, [210, 60, 80]],
    [0.78, [240, 140, 40]], [1.0, [250, 235, 150]],
  ],
};
const SSTMAP = (typeof location !== 'undefined'
  && (/[?&]sstmap=(div|thermal)/i.exec(location.search) || [])[1] || 'div').toLowerCase();
const STOPS = PALETTES[SSTMAP] || PALETTES.div;

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

// 摂氏水温 → [r,g,b]（SMIN..SMAX を 0..1 に正規化してクランプ）。
export function sstToColor(tempC) {
  return lerpStops(STOPS, (tempC - SMIN) / (SMAX - SMIN));
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

// グリッドを w×h ピクセルへ補間し、水温カラーの RGBA 配列を返す（BitmapLayer の ImageData 元）。
// 画像 row 0 = 北(lat=+90)。陸/欠損セルは透明(alpha=0)。
export function buildSstField(snapshot, w, h) {
  const { grid, temps } = snapshot;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    const lat = 90 - (py + 0.5) * (180 / h);
    for (let px = 0; px < w; px++) {
      const lon = -180 + (px + 0.5) * (360 / w);
      const t = bilinear(grid, temps, lat, lon);
      const idx = (py * w + px) * 4;
      if (t == null) { out[idx + 3] = 0; continue; }
      const [r, g, b] = sstToColor(t);
      out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = 255;
    }
  }
  return out;
}

// 緯度経度に最も近いグリッドセルの水温を返す（ホバー用）。範囲外/陸(null)は null。
export function sstAt(snapshot, lat, lon) {
  if (!snapshot || !snapshot.grid || !snapshot.temps) return null;
  const { lat0, lon0, latStep, lonStep, nLat, nLon } = snapshot.grid;
  const i = Math.round((lat - lat0) / latStep);
  const j = Math.round((lon - lon0) / lonStep);
  if (i < 0 || i >= nLat || j < 0 || j >= nLon) return null;
  const v = snapshot.temps[i * nLon + j];
  return v == null ? null : v;
}

const FIELD_W = 360, FIELD_H = 180;
let _bmp = { ts: null, image: null };

function fieldImage(snapshot) {
  if (_bmp.ts === snapshot.updated && _bmp.image) return _bmp.image;
  const data = buildSstField(snapshot, FIELD_W, FIELD_H);
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(FIELD_W, FIELD_H)
    : Object.assign(document.createElement('canvas'), { width: FIELD_W, height: FIELD_H });
  canvas.getContext('2d').putImageData(new ImageData(data, FIELD_W, FIELD_H), 0, 0);
  _bmp = { ts: snapshot.updated, image: canvas };
  return canvas;
}

export const sstLayer = {
  id: 'sst',
  label: '水温',
  marker: 'gradient',
  legend: [
    { color: 'rgb(60,140,230)', label: '冷たい' },
    { color: 'rgb(235,240,245)', label: '中間' },
    { color: 'rgb(200,30,30)', label: '暖かい' },
  ],
  toDeckLayer(snapshot, _ctx) {
    if (!snapshot || !snapshot.grid || !snapshot.temps) return [];
    return [new deck.BitmapLayer({
      id: 'sst',
      image: fieldImage(snapshot),
      bounds: [-180, -90, 180, 90],
      opacity: 0.40,
      pickable: true,
    })];
  },
  // ツールチップは BitmapLayer のピック object に座標が無いため、main.js が info.coordinate + sstAt で生成。
  tooltip() { return null; },
  toFeedItems() { return []; },
};
