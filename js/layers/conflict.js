// 紛争レイヤー（赤）。言及数で半径。
import { eventRadius, hostnameOf } from '../lib/geo.js';

export function buildConflictConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict',
    data,
    radiusUnits: 'pixels',
    pickable: true,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => eventRadius(p.mentions),
    getFillColor: () => [255, 60, 80, 200],
  };
}

export const conflictLayer = {
  id: 'conflict',
  label: '紛争',
  legend: [{ color: 'rgb(255,60,80)', label: '紛争イベント（GDELT・24h）' }],
  async fetch(getSnapshot) { return getSnapshot('conflict'); },
  toDeckLayer(snapshot) { return new deck.ScatterplotLayer(buildConflictConfig(snapshot)); },
  tooltip(o) {
    if (!o) return null;
    return `${o.place}（${hostnameOf(o.url)}）`;
  },
};
