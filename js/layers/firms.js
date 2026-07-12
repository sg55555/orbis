// 山火事レイヤー（NASA FIRMS active fire）。統一インターフェース
// { id, label, marker, swatchColor, legend, fetch, toDeckLayer, tooltip, toFeedItems } を実装。
// 純粋部（frpToRadius/frpToColor/nearestCountry/acqToMs/buildFireConfig）を分離してテスト可能にする。
import { COUNTRY_CENTROIDS } from '../lib/country_centroids.js';
import { FIPS_JA } from '../lib/places.js';

// FRP(火放射パワー MW) → 半径(px)。√FRP を 3..24 にクランプ（地震の pow(mag,1.8) と別系統）。
export function frpToRadius(frp) {
  const f = Number(frp) || 0;
  return Math.round(Math.min(24, Math.max(3, Math.sqrt(f) * 2)));
}

// FRP → 暖色（弱=黄 / 中=橙 / 強=赤）。火の強さを色でも表す。
export function frpToColor(frp) {
  const f = Number(frp) || 0;
  if (f < 20) return [255, 214, 64];   // 黄
  if (f < 100) return [255, 140, 32];  // 橙
  return [255, 64, 32];                // 赤
}

// 座標 → 最寄り国の日本語名（火点は precise な地名を持たないため粗ラベル）。
// COUNTRY_CENTROIDS の最小平面二乗距離 → FIPS_JA[code]（無ければ英名）。
export function nearestCountry(lon, lat) {
  let best = null;
  let bd = Infinity;
  for (const c of COUNTRY_CENTROIDS) {
    const dx = c.lng - lon;
    const dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = c; }
  }
  return best ? (FIPS_JA[best.code] || best.en) : '';
}

// FIRMS の acq_date("2026-07-12") + acq_time("0312") → epoch ms(UTC)。
export function acqToMs(acqDate, acqTime) {
  const [y, m, d] = String(acqDate).split('-').map(Number);
  const t = String(acqTime).padStart(4, '0');
  return Date.UTC(y, (m || 1) - 1, d || 1, Number(t.slice(0, 2)), Number(t.slice(2)));
}

// deck.gl ScatterplotLayer 設定（純粋部・quakes の buildRingConfig 同型）。塗り暖色点。
export function buildFireConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'firms', data, radiusUnits: 'pixels', pickable: true,
    stroked: false, filled: true,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => frpToRadius(p.frp),
    getFillColor: (p) => [...frpToColor(p.frp), 210],
  };
}

const CONF_JA = { high: '高', nominal: '標準', low: '低' };

export const firmsLayer = {
  id: 'firms',
  label: '山火事',
  marker: 'dot',
  swatchColor: 'rgb(255,140,32)',
  legend: [
    { color: 'rgb(255,214,64)', label: 'FRP<20' },
    { color: 'rgb(255,140,32)', label: 'FRP20–100' },
    { color: 'rgb(255,64,32)', label: 'FRP100+' },
  ],
  async fetch(getSnapshot) {
    return getSnapshot('firms');
  },
  toDeckLayer(snapshot) {
    // deck は index.html の CDN によりグローバル提供される
    return new deck.ScatterplotLayer(buildFireConfig(snapshot));
  },
  tooltip(o) {
    if (!o) return null;
    return `山火事 ${nearestCountry(o.lon, o.lat)}付近｜FRP ${o.frp} 信頼度 ${CONF_JA[o.confidence] || o.confidence} ${o.acq_date}`;
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: acqToMs(p.acq_date, p.acq_time),
      title: `🔥 ${nearestCountry(p.lon, p.lat)}付近 FRP${p.frp}`, layerId: 'firms', lon: p.lon, lat: p.lat,
    }));
  },
};
