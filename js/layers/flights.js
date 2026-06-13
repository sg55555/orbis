// 航空レイヤー。IconLayer で進行方向に回転、sizeUnits:'meters'+ピクセルクランプでズーム連動。
import { iconAngle } from '../lib/geo.js';

function btoaSafe(s) {
  // Node(テスト)とブラウザ双方で動く base64 変換
  return (typeof btoa !== 'undefined') ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

// 北向きの三角（機影）SVG を data URI に。mask:true で getColor 着色。
const ARROW_SVG = 'data:image/svg+xml;base64,' + btoaSafe(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
  '<polygon points="32,4 52,60 32,46 12,60" fill="white"/></svg>'
);

export function buildIconConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'flights',
    data,
    getIcon: () => ({ url: ARROW_SVG, width: 64, height: 64, mask: true, anchorX: 32, anchorY: 32 }),
    sizeUnits: 'meters',
    getSize: () => 40000,
    sizeMinPixels: 4,
    sizeMaxPixels: 30,
    billboard: true,
    pickable: true,
    getPosition: (p) => [p.lon, p.lat],
    getAngle: (p) => iconAngle(p.heading),
    getColor: () => [57, 208, 255, 220],
  };
}

export const flightsLayer = {
  id: 'flights',
  label: '航空',
  legend: [{ color: 'rgb(57,208,255)', label: '航空機（向き=進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('flights'); },
  toDeckLayer(snapshot) { return new deck.IconLayer(buildIconConfig(snapshot)); },
};
