// 国境/県境ポリゴンの点内判定（純 ray-casting）。collectors/lib/geo_country.py を JS 同一移植。
// deck/DOM/fetch/map 非依存・node:test の主対象。

// 全リング横断の even-odd（穴・MultiPolygon を正しく扱う）。
// collectors/lib/geo_country.py:30-42 の _point_in_rings と同一式。
export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
      j = i;
    }
  }
  return inside;
}
