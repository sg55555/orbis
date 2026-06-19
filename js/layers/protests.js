// 抗議レイヤー（緑の加算合成ブロブ＝globe対応のヒート風の面＋薄い pickable 点）。
// HeatmapLayer が globe 非対応のため ScatterplotLayer の加算合成で「面」を表現
// （詳細は conflict.js / [[maplibre-v5-deckgl-globe-version]]）。
import { hostnameOf, blobRadius, ADDITIVE_BLEND, emberFill } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';
import { fipsToJa } from '../lib/places.js';

const GREEN = [94, 255, 166];

export function buildBlobConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests-heat', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => blobRadius(p.mentions),
    radiusMinPixels: 10, radiusMaxPixels: 60, stroked: false, pickable: false,
    getFillColor: () => [GREEN[0], GREEN[1], GREEN[2], 42],
    parameters: ADDITIVE_BLEND,
  };
}

export function buildPickConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests', data, radiusUnits: 'pixels', pickable: true,
    getPosition: (p) => [p.lon, p.lat], getRadius: () => 4, getFillColor: () => [150, 255, 200, 70],
  };
}

// ember コア（白熱度＝mentions・加算合成）。protestsは severityRank が無いため0固定。
export function buildCoreConfig(snapshot, emberScale = 1) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests-core', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => Math.max(3, blobRadius(p.mentions) * 0.45),
    radiusMinPixels: 3, radiusMaxPixels: 26, stroked: false, pickable: false,
    getFillColor: (p) => emberFill(p.mentions, 0, emberScale, [40, 200, 120]),
    parameters: ADDITIVE_BLEND,
  };
}

export const protestsLayer = {
  id: 'protests',
  label: '抗議',
  legend: [{ color: 'rgb(94,255,166)', label: '抗議（緑・GDELT 24h）' }],
  async fetch(getSnapshot) { return getSnapshot('protests'); },
  toDeckLayer(snapshot, ctx) {
    const scale = (ctx && ctx.cfx && ctx.cfx.emberScale) || 1;
    return [
      new deck.ScatterplotLayer(buildBlobConfig(snapshot)),
      new deck.ScatterplotLayer(buildCoreConfig(snapshot, scale)),
      new deck.ScatterplotLayer(buildPickConfig(snapshot)),
    ];
  },
  tooltip(o) {
    if (!o) return null;
    return `抗議 報道集中｜${fipsToJa(o.place)}｜出典 ${hostnameOf(o.url)}`;
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `抗議 ${fipsToJa(p.place)}（${hostnameOf(p.url)}）`,
      layerId: 'protests', lon: p.lon, lat: p.lat,
    }));
  },
};
