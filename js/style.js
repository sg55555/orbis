// ネオン濃紺ベクターベースマップ（OpenFreeMap・キー不要）。
// 背景レイヤーを置かないことで globe の外側が透明になり、背面の星空が見える。
import { getLook } from './lib/look.js';

const OFM = 'https://tiles.openfreemap.org';

export function buildBaseStyle(look = getLook()) {
  // ラベルは name:ja 優先。欠落時は現地スクリプト(name=アラビア語/キリル等)でなく
  // ラテン文字(name:latin→name:en)にフォールバックし、最後の手段だけ name(現地名)。
  // 高zoomで name:ja を持たない地物がアラビア語等で出る問題を回避する。
  const jaLabel = ['coalesce',
    ['get', 'name:ja'], ['get', 'name:latin'], ['get', 'name:en'], ['get', 'name']];
  const water = (look && look.water) || '#081a30';
  const land = (look && look.land) || '#182a47';
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
        paint: { 'fill-color': water } },
      { id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        paint: { 'fill-color': land, 'fill-opacity': 0.55 } },
      { id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
        paint: { 'fill-color': land, 'fill-opacity': 0.35 } },
      // 国内境界（共和国/州 = admin_level 3 以上）: 点線・淡い。「ロシア連邦に属するサハ共和国」
      // のような従属関係を点線で示す。低zoomでは消し、近づくと現れる。
      { id: 'boundary-region', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
        filter: ['all', ['>=', ['get', 'admin_level'], 3], ['!=', ['get', 'maritime'], 1]],
        paint: {
          'line-color': '#7fc4ec',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.0, 3.5, 0.5, 6, 0.75],
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 6, 1.3],
          'line-dasharray': [2, 2.5],
        } },
      // 国境（admin_level == 2）: 実線・はっきり。ズームで太くして遠景でも視認可能に。
      { id: 'boundary-country', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: {
          'line-color': '#5fe6ff',
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.6, 4, 0.9],
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 4, 1.7, 8, 2.6],
        } },
      { id: 'place-country', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': jaLabel, 'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 4, 15], 'text-max-width': 8 },
        paint: { 'text-color': '#dbeafe', 'text-halo-color': '#05080f', 'text-halo-width': 1.5 } },
      // 行政1次区画（県/州/省 = class 'state'/'province'）のラベル。タイルには既に
      // admin1 の place 点が入っているが従来は層が無く描かれなかった（日本で市は出るのに
      // 県が出ない違和感の原因）。country>state>city の中間調・name:ja で日本語化。
      // 低zoomでの氾濫を避け minzoom 3.5＋text-opacity で淡くフェードイン。
      { id: 'place-state', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        minzoom: 3.5, filter: ['in', ['get', 'class'], ['literal', ['state', 'province']]],
        layout: { 'text-field': jaLabel, 'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 10, 6, 13], 'text-max-width': 7 },
        paint: { 'text-color': '#a7c6ef', 'text-halo-color': '#05080f', 'text-halo-width': 1.3,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 3.5, 0, 4.5, 0.85] } },
      { id: 'place-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        minzoom: 3, filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: { 'text-field': jaLabel, 'text-font': ['Noto Sans Regular'], 'text-size': 11,
          'text-max-width': 8 },
        paint: { 'text-color': '#8fb8e8', 'text-halo-color': '#05080f', 'text-halo-width': 1.2 } },
    ],
  };
}
