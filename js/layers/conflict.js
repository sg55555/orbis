// 紛争レイヤー（赤の加算合成ブロブ＝globe対応のヒート風の面＋薄い pickable 点）。
// 注: deck.gl の HeatmapLayer は GPU 集約で globe ビューに非対応（weightsTexture が結べず
// 面が描画されない）。代わりに半透明・大半径の ScatterplotLayer を加算合成で重ね、
// 報道が集中するほど明るく発色させて「面」を表現する（[[maplibre-v5-deckgl-globe-version]]）。
import { hostnameOf, blobRadius, ADDITIVE_BLEND } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';
import { fipsToJa } from '../lib/places.js';

const RED = [255, 60, 80];

export function buildBlobConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict-heat', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => blobRadius(p.mentions),
    radiusMinPixels: 10, radiusMaxPixels: 60, stroked: false, pickable: false,
    getFillColor: () => [RED[0], RED[1], RED[2], 42], // 低alpha＋加算で密集地ほど発色
    parameters: ADDITIVE_BLEND,
  };
}

export function buildPickConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict', data, radiusUnits: 'pixels', pickable: true,
    getPosition: (p) => [p.lon, p.lat], getRadius: () => 4, getFillColor: () => [255, 120, 140, 70],
  };
}

export const conflictLayer = {
  id: 'conflict',
  label: '紛争',
  legend: [{ color: 'rgb(255,60,80)', label: '紛争（赤・GDELT 24h）' }],
  async fetch(getSnapshot) { return getSnapshot('conflict'); },
  toDeckLayer(snapshot) {
    return [new deck.ScatterplotLayer(buildBlobConfig(snapshot)), new deck.ScatterplotLayer(buildPickConfig(snapshot))];
  },
  tooltip(o) {
    if (!o) return null;
    return `紛争 報道集中｜${fipsToJa(o.place)}｜出典 ${hostnameOf(o.url)}`;
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `紛争 ${fipsToJa(p.place)}（${hostnameOf(p.url)}）`,
      layerId: 'conflict', lon: p.lon, lat: p.lat,
    }));
  },
};
