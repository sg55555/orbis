// ネオン濃紺ベクターベースマップ（OpenFreeMap・キー不要）。
// 背景レイヤーを置かないことで globe の外側が透明になり、背面の星空が見える。
const OFM = 'https://tiles.openfreemap.org';

export function buildBaseStyle() {
  const jaLabel = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
  return {
    version: 8,
    // MapLibre GL JS v5+ の球体投影をスタイルで宣言。これが無いと平面メルカトルになり、
    // 引いても球体にならず同じ大陸が横に繰り返される（renderWorldCopies）。
    projection: { type: 'globe' },
    glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${OFM}/sprites/ofm_f384/ofm`,
    sources: {
      openmaptiles: { type: 'vector', url: `${OFM}/planet` },
    },
    layers: [
      // 背景レイヤーなし（透明＝星空に浮く球体）
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
        paint: { 'fill-color': '#081a30' } },
      { id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        paint: { 'fill-color': '#182a47', 'fill-opacity': 0.55 } },
      { id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
        paint: { 'fill-color': '#182a47', 'fill-opacity': 0.35 } },
      { id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 4],
        paint: { 'line-color': '#39d0ff', 'line-opacity': 0.4, 'line-width': 0.7, 'line-blur': 0.6 } },
      { id: 'place-country', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': jaLabel, 'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 4, 15], 'text-max-width': 8 },
        paint: { 'text-color': '#dbeafe', 'text-halo-color': '#05080f', 'text-halo-width': 1.5 } },
      { id: 'place-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        minzoom: 3, filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: { 'text-field': jaLabel, 'text-font': ['Noto Sans Regular'], 'text-size': 11,
          'text-max-width': 8 },
        paint: { 'text-color': '#8fb8e8', 'text-halo-color': '#05080f', 'text-halo-width': 1.2 } },
    ],
  };
}
