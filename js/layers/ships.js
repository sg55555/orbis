// 船舶レイヤー。AISStream の船(points: mmsi/lon/lat/cog/sog/name/type)を、
// 進行方向(COG)を向く船体シルエット(SolidPolygonLayer)＋COG無し船の小ドットで描く。
// IconLayer は deck.gl 9.3.4 + globe で全滅のため使わない（flights と同じ姿勢）。
import { degLenForZoom, silhouettePolygon } from '../lib/geo.js';

// 海色系で航空シアンと差別化。既定=琥珀ゴールド（青い海で視認性が高い）。
// 実装時に python http.server で teal 等と実物比較して確定する。
const SHIP_RGB = [255, 205, 100];

// 船首=前方(+forward)、右舷=+side の船体シルエット（[forward, side] のローカル座標列）。
// 尖った船首・平行な舷側・方形の船尾の7頂点（航空シルエットと形を分け、一目で区別可能に）。
export const SHIP_VERTS = [
  [1.0, 0.0],     // 船首
  [0.4, 0.28],    // 右舷前
  [-0.7, 0.3],    // 右舷
  [-1.0, 0.22],   // 右船尾
  [-1.0, -0.22],  // 左船尾
  [-0.7, -0.3],   // 左舷
  [0.4, -0.28],   // 左舷前
];

// 船を COG 方向に向けた船体シルエット頂点。COG 欠損で null。
export function shipSilhouettePolygon(p, degLen) {
  if (!p) return null;
  return silhouettePolygon(p.lon, p.lat, p.cog, degLen, SHIP_VERTS);
}

// COG を持つ船の船体シルエット（SolidPolygonLayer config）。
export function buildHullConfig(snapshot, degLen) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.cog != null);
  return {
    id: 'ships', data,
    getPolygon: (p) => shipSilhouettePolygon(p, degLen),
    getFillColor: [...SHIP_RGB, 200], stroked: false, pickable: true,
    updateTriggers: { getPolygon: degLen },
  };
}

// COG 無しの船の小ドット（ScatterplotLayer config）。
export function buildDotConfig(snapshot) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.cog == null);
  return {
    id: 'ships-dot', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 2.5, radiusMinPixels: 2, radiusMaxPixels: 3.5,
    getFillColor: [...SHIP_RGB, 220], stroked: false, pickable: true,
  };
}

// ツールチップ: 船名 or MMSI ＋ 船種 ＋ 速度kn ＋ 航路°（欠損項目は省略）。
export function shipTooltip(o) {
  if (!o) return null;
  const head = o.name ? `船名 ${o.name}` : `MMSI ${o.mmsi}`;
  const sog = o.sog == null ? null : `${Math.round(o.sog)}kn`;
  const cog = o.cog == null ? null : `航路 ${String(Math.round(o.cog) % 360).padStart(3, '0')}°`;
  return [head, o.type || null, sog, cog].filter(Boolean).join('｜');
}

export const shipsLayer = {
  id: 'ships',
  label: '船舶',
  marker: 'diamond',              // パネルのスウォッチ形状（船体を菱形で近似）
  swatchColor: 'rgb(255,205,100)',
  legend: [{ color: 'rgb(255,205,100)', label: '船舶（◆＝進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('ships'); },
  toDeckLayer(snapshot, ctx) {
    const zoom = (ctx && typeof ctx.zoom === 'number') ? ctx.zoom : 3;
    const degLen = degLenForZoom(zoom);
    return [
      new deck.SolidPolygonLayer(buildHullConfig(snapshot, degLen)),
      new deck.ScatterplotLayer(buildDotConfig(snapshot)),
    ];
  },
  tooltip(o) { return shipTooltip(o); },
};
