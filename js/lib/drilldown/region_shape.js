// 地域ポリゴン rings → 形状シルエット SVG パス（純関数・DOM/fetch 非依存）。
// クライアントが既に読み込み済のポリゴン（国=country_bounds rings / 県=admin1 rings・共に
// loadPolygons 形式）から実行時生成し、profile JSON のスキーマは変えない。都市(点)は null 扱い。

function _area(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(s) / 2;
}

// 外環配列 → 最大面積環を選び viewBox 正規化（長辺=100・Y 反転）・~80点に間引き → SVG パス。
export function regionShapePath(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  let ring = rings.reduce((a, b) => (_area(b) > _area(a) ? b : a), rings[0]);
  if (!Array.isArray(ring) || ring.length < 3) return null;
  if (ring.length > 90) {
    const step = Math.floor(ring.length / 80) || 1;
    ring = ring.filter((_, i) => i % step === 0);
    if (ring[ring.length - 1] !== ring[0]) ring = ring.concat([ring[0]]);
  }
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  const minx = Math.min(...xs); const maxx = Math.max(...xs);
  const miny = Math.min(...ys); const maxy = Math.max(...ys);
  const w = maxx - minx; const h = maxy - miny;
  if (w === 0 && h === 0) return null;
  const scale = 100 / Math.max(w, h);
  const r1 = (n) => Math.round(n * 10) / 10;
  const tx = (x) => r1((x - minx) * scale);
  const ty = (y) => r1((maxy - y) * scale);   // SVG は y 下向き＝反転
  const d = 'M' + ring.map((p) => `${tx(p[0])},${ty(p[1])}`).join(' L') + 'Z';
  return { d, viewBox: `0 0 ${r1(w * scale)} ${r1(h * scale)}` };
}
