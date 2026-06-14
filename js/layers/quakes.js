// 地震レイヤー。統一インターフェース { id, label, fetch, toDeckLayer, legend } を実装。
// 純粋部 buildRingConfig を分離してテスト可能にする。deck は描画時にグローバル参照。
import { magnitudeToRadius, magnitudeToColor } from '../lib/geo.js';

// USGS の place（例 "3 km W of Cobb, CA"）を日本語で分かりやすく整形する純粋関数。
const DIR_JA = {
  N: '北', S: '南', E: '東', W: '西', NE: '北東', NW: '北西', SE: '南東', SW: '南西',
  NNE: '北北東', ENE: '東北東', ESE: '東南東', SSE: '南南東', SSW: '南南西', WSW: '西南西', WNW: '西北西', NNW: '北北西',
};
const REGION_JA = {
  CA: 'カリフォルニア州', AK: 'アラスカ州', NV: 'ネバダ州', HI: 'ハワイ州', OK: 'オクラホマ州', TX: 'テキサス州',
  WA: 'ワシントン州', OR: 'オレゴン州', MT: 'モンタナ州', ID: 'アイダホ州', UT: 'ユタ州', WY: 'ワイオミング州',
  Alaska: 'アラスカ州', Nevada: 'ネバダ州', Hawaii: 'ハワイ州', California: 'カリフォルニア州',
  'New Mexico': 'ニューメキシコ州', Oklahoma: 'オクラホマ州', Texas: 'テキサス州', Washington: 'ワシントン州',
  Oregon: 'オレゴン州', Montana: 'モンタナ州', Idaho: 'アイダホ州', Utah: 'ユタ州', Wyoming: 'ワイオミング州',
  Japan: '日本', Indonesia: 'インドネシア', Chile: 'チリ', Mexico: 'メキシコ', Philippines: 'フィリピン',
  'Papua New Guinea': 'パプアニューギニア', Greece: 'ギリシャ', Turkey: 'トルコ', Iran: 'イラン', Peru: 'ペルー',
  Russia: 'ロシア', Tonga: 'トンガ', Fiji: 'フィジー', Vanuatu: 'バヌアツ',
};
export function quakePlaceJa(place) {
  if (!place || typeof place !== 'string') return place || '';
  const s = place.trim();
  let head = s, suffix = '';
  const m = s.match(/^(.*),\s*([^,]+)$/);
  if (m) {
    head = m[1].trim();
    const region = m[2].trim();
    suffix = `（${REGION_JA[region] || region}）`;
  } else if (REGION_JA[s]) {
    return REGION_JA[s];
  }
  const dm = head.match(/^(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i);
  if (dm) {
    const dir = DIR_JA[dm[2].toUpperCase()] || dm[2];
    return `${dm[3]} の${dir} ${dm[1]}km${suffix}`;
  }
  return head + suffix;
}

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
