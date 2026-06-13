// レイヤーの登録と一括描画。Phase 2 以降はここに import を足すだけで拡張できる。
import { quakesLayer } from './quakes.js';
import { flightsLayer } from './flights.js';
import { conflictLayer } from './conflict.js';
import { protestsLayer } from './protests.js';
import { tradeLayer } from './trade.js';

export const layers = [quakesLayer, flightsLayer, conflictLayer, protestsLayer, tradeLayer];

export function getLayer(id) {
  return layers.find((l) => l.id === id);
}

// 有効レイヤーの deck レイヤー配列を組み立てる。
// toDeckLayer は単体または配列を返してよい（配列は flat 化）。
// layersOverride: テスト用に layers を差し替え可能。
export function buildDeckLayers(enabled, snapshots, layersOverride) {
  const ls = layersOverride || layers;
  return ls
    .filter((l) => enabled.has(l.id) && snapshots[l.id])
    .flatMap((l) => {
      const r = l.toDeckLayer(snapshots[l.id]);
      return Array.isArray(r) ? r : [r];
    });
}

// deck レイヤーID → 論理レイヤーID（trade は2つの deck レイヤーに分かれる）。
const DECK_TO_LAYER = {
  quakes: 'quakes', flights: 'flights', conflict: 'conflict', protests: 'protests',
  'trade-routes': 'trade', 'trade-chokepoints': 'trade',
};

// deck の picking 結果から、レイヤー別フォーマット済みツールチップ文字列を返す。
export function tooltipFor(deckLayerId, object) {
  const l = getLayer(DECK_TO_LAYER[deckLayerId]);
  return (l && l.tooltip) ? l.tooltip(object) : null;
}
