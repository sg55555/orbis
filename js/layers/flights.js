// 航空レイヤー。進行方向を向く塗り三角形(SolidPolygonLayer)＋heading無し機の小ドット。
// 注: IconLayer/TextLayer は deck.gl 9.3.4 + globe + MapboxOverlay で描画されない
// （[[deckgl-9.3-iconlayer-globe-broken]]）。ジオメトリ層のみ・ズーム適応で一定px化する。
import { degLenForZoom } from '../lib/geo.js';

const CYAN = [80, 220, 255];

// 機体を heading 方向に向けた二等辺三角形の頂点 [[lon,lat]×3]。heading 欠損で null。
export function flightTrianglePolygon(p, degLen) {
  if (!p || p.heading == null || p.lon == null || p.lat == null) return null;
  const h = Number(p.heading);
  if (!Number.isFinite(h)) return null;
  const rad = (h * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
  const fwd = [Math.sin(rad) / cosLat, Math.cos(rad)];
  const perp = [Math.cos(rad) / cosLat, -Math.sin(rad)];
  const L = degLen, W = degLen * 0.55;
  const tip = [p.lon + fwd[0] * L, p.lat + fwd[1] * L];
  const back = [p.lon - fwd[0] * L * 0.5, p.lat - fwd[1] * L * 0.5];
  const left = [back[0] + perp[0] * W, back[1] + perp[1] * W];
  const right = [back[0] - perp[0] * W, back[1] - perp[1] * W];
  return [tip, left, right];
}

// heading を持つ機の三角形（SolidPolygonLayer config）。degLen はズーム適応。
export function buildTriangleConfig(snapshot, degLen) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.heading != null);
  return {
    id: 'flights', data,
    getPolygon: (p) => flightTrianglePolygon(p, degLen),
    getFillColor: [...CYAN, 235], stroked: false, pickable: true,
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
  legend: [{ color: 'rgb(80,220,255)', label: '航空機（▲＝進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('flights'); },
  toDeckLayer(snapshot, ctx) {
    const zoom = (ctx && typeof ctx.zoom === 'number') ? ctx.zoom : 3;
    const degLen = degLenForZoom(zoom);
    return [
      new deck.SolidPolygonLayer(buildTriangleConfig(snapshot, degLen)),
      new deck.ScatterplotLayer(buildDotConfig(snapshot)),
    ];
  },
  tooltip(o) {
    if (!o) return null;
    const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
    return `便名 ${String(o.callsign || '').trim()}｜高度 ${alt}｜速度 ${Math.round(o.velocity || 0)}m/s`;
  },
};
