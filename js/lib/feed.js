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
