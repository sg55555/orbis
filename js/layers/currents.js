// 海流レイヤー。主要海流をキュレートした静的 GeoJSON を、頂点ごとの相対水温(temps)に応じて
// 「温度フィールド面」＋「流れる波/粒子」で windy×SST 風に描く。
// 面: 海流に沿って密にサンプルした点に水温色の加算ブロブ(ScatterplotLayer)を重ねて面を作る
//     （deck.gl の HeatmapLayer は globe 非対応のため、紛争ヒートと同じ加算合成方式を使う）。
//     さらに経路に沿って明るさの「波」を走らせ、引き(ズームアウト)でも流れが見えるようにする。
// 動き(粒子): main.js が経路上を流れる粒子を重ねる（近接時のディテール）。
import { ADDITIVE_BLEND } from '../lib/geo.js';
import { normalizedTimestamps } from '../lib/motion.js';

// カラーマップ停止点（t:0=極寒〜1=高温 → [r,g,b]）。?cmap= で実物比較する。
const STOPS = {
  // 連続SST（青→シアン→緑→黄→橙→赤）。気象の海面水温図風。
  sst: [
    [0.0, [40, 90, 200]], [0.2, [42, 150, 255]], [0.4, [30, 220, 210]],
    [0.55, [110, 230, 120]], [0.7, [255, 230, 90]], [0.85, [255, 160, 60]], [1.0, [255, 70, 55]],
  ],
  twin: [
    [0.0, [40, 80, 200]], [0.3, [90, 160, 250]], [0.48, [180, 220, 255]],
    [0.52, [255, 232, 175]], [0.7, [255, 175, 85]], [1.0, [255, 80, 40]],
  ],
  aqua: [
    [0.0, [20, 120, 140]], [0.28, [40, 190, 205]], [0.5, [110, 245, 255]],
    [0.52, [255, 215, 130]], [0.72, [255, 175, 65]], [1.0, [255, 130, 40]],
  ],
};

export const CMAPS = Object.keys(STOPS);
export const DEFAULT_CMAP = 'sst';
const FIELD_ALPHA = 46;   // 面ブロブの加算 alpha 基準値
const FIELD_STEP = 12;    // 1セグメントの密サンプル数（面の滑らかさ＝余白を減らす）
const WAVE_COUNT = 2;     // 1経路あたりの明るさ波の数（少なめ＝順に光るのが明快）
const WAVE_SPEED = 3.0;   // motionT に対する波の進行速度（速め＝引きでも動きが分かる）
const WAVE_SHARP = 3;     // 明part の鋭さ（大きいほど crest が細く強い）
const WAVE_BASE = 0.7;    // 非点灯時の明るさ（帯=面を常に見せる）
const WAVE_PEAK = 2.4;    // 点灯時の追加明るさ（順番に強く光る）

export function lerpStops(stops, t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i][0] && x <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = b[0] - a[0] || 1;
  const k = (x - a[0]) / span;
  return [0, 1, 2].map((j) => Math.round(a[1][j] + (b[1][j] - a[1][j]) * k));
}

export function colorForTemp(t, cmap = DEFAULT_CMAP) {
  return lerpStops(STOPS[cmap] || STOPS[DEFAULT_CMAP], t);
}

const lerp = (a, b, k) => a + (b - a) * k;

// 距離ベースのタイムスタンプ ts に対して t の水温を線形補間（pointAlongPath と整合）。
export function tempAtT(temps, ts, t) {
  const tt = t <= 0 ? 0 : t >= 1 ? 1 : t;
  for (let i = 0; i < ts.length - 1; i++) {
    if (tt <= ts[i + 1]) {
      const span = ts[i + 1] - ts[i] || 1;
      return lerp(temps[i], temps[i + 1], (tt - ts[i]) / span);
    }
  }
  return temps[temps.length - 1];
}

// 各海流を頂点間で密サンプルし、温度フィールド面のブロブ点配列を返す（純粋）。
// 各点は rgb（水温色）と phase（経路上の正規化位置 0..1）を持つ（phase は波の駆動に使う）。
export function buildCurrentField(geojson, cmap = DEFAULT_CMAP, step = FIELD_STEP) {
  const features = (geojson && geojson.features) ? geojson.features : [];
  const out = [];
  for (const f of features) {
    const co = f.geometry && f.geometry.coordinates;
    const temps = f.properties && f.properties.temps;
    if (!co || co.length < 2 || !temps) continue;
    const { name, name_en } = f.properties;
    const ts = normalizedTimestamps(co);
    for (let i = 0; i < co.length - 1; i++) {
      const [x0, y0] = co[i], [x1, y1] = co[i + 1];
      for (let s = 0; s < step; s++) {
        const a = s / step;
        const t = lerp(temps[i], temps[i + 1], a);
        out.push({
          position: [lerp(x0, x1, a), lerp(y0, y1, a)],
          rgb: colorForTemp(t, cmap), temp: t, name, name_en,
          phase: lerp(ts[i], ts[i + 1], a),
        });
      }
    }
  }
  return out;
}

