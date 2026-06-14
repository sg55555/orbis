// 貿易ルートレイヤー。航路(LineString)=PathLayer、要衝(Point)=ScatterplotLayer。
// toDeckLayer は配列を返す（registry が flat 化）。

// 航路・要衝の日本語名（静的データの英語名 → 分かりやすい日本語）。
const ROUTE_JA = {
  'Trans-Pacific': '太平洋横断（アジア⇄北米）',
  'Asia-Europe (Suez)': 'アジア⇄欧州（スエズ経由）',
  'Trans-Atlantic': '大西洋横断（北米⇄欧州）',
  'Panama-Asia': 'パナマ⇄アジア',
  'Persian Gulf-Asia': 'ペルシャ湾⇄アジア',
  'Australia-Asia': '豪州⇄アジア',
};
const CHOKE_JA = {
  Suez: 'スエズ運河', Hormuz: 'ホルムズ海峡', Malacca: 'マラッカ海峡', Panama: 'パナマ運河',
  'Bab-el-Mandeb': 'バベルマンデブ海峡', Bosphorus: 'ボスポラス海峡', Gibraltar: 'ジブラルタル海峡', Dover: 'ドーバー海峡',
};

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
    const isRoute = o.geometry && o.geometry.type === 'LineString';
    if (isRoute) {
      const name = o.properties.name;
      if (!name) return null;
      return `主要航路 ${ROUTE_JA[name] || name}｜海上輸送ルート`;
    }
    // 要衝は実名が label プロパティにある（name は "chokepoint" 固定）。
    const label = o.properties.label || o.properties.name;
    if (!label) return null;
    return `海上要衝 ${CHOKE_JA[label] || label}（${label}）｜海運の要所`;
  },
};
