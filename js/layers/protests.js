// 抗議レイヤー（緑ヒートマップ＋薄い pickable 点）。
import { hostnameOf } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';

const GREEN_RANGE = [
  [0, 30, 16], [10, 80, 44], [24, 140, 78], [50, 200, 120], [94, 255, 166], [180, 255, 210],
];

export function buildHeatConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests-heat', data,
    getPosition: (p) => [p.lon, p.lat],
    getWeight: (p) => Number(p.mentions) || 1,
    radiusPixels: 38, intensity: 1, threshold: 0.05, colorRange: GREEN_RANGE, pickable: false,
  };
}

export function buildPickConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests', data, radiusUnits: 'pixels', pickable: true,
    getPosition: (p) => [p.lon, p.lat], getRadius: () => 4, getFillColor: () => [94, 255, 166, 60],
  };
}

export const protestsLayer = {
  id: 'protests',
  label: '抗議',
  legend: [{ color: 'rgb(94,255,166)', label: '抗議（緑・GDELT 24h）' }],
  async fetch(getSnapshot) { return getSnapshot('protests'); },
  toDeckLayer(snapshot) {
    return [new deck.HeatmapLayer(buildHeatConfig(snapshot)), new deck.ScatterplotLayer(buildPickConfig(snapshot))];
  },
  tooltip(o) {
    if (!o) return null;
    return `${o.place}（${hostnameOf(o.url)}）`; // ラベル付き文面は Task 4 で更新
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `抗議 ${p.place}（${hostnameOf(p.url)}）`,
      layerId: 'protests', lon: p.lon, lat: p.lat,
    }));
  },
};
