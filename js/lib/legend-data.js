// 凡例データモデル（純データ＋純関数・deck/DOM 非依存）。
// 各レイヤーが既に持つ legend[]/marker/swatchColor と registry の descFor を、
// categories.groupLayers のカテゴリ順に束ねるだけ（新しい分類・色は作らない）。
import { groupLayers } from './categories.js';

// フォールバックは panel.js rowHtml と一致させる（凡例とパネルで同じ見え方）。
export function buildLegendModel(layers, descFor = () => '') {
  return groupLayers(layers).map((g) => ({
    id: g.id,
    label: g.label,
    layers: g.layers.map((l) => ({
      id: l.id,
      label: l.label,
      marker: l.marker || 'dot',
      swatchColor: l.swatchColor || ((l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)'),
      desc: descFor(l.id) || '',
      tiers: Array.isArray(l.legend) ? l.legend : [],
    })),
  }));
}
