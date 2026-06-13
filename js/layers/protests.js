// 抗議レイヤー（緑）。言及数で半径。
import { eventRadius, hostnameOf } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';

export function buildProtestsConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests',
    data,
    radiusUnits: 'pixels',
    pickable: true,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => eventRadius(p.mentions),
    getFillColor: () => [94, 255, 166, 200],
  };
}

export const protestsLayer = {
  id: 'protests',
  label: '抗議',
  legend: [{ color: 'rgb(94,255,166)', label: '抗議イベント（GDELT・24h）' }],
  async fetch(getSnapshot) { return getSnapshot('protests'); },
  toDeckLayer(snapshot) { return new deck.ScatterplotLayer(buildProtestsConfig(snapshot)); },
  tooltip(o) {
    if (!o) return null;
    return `${o.place}（${hostnameOf(o.url)}）`;
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `抗議 ${p.place}（${hostnameOf(p.url)}）`,
      layerId: 'protests', lon: p.lon, lat: p.lat,
    }));
  },
};
