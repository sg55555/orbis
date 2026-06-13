// 動的モーション用の純粋ジオメトリ/差分ロジック。

// 折れ線 coords（[[lon,lat],...]）上を t∈[0,1] で進んだ点を線分補間で返す。
// 各辺は均等な弧長ではなく「2D直線距離」で重み付け。退化時は始点 or null。
export function pointAlongPath(coords, t) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (coords.length === 1) return coords[0].slice();
  const tt = Math.min(1, Math.max(0, t));
  // 各辺長と総長
  const segLen = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    const len = Math.hypot(dx, dy);
    segLen.push(len);
    total += len;
  }
  if (total === 0) return coords[0].slice();
  let target = tt * total;
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i] || i === segLen.length - 1) {
      const f = segLen[i] === 0 ? 0 : target / segLen[i];
      const a = coords[i], b = coords[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    target -= segLen[i];
  }
  return coords[coords.length - 1].slice();
}

// prevIds(Set|null) に無く curr（{id}配列）にある id 一覧。
// prev が null/未指定（初回）は新規なし扱い（初回ロードで全件パルスを防ぐ）。
export function diffNewIds(prevIds, curr) {
  if (!prevIds) return [];
  const out = [];
  for (const o of curr) {
    if (o && o.id != null && !prevIds.has(o.id)) out.push(o.id);
  }
  return out;
}
