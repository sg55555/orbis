// 抗議レイヤー（緑）。言及数で半径。
import { eventRadius } from '../lib/geo.js';

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
};
