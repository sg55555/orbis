// 航空レイヤー。進行方向を向く飛行機シルエット(SolidPolygonLayer)＋heading無し機の小ドット。
// 注: IconLayer/TextLayer は deck.gl 9.3.4 + globe + MapboxOverlay で描画されない
// （[[deckgl-9.3-iconlayer-globe-broken]]）。ジオメトリ層のみ・ズーム適応で一定px化する。
import { degLenForZoom, silhouettePolygon } from '../lib/geo.js';

const CYAN = [80, 220, 255];

// 機首=前方(+forward)、右翼=+side の飛行機シルエット（[forward, side] のローカル座標列）。
// 機首・後退翼・尾翼の10頂点。極小サイズでも「機体」と分かる最小限の形。
export const PLANE_VERTS = [
  [1.0, 0.0],     // 機首
  [-0.2, 0.15],   // 右胴
  [-0.45, 0.75],  // 右翼端
  [-0.6, 0.12],   // 右翼後縁
  [-1.0, 0.35],   // 右尾翼端
  [-0.9, 0.0],    // 尾部
  [-1.0, -0.35],  // 左尾翼端
  [-0.6, -0.12],  // 左翼後縁
  [-0.45, -0.75], // 左翼端
  [-0.2, -0.15],  // 左胴
];

// 機体を heading 方向に向けた飛行機シルエット頂点。heading 欠損で null。
export function planeSilhouettePolygon(p, degLen) {
  if (!p) return null;
  return silhouettePolygon(p.lon, p.lat, p.heading, degLen, PLANE_VERTS);
}

// heading を持つ機のシルエット（SolidPolygonLayer config）。degLen はズーム適応。
export function buildPlaneConfig(snapshot, degLen) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.heading != null);
  return {
    id: 'flights', data,
    getPolygon: (p) => planeSilhouettePolygon(p, degLen),
    getFillColor: [...CYAN, 190], stroked: false, pickable: true,
    updateTriggers: { getPolygon: degLen },
  };
}

// heading 無しの機の小ドット（ScatterplotLayer config）。
export function buildDotConfig(snapshot) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.heading == null);
  return {
    id: 'flights-dot', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 2.5, radiusMinPixels: 2, radiusMaxPixels: 3.5,
    getFillColor: [...CYAN, 220], stroked: false, pickable: true,
  };
}

export const flightsLayer = {
  id: 'flights',
  label: '航空',
  marker: 'triangle', // パネルのスウォッチ形状（簡易・進行方向の三角で近似）
  legend: [{ color: 'rgb(80,220,255)', label: '航空機（✈＝進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('flights'); },
  toDeckLayer(snapshot, ctx) {
    const zoom = (ctx && typeof ctx.zoom === 'number') ? ctx.zoom : 3;
    const degLen = degLenForZoom(zoom);
    return [
      new deck.SolidPolygonLayer(buildPlaneConfig(snapshot, degLen)),
      new deck.ScatterplotLayer(buildDotConfig(snapshot)),
    ];
  },
  tooltip(o) {
    if (!o) return null;
    const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
    return `便名 ${String(o.callsign || '').trim()}｜高度 ${alt}｜速度 ${Math.round(o.velocity || 0)}m/s`;
  },
};
