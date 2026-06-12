// レイヤーの登録と一括描画。Phase 2 以降はここに import を足すだけで拡張できる。
import { quakesLayer } from './quakes.js';

export const layers = [quakesLayer];

export function getLayer(id) {
  return layers.find((l) => l.id === id);
}

// 有効レイヤーの deck レイヤー配列を組み立てる。
// enabled: Set<string>、snapshots: Record<id, snapshot>
export function buildDeckLayers(enabled, snapshots) {
  return layers
    .filter((l) => enabled.has(l.id) && snapshots[l.id])
    .map((l) => l.toDeckLayer(snapshots[l.id]));
}
