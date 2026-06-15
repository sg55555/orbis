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
