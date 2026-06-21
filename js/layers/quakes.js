// 地震レイヤー。統一インターフェース { id, label, fetch, toDeckLayer, legend } を実装。
// 純粋部 buildRingConfig を分離してテスト可能にする。deck は描画時にグローバル参照。
import { magnitudeToRadius, magnitudeToColor } from '../lib/geo.js';
import { quakePlaceJa } from '../lib/quake_place.js';

// 純粋部（地名ガゼッティア＋整形）は lib/quake_place.js に分離。
// 既存 import 経路（../js/layers/quakes.js）を壊さないため re-export。
export { quakePlaceJa };

export function buildRingConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'quakes', data, radiusUnits: 'pixels', pickable: true,
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 1.6,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => magnitudeToRadius(p.mag),
    getLineColor: (p) => [...magnitudeToColor(p.mag), 230],
  };
}

export const quakesLayer = {
  id: 'quakes',
  label: '地震',
  marker: 'ring', // パネルのスウォッチ形状（マップの中空リングに合わせる）
  swatchColor: 'rgb(255,176,40)', // パネルのアイコン色（マップで目立つ規模4-6のアンバーに統一）
  legend: [
    { color: 'rgb(57,208,255)', label: 'M<2' },
    { color: 'rgb(94,255,166)', label: 'M2–4' },
    { color: 'rgb(255,176,40)', label: 'M4–6' },
    { color: 'rgb(255,60,80)', label: 'M6+' },
  ],
  async fetch(getSnapshot) {
    return getSnapshot('quakes');
  },
  toDeckLayer(snapshot) {
    // deck は index.html の CDN によりグローバル提供される
    return new deck.ScatterplotLayer(buildRingConfig(snapshot));
  },
  tooltip(o) {
    if (!o) return null;
    return `地震 規模M${o.mag}｜震源 ${quakePlaceJa(o.place)}`;
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: p.time, title: `M${p.mag} ${quakePlaceJa(p.place)}`, layerId: 'quakes', lon: p.lon, lat: p.lat,
    }));
  },
};
