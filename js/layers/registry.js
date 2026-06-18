// レイヤーの登録と一括描画。Phase 2 以降はここに import を足すだけで拡張できる。
import { quakesLayer } from './quakes.js';
import { flightsLayer } from './flights.js';
import { conflictLayer } from './conflict.js';
import { protestsLayer } from './protests.js';
import { tradeLayer } from './trade.js';
import { currentsLayer } from './currents.js';
import { airtempLayer } from './airtemp.js';
import { sstLayer } from './sst.js';
import { shipsLayer } from './ships.js';
import { newsLayer } from './news.js';

export const layers = [quakesLayer, flightsLayer, conflictLayer, protestsLayer, tradeLayer, sstLayer, currentsLayer, airtempLayer, shipsLayer, newsLayer];

export function getLayer(id) {
  return layers.find((l) => l.id === id);
}

// 有効レイヤーの deck レイヤー配列を組み立てる。
// toDeckLayer は単体または配列を返してよい（配列は flat 化）。
// layersOverride: テスト用に layers を差し替え可能。ctx: zoom など描画コンテキスト。
export function buildDeckLayers(enabled, snapshots, layersOverride, ctx) {
  const ls = layersOverride || layers;
  return ls
    .filter((l) => enabled.has(l.id) && snapshots[l.id])
    .flatMap((l) => {
      const r = l.toDeckLayer(snapshots[l.id], ctx);
      return Array.isArray(r) ? r : [r];
    });
}

// toFeedItems を実装するレイヤーだけを返す（フィード対象）。
export function feedLayers() {
  return layers.filter((l) => typeof l.toFeedItems === 'function');
}

// deck レイヤーID → 論理レイヤーID（trade は2つの deck レイヤーに分かれる）。
const DECK_TO_LAYER = {
  quakes: 'quakes', flights: 'flights', 'flights-dot': 'flights',
  conflict: 'conflict', protests: 'protests',
  'trade-routes': 'trade', 'trade-chokepoints': 'trade',
  sst: 'sst', currents: 'currents', airtemp: 'airtemp',
  ships: 'ships', 'ships-dot': 'ships',
  news: 'news',
};

// deck の picking 結果から、レイヤー別フォーマット済みツールチップ文字列を返す。
export function tooltipFor(deckLayerId, object) {
  const l = getLayer(DECK_TO_LAYER[deckLayerId]);
  return (l && l.tooltip) ? l.tooltip(object) : null;
}

// 各レイヤーの1行説明（パネル表示用）。
const DESCRIPTIONS = {
  quakes: '直近の地震（USGS・円の大きさ=規模）',
  flights: '飛行中の航空機（OpenSky・向き=進行方向）',
  conflict: '紛争関連報道の集中（GDELT・24h・赤い面）',
  protests: '抗議関連報道の集中（GDELT・24h・緑の面）',
  trade: '主要な海上貿易ルートと要衝',
  sst: '全球の海面水温（Open-Meteo Marine・色=暖/寒の連続グラデ・既定OFF）',
  currents: '世界の主要な海流（色=水温の連続グラデ・暖/寒）',
  airtemp: '全球の気温（Open-Meteo・色=暖/寒の連続グラデ・半透明）',
  ships: '航行中の船舶（AIS・◆＝進行方向・既定OFF）',
  news: '世界の重要ニュース（厳選RSS→日本語訳・色=カテゴリ）',
};
export function descFor(id) { return DESCRIPTIONS[id] || ''; }
