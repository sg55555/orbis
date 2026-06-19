// 離散時刻イベントを持つレイヤーを集約してフィード配列を作る純粋ロジック。
const CAP = 100;

// GDELT の "YYYYMMDDHHMMSS"（UTC）を epoch ms に。不正は 0。
export function parseGdeltDate(s) {
  if (typeof s !== 'string' || !/^\d{14}$/.test(s)) return 0;
  const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
  const h = +s.slice(8, 10), mi = +s.slice(10, 12), se = +s.slice(12, 14);
  return Date.UTC(y, mo, d, h, mi, se);
}

// layers: レイヤーオブジェクト配列。snapshots: {id:snap}。enabled: Set。
// 各レイヤーの任意 toFeedItems(snapshot) を集約→time降順→上位CAP件。
export function buildFeed(layers, snapshots, enabled, cap = CAP) {
  const items = [];
  for (const l of layers) {
    if (!enabled.has(l.id) || typeof l.toFeedItems !== 'function') continue;
    const snap = snapshots[l.id];
    if (!snap) continue;
    for (const it of l.toFeedItems(snap)) items.push(it);
  }
  items.sort((a, b) => b.time - a.time);
  return items.slice(0, cap);
}

// フィード項目の層内比較（純粋）。group(紛争/抗議)は count 降順、他は time 降順。
// 各 queue は単一レイヤーの項目なので均質（全 group か全 個別）。
function feedItemCmp(a, b) {
  if (a.kind === 'group' && b.kind === 'group') {
    const d = (Number(b.count) || 0) - (Number(a.count) || 0);
    if (d) return d;
  }
  return (b.time || 0) - (a.time || 0);
}

// 可視レイヤーを層内整列し、layers 登場順にラウンドロビン巡回して cap 件（純粋）。
export function buildFeedBalanced(layers, snapshots, visible, cap = CAP) {
  const queues = [];
  for (const l of layers) {
    if (!visible.has(l.id) || typeof l.toFeedItems !== 'function') continue;
    const snap = snapshots[l.id];
    if (!snap) continue;
    const items = l.toFeedItems(snap).slice().sort(feedItemCmp);
    if (items.length) queues.push(items);
  }
  const out = [];
  for (let i = 0; out.length < cap; i += 1) {
    let took = false;
    for (const q of queues) {
      if (i < q.length) { out.push(q[i]); took = true; if (out.length >= cap) break; }
    }
    if (!took) break; // 全層尽きた
  }
  return out;
}

// ── フィードのレイヤーフィルタ（純粋・hidden=非表示idの Set モデル）──
const FEED_FILTER_KEY = 'orbis.feedFilter.v1';

// チップに出す layerId（フィード対象かつ globe 有効）。items を渡すと、実際にフィード項目を
// 持つレイヤーだけに絞る（toFeedItems が空配列を返す currents/airtemp/sst の無意味なチップを排除）。
export function feedChipIds(feedLayerObjs, enabled, items = null) {
  const present = Array.isArray(items) ? new Set(items.map((it) => it.layerId)) : null;
  return feedLayerObjs
    .filter((l) => enabled.has(l.id) && (!present || present.has(l.id)))
    .map((l) => l.id);
}
// stored=非表示idの配列。null/不正→空（全表示）。新レイヤーは hidden に無いので既定表示。
export function loadFeedHidden(stored) {
  return new Set(Array.isArray(stored) ? stored : []);
}
export function toggleHidden(hidden, id) {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export function visibleIds(chipIds, hidden) { return chipIds.filter((id) => !hidden.has(id)); }
export function allActive(chipIds, hidden) { return chipIds.every((id) => !hidden.has(id)); }
export function applyChips(items, hidden) { return items.filter((it) => !hidden.has(it.layerId)); }

export function readFeedFilter(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return null;
  try { return JSON.parse(storage.getItem(FEED_FILTER_KEY)); } catch { return null; }
}
export function writeFeedFilter(hidden, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try { storage.setItem(FEED_FILTER_KEY, JSON.stringify([...hidden])); } catch { /* noop */ }
}

// 件数バーの幅(0..100%)。フィード内最大件数で log 正規化。maxCount<=0/count<=0 は 0。
export function countBarPct(count, maxCount) {
  const c = Number(count) || 0, m = Number(maxCount) || 0;
  if (m <= 0 || c <= 0) return 0;
  return Math.round(100 * Math.log1p(c) / Math.log1p(m));
}
