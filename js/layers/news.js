// ニュースレイヤー：globe にカテゴリ色のピン（ScatterplotLayer）。クリックで日本語ポップアップ（main.js）。
import { hostnameOf } from '../lib/geo.js';
import { CATEGORY, categoryOf } from '../lib/news_categories.js';

export const newsLayer = {
  id: 'news',
  label: 'ニュース',
  marker: 'dot',
  legend: Object.values(CATEGORY).map((c) => ({ color: `rgb(${c.color.join(',')})`, label: c.label })),
  async fetch(getSnapshot) { return getSnapshot('news'); },
  toDeckLayer(snapshot) {
    const data = (snapshot && snapshot.items) ? snapshot.items : [];
    return new deck.ScatterplotLayer({
      id: 'news', data, pickable: true, radiusUnits: 'pixels',
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6, radiusMinPixels: 4, radiusMaxPixels: 9,
      stroked: true, lineWidthMinPixels: 1.5,
      getFillColor: (d) => [...categoryOf(d.category).color, 225],
      getLineColor: [255, 255, 255, 230],
    });
  },
  tooltip(o) {
    if (!o) return null;
    return `[${categoryOf(o.category).label}] ${o.title_ja}｜${hostnameOf(o.url)}`;
  },
  toFeedItems(snapshot) {
    const items = (snapshot && snapshot.items) ? snapshot.items : [];
    return items.map((d) => ({
      id: d.id,
      time: d.time,
      layerId: 'news',
      lon: d.lon,
      lat: d.lat,
      title: `[${categoryOf(d.category).label}] ${d.title_ja}（${hostnameOf(d.url)}）`,
    }));
  },
};
