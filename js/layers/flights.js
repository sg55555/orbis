// 航空レイヤー。ドット(ScatterplotLayer)＋進行方向の短い線(LineLayer)で描画。
// 注: 旧実装の IconLayer(SVG機影)は deck.gl 9.3.4 + globe + MapboxOverlay で
// アイコンアトラスが描画されず不可視になった（SVG/PNG/事前アトラス/interleaved 全滅、
// "Expected value to be of type number, but found null"）。確実に描画される
// primitive（Scatterplot/Line）に置換し、向き=進行方向は heading の線分で表現する。
import { headingEndpoint } from '../lib/geo.js';

const CYAN = [57, 208, 255];

// 機体位置のドット（ピクセル一定サイズ・ホバー可能）。
export function buildDotConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'flights', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 3, radiusMinPixels: 2, radiusMaxPixels: 4.5,
    getFillColor: [...CYAN, 235], stroked: false, pickable: true,
  };
}

// heading を持つ機のみ、進行方向へ伸びる短い線分（向きインジケータ）。
export function buildHeadingConfig(snapshot, degLen = 0.7) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = [];
  for (const p of pts) {
    const end = headingEndpoint(p.lon, p.lat, p.heading, degLen);
    if (end) data.push({ source: [p.lon, p.lat], target: end });
  }
  return {
    id: 'flights-heading', data, widthUnits: 'pixels', getWidth: 1.4,
    getSourcePosition: (d) => d.source, getTargetPosition: (d) => d.target,
    getColor: [...CYAN, 165], pickable: false,
  };
}

export const flightsLayer = {
  id: 'flights',
  label: '航空',
  legend: [{ color: 'rgb(57,208,255)', label: '航空機（線=進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('flights'); },
  toDeckLayer(snapshot) {
    return [
      new deck.LineLayer(buildHeadingConfig(snapshot)),
      new deck.ScatterplotLayer(buildDotConfig(snapshot)),
    ];
  },
  tooltip(o) {
    if (!o) return null;
    const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
    return `便名 ${String(o.callsign || '').trim()}｜高度 ${alt}｜速度 ${Math.round(o.velocity || 0)}m/s`;
  },
};
