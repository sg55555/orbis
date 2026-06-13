// 紛争レイヤー（赤ヒートマップ＋薄い pickable 点）。
import { hostnameOf } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';

const RED_RANGE = [
  [40, 0, 10], [110, 12, 28], [180, 28, 46], [230, 45, 64], [255, 90, 110], [255, 170, 180],
];

export function buildHeatConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict-heat', data,
    getPosition: (p) => [p.lon, p.lat],
    getWeight: (p) => Number(p.mentions) || 1,
    radiusPixels: 38, intensity: 1, threshold: 0.05, colorRange: RED_RANGE, pickable: false,
  };
}

export function buildPickConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict', data, radiusUnits: 'pixels', pickable: true,
    getPosition: (p) => [p.lon, p.lat], getRadius: () => 4, getFillColor: () => [255, 60, 80, 60],
  };
}

export const conflictLayer = {
  id: 'conflict',
  label: '紛争',
  legend: [{ color: 'rgb(255,60,80)', label: '紛争（赤・GDELT 24h）' }],
  async fetch(getSnapshot) { return getSnapshot('conflict'); },
  toDeckLayer(snapshot) {
    return [new deck.HeatmapLayer(buildHeatConfig(snapshot)), new deck.ScatterplotLayer(buildPickConfig(snapshot))];
  },
  tooltip(o) {
    if (!o) return null;
    return `紛争｜${o.place}｜出典 ${hostnameOf(o.url)}`;
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `紛争 ${p.place}（${hostnameOf(p.url)}）`,
      layerId: 'conflict', lon: p.lon, lat: p.lat,
    }));
  },
};
