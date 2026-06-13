// 貿易ルートレイヤー。航路(LineString)=PathLayer、要衝(Point)=ScatterplotLayer。
// toDeckLayer は配列を返す（registry が flat 化）。

export function buildTradeConfigs(geojson) {
  const features = (geojson && geojson.features) ? geojson.features : [];
  const lines = features.filter((f) => f.geometry && f.geometry.type === 'LineString');
  const points = features.filter((f) => f.geometry && f.geometry.type === 'Point');
  return {
    pathConfig: {
      id: 'trade-routes',
      data: lines,
      pickable: true,
      getPath: (f) => f.geometry.coordinates,
      getColor: [70, 230, 255, 90],
      widthUnits: 'pixels',
      getWidth: 1.5,
      widthMinPixels: 1,
      jointRounded: true,
    },
    pointConfig: {
      id: 'trade-chokepoints',
      data: points,
      radiusUnits: 'pixels',
      pickable: true,
      getPosition: (f) => f.geometry.coordinates,
      getRadius: 6,
      getFillColor: [255, 176, 40, 230],
    },
  };
}

export const tradeLayer = {
  id: 'trade',
  label: '貿易ルート',
  legend: [
    { color: 'rgb(70,230,255)', label: '主要航路' },
    { color: 'rgb(255,176,40)', label: '要衝（チョークポイント）' },
  ],
  async fetch() {
    const res = await fetch('data/static/trade_routes.geojson');
    return res.json();
  },
  toDeckLayer(geojson) {
    const { pathConfig, pointConfig } = buildTradeConfigs(geojson);
    return [new deck.PathLayer(pathConfig), new deck.ScatterplotLayer(pointConfig)];
  },
  tooltip(o) {
    if (!o || !o.properties) return null;
    return o.properties.name || null;
  },
};