// 明るさの波（経路に沿って流れる）。motionT を与えると進行する。0..~1.4 の係数。
export function waveFactor(phase, motionT) {
  return 0.45 + 0.95 * (0.5 + 0.5 * Math.sin(2 * Math.PI * (phase * WAVE_COUNT - motionT * WAVE_SPEED)));
}

// チェイス調整の既定値（?flow=chase 時。URL/ctx で上書き可能）。
const CHASE_CELLS = 6;     // 1海流あたりのセル(面)数
const CHASE_TAIL = 0.22;   // 尾の長さ（phase 単位の減衰幅）
const CHASE_SPEED = 0.7;   // motionT に対するヘッド進行速度
const CHASE_BASE = 0.55;   // 消灯セルの明るさ（淡い水温面を常時見せる）
const CHASE_PEAK = 1.6;    // 点灯セルの追加明るさ
const CHASE_STEP = 'hard'; // 'hard'=セル量子化 / 'glide'=連続

// 0..1 の2位相間の巡回距離（0..0.5、ラップ考慮・対称）。
export function cyclicDist(a, b) {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

// チェイスの明るさ係数。各点を cells 個のセルに量子化し、動く点灯ヘッドの「後方(尾)」を
// 明るく、前方を暗く（＝流れ方向が読める）。戻り値 base..(base+peak)。
export function chaseFactor(phase, motionT, opts = {}) {
  const cells = opts.cells || CHASE_CELLS;
  const tail = opts.tail || CHASE_TAIL;
  const speed = opts.speed || CHASE_SPEED;
  const base = opts.base != null ? opts.base : CHASE_BASE;
  const peak = opts.peak != null ? opts.peak : CHASE_PEAK;
  const step = opts.step || CHASE_STEP;
  // hard はセル中心に量子化（セル単位でステップ点灯）、glide は連続。
  const pos = step === 'glide' ? phase : (Math.floor(phase * cells) + 0.5) / cells;
  const head = ((motionT * speed) % 1 + 1) % 1;
  // ヘッドより「後方(phase が小さい側)」への距離。0=ヘッド、増えるほど尾の後ろ、前方は ~1。
  const behind = ((head - pos) % 1 + 1) % 1;
  const lit = Math.max(0, 1 - behind / tail);
  return base + peak * lit * lit; // 二乗で crest を鋭く
}

const _fieldCache = {};
function field(geojson, cmap) {
  if (!_fieldCache[cmap]) _fieldCache[cmap] = buildCurrentField(geojson, cmap);
  return _fieldCache[cmap];
}

function tempWord(t) {
  if (t < 0.34) return '冷たい';
  if (t < 0.67) return '中間';
  return '暖かい';
}

export const currentsLayer = {
  id: 'currents',
  label: '海流',
  marker: 'line',
  swatchColor: 'rgb(120,170,200)',
  legend: [
    { color: 'rgb(42,150,255)', label: '冷たい' },
    { color: 'rgb(110,230,120)', label: '中間' },
    { color: 'rgb(255,90,55)', label: '暖かい' },
  ],
  async fetch() {
    const res = await fetch('data/static/ocean_currents.geojson');
    return res.json();
  },
  toDeckLayer(geojson, ctx) {
    const cmap = (ctx && ctx.cmap) || DEFAULT_CMAP;
    const mt = (ctx && ctx.motionT) || 0;
    const flow = (ctx && ctx.flow) || 'chase';
    const chaseOpts = (ctx && ctx.chase) || {};
    // 明るさ係数: chase=離散セルの順送り（既定）/ wave=旧 sine 波（?flow=wave 比較用）。
    const bright = flow === 'wave'
      ? (d) => waveFactor(d.phase, mt)
      : (d) => chaseFactor(d.phase, mt, chaseOpts);
    // 温度フィールド面（加算ブロブ）。淡い水温面を常時見せ、その上をチェイスが走る。
    return [new deck.ScatterplotLayer({
      id: 'currents', data: field(geojson, cmap), pickable: true,
      radiusUnits: 'pixels', stroked: false, filled: true,
      getPosition: (d) => d.position, getRadius: 1,
      radiusMinPixels: 26, radiusMaxPixels: 54,
      getFillColor: (d) => {
        const a = Math.min(255, Math.round(FIELD_ALPHA * bright(d)));
        return [d.rgb[0], d.rgb[1], d.rgb[2], a];
      },
      updateTriggers: { getFillColor: mt },
      parameters: ADDITIVE_BLEND,
    })];
  },
  tooltip(o) {
    if (!o || !o.name) return null;
    return `海流 ${o.name}｜${o.name_en}｜水温 ${tempWord(o.temp)}`;
  },
  toFeedItems() {
    return [];
  },
};

export { normalizedTimestamps };
